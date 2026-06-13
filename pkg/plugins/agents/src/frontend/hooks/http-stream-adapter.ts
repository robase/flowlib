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
  // Listeners + current abort live in refs so the socket/chat identities
  // stay stable across renders.
  const listenersRef = React.useRef<Set<MessageListener>>(new Set());
  const abortRef = React.useRef<AbortController | null>(null);

  return React.useMemo<HttpChatTransport>(() => {
    const emit = (data: string): void => {
      const evt = { data } as MessageEvent;
      for (const l of listenersRef.current) {
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
        listenersRef.current.add(listener);
      },
      removeEventListener: (_type, listener) => {
        listenersRef.current.delete(listener);
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
        abortRef.current?.abort();
        // Also tell the server to stop the turn (frees the LLM/sandbox).
        socket.send(JSON.stringify({ type: 'flowlib.interrupt' }));
      },
    };

    return { socket, chat };
  }, [sessionId, baseUrl, enabled]);
}
