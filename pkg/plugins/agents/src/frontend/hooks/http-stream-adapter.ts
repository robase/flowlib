/**
 * HTTP/SSE chat transport — the Express/Node counterpart to the
 * Cloudflare Durable Object WebSocket transport.
 *
 * `useChatStream` selects this transport when `session.transportMode ===
 * 'http'` (set server-side when no Durable Object is wired). It exposes
 * the **same** `ChatSocketLike` + `ChatHelpers` surface as the DO adapter,
 * and re-dispatches inbound SSE frames as `MessageEvent`-shaped objects
 * carrying the identical `{ type: 'flowlib.agent-event' | 'flowlib.agent-error' }`
 * envelopes — so the shared `parseInboundFrame` handles both transports
 * unchanged.
 *
 *   sendMessage({text}) → POST /sessions/:id/stream, read the SSE body,
 *                         emit each frame to the message listeners.
 *   send(controlJson)   → POST /sessions/:id/control (interrupt / permission
 *                         / human-input responses).
 */
import * as React from 'react';
import type { ChatHelpers, ChatSocketLike } from './useChatStream';

type MessageListener = (event: MessageEvent) => void;

export interface HttpChatTransport {
  socket: ChatSocketLike;
  chat: ChatHelpers;
}

export interface UseHttpChatTransportOptions {
  sessionId: string;
  /** Resolved API base URL (e.g. `http://host/flowlib` or `/api/flowlib`). */
  baseUrl: string;
  /** When false, the transport is inert (the DO transport is active instead). */
  enabled: boolean;
}

function streamUrl(baseUrl: string, sessionId: string): string {
  return `${baseUrl.replace(/\/$/, '')}/plugins/agents/sessions/${encodeURIComponent(sessionId)}/stream`;
}

function controlUrl(baseUrl: string, sessionId: string): string {
  return `${baseUrl.replace(/\/$/, '')}/plugins/agents/sessions/${encodeURIComponent(sessionId)}/control`;
}

/**
 * Build a stable HTTP transport for a session. The returned `socket` /
 * `chat` objects are memoised on `sessionId` + `baseUrl` so
 * `useChatStream`'s effects (which key on `socket`) don't re-subscribe
 * every render.
 */
export function useHttpChatTransport(opts: UseHttpChatTransportOptions): HttpChatTransport {
  const { sessionId, baseUrl, enabled } = opts;
  // The in-flight abort lives in a ref so the unmount/session-change
  // effect below can reach it. The *listener set*, by contrast, is
  // deliberately scoped to each memo evaluation (see below) rather than
  // to the hook instance.
  const abortRef = React.useRef<AbortController | null>(null);

  const transport = React.useMemo<HttpChatTransport>(() => {
    // Scoped per transport identity (i.e. per session), NOT per hook
    // instance. `useChatStream` holds a single hook instance across chat
    // switches, so a hook-level Set would be shared between sessions: an
    // in-flight reader from session A would emit into the set that by
    // then holds session B's `onMessage`, rendering A's text, tool calls
    // and permission prompts inside B's thread. With the set captured
    // here, A's reader can only ever reach A's listeners — and
    // `useChatStream`'s effect cleanup has already removed them from
    // this (old) socket by the time B is active, so the emit goes
    // nowhere.
    const listeners = new Set<MessageListener>();
    const emit = (data: string): void => {
      const evt = { data } as MessageEvent;
      for (const l of listeners) {
        l(evt);
      }
    };
    const emitError = (message: string): void => {
      emit(JSON.stringify({ type: 'flowlib.agent-error', error: { message } }));
    };

    const socket: ChatSocketLike = {
      // Control frames (interrupt / permission / HIL) → POST /control.
      send: (raw: string) => {
        if (!enabled || !sessionId) {
          return;
        }
        void fetch(controlUrl(baseUrl, sessionId), {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: raw,
        }).catch(() => {
          // Best-effort; the UI can retry.
        });
      },
      addEventListener: (_type, listener) => {
        listeners.add(listener);
      },
      removeEventListener: (_type, listener) => {
        listeners.delete(listener);
      },
      readyState: 1,
    };

    const chat: ChatHelpers = {
      sendMessage: ({ text }) => {
        if (!enabled || !sessionId) {
          return;
        }
        // Abort any previous in-flight stream.
        abortRef.current?.abort();
        const abort = new AbortController();
        abortRef.current = abort;
        void (async () => {
          try {
            const res = await fetch(streamUrl(baseUrl, sessionId), {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
              body: JSON.stringify({ text }),
              signal: abort.signal,
            });
            if (!res.ok || !res.body) {
              emitError(`Stream request failed: ${res.status}`);
              return;
            }
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            for (;;) {
              const { done, value } = await reader.read();
              if (done) {
                break;
              }
              buffer += decoder.decode(value, { stream: true });
              // SSE frames are separated by a blank line.
              let sep: number;
              while ((sep = buffer.indexOf('\n\n')) !== -1) {
                const rawFrame = buffer.slice(0, sep);
                buffer = buffer.slice(sep + 2);
                const dataLine = rawFrame
                  .split('\n')
                  .filter((l) => l.startsWith('data:'))
                  .map((l) => l.slice(5).trimStart())
                  .join('\n');
                if (dataLine) {
                  emit(dataLine);
                }
              }
            }
          } catch (err) {
            if ((err as { name?: string })?.name === 'AbortError') {
              return;
            }
            emitError(err instanceof Error ? err.message : String(err));
          }
        })();
      },
      stop: () => {
        // Local cancel only. The server-side interrupt is the caller's
        // job: `useChatStream.interrupt()` sends the
        // `flowlib.interrupt` control envelope itself (and is the only
        // caller of `stop()`). Sending it here too produced two POSTs
        // to `/control` per stop — mirroring the DO transport, whose
        // `stop()` likewise only cancels locally.
        abortRef.current?.abort();
        abortRef.current = null;
      },
    };

    return { socket, chat };
  }, [sessionId, baseUrl, enabled]);

  // Cancel any in-flight stream when the component unmounts or the
  // transport is rebuilt (session / baseUrl / enabled change).
  //
  // Without this the reader loop keeps `await reader.read()`-ing after
  // the chat UI is gone: the user navigates away mid-turn, the fetch
  // stays open, and the agent turn keeps burning tokens and sandbox
  // time with no consumer. Repeated navigation stacked orphaned
  // streams. Aborting the fetch closes the connection, which the
  // server sees as a client disconnect.
  React.useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [transport]);

  return transport;
}
