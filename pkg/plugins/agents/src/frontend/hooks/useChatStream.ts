/**
 * useChatStream — single hook the chat UI consumes.
 *
 * Steps:
 *   1. Fetch the session row from `/plugins/agents/sessions/:id` so we
 *      get the tenant-scoped `doAgentName` (computed by the backend per
 *      Stream I).
 *   2. Wrap `useAgent({ agent: 'AgentChatDO', name: doAgentName })` from
 *      `agents/react` (Cloudflare Agents SDK 0.12.x).
 *   3. Layer `useAgentChat` from `@cloudflare/ai-chat/react` on top to
 *      get a `sendMessage` we can call.
 *   4. Listen for `flowlib.agent-event` envelopes on the same socket and
 *      accumulate the `AgentEvent[]` the chat UI renders.
 *   5. Send typed envelopes for `interrupt`, permission responses, and
 *      HIL responses over the WebSocket — symmetric with the DO's
 *      outgoing envelope.
 *
 * **SDK divergence notes (probed against `agents@0.12.3`):**
 *
 * - `useAgent` returns a PartySocket-like object with `send` and
 *   `addEventListener`. We hold it and pass it straight to
 *   `useAgentChat`.
 * - `useAgentChat` is built around AI SDK v5 `UIMessage`s, which is a
 *   different shape than our `AgentEvent` union. We use `useAgentChat`
 *   only for its `sendMessage` (text submission) and `setMessages([])`
 *   (clear) helpers, NOT for rendering. Rendering uses the
 *   `flowlib.agent-event` envelope stream we manage ourselves on the
 *   underlying socket — that union IS the canonical wire format
 *   (`pkg/plugins/agents/src/shared/events.ts`).
 * - `useAgentChat`'s `stop()` cancels the local fetch but does NOT push
 *   anything back over the WS. Our `interrupt()` sends a typed envelope
 *   the DO is expected to handle, and also calls `stop()` for parity.
 *
 * For tests, the SDK calls are isolated behind two small adapter
 * factories (`defaultUseAgent`, `defaultUseAgentChat`). Tests inject
 * mocks via `useChatStream`'s second parameter.
 */
import * as React from 'react';
import type { AgentSession } from '../../shared/types';
import { isAgentEvent, type AgentEvent } from '../../shared/events';

/**
 * Subset of the PartySocket-like surface returned by `useAgent` that we
 * actually need. Kept intentionally small so the test mock can be a
 * couple of lines.
 */
export interface ChatSocketLike {
  send: (data: string) => void;
  addEventListener: (
    type: 'message',
    listener: (event: MessageEvent) => void,
    options?: { signal?: AbortSignal },
  ) => void;
  removeEventListener: (
    type: 'message',
    listener: (event: MessageEvent) => void,
  ) => void;
  /** Connection state — exposed by PartySocket. */
  readyState?: number;
}

/**
 * Subset of `useAgentChat`'s return value we use.
 */
export interface ChatHelpers {
  sendMessage: (message: { text: string }) => void;
  stop: () => void;
  clearHistory?: () => void;
}

export interface UseChatStreamReturn {
  /** Accumulated AgentEvent stream for this session. */
  events: AgentEvent[];
  status: 'connecting' | 'streaming' | 'idle' | 'error';
  /** Last error, if `status === 'error'`. */
  error?: string;
  /** The session row (so callers can read `doAgentName`, model, etc). */
  session?: AgentSession;
  send: (text: string) => Promise<void>;
  interrupt: () => void;
  permissionResponse: (id: string, decision: 'allow' | 'deny') => void;
  hilResponse: (id: string, response: unknown) => void;
  /** Permissions that have been resolved — exposed for ChatStream UI. */
  resolvedPermissions: Record<string, 'allow' | 'deny'>;
  /** HIL requests resolved — exposed for ChatStream UI. */
  resolvedHumanInputs: Record<string, true>;
}

/** Inbound envelope from the DO (matches `chat-agent-do.ts`). */
interface AgentEventEnvelope {
  type: 'flowlib.agent-event';
  event: AgentEvent;
}

interface AgentErrorEnvelope {
  type: 'flowlib.agent-error';
  error: { message: string; code?: string };
}

/** Outbound envelope shapes for control messages. */
export type OutboundControlEnvelope =
  | { type: 'flowlib.interrupt' }
  | {
      type: 'flowlib.permission-response';
      id: string;
      decision: 'allow' | 'deny';
    }
  | { type: 'flowlib.hil-response'; id: string; response: unknown };

/**
 * Pure helper: parse an inbound WS frame into a canonical action.
 * Exposed for testing. Returns `null` for frames we don't understand
 * (e.g. SDK protocol traffic) so callers can ignore them.
 */
export type ParsedInboundFrame =
  | { kind: 'agent-event'; event: AgentEvent }
  | { kind: 'agent-error'; error: { message: string; code?: string } }
  | { kind: 'unknown' };

export function parseInboundFrame(data: unknown): ParsedInboundFrame {
  if (typeof data !== 'string') {
    return { kind: 'unknown' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return { kind: 'unknown' };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { kind: 'unknown' };
  }
  const env = parsed as { type?: unknown; event?: unknown; error?: unknown };
  if (
    env.type === 'flowlib.agent-event' &&
    env.event &&
    isAgentEvent(env.event)
  ) {
    return { kind: 'agent-event', event: env.event };
  }
  if (env.type === 'flowlib.agent-error' && env.error && typeof env.error === 'object') {
    const err = env.error as { message?: unknown; code?: unknown };
    return {
      kind: 'agent-error',
      error: {
        message: typeof err.message === 'string' ? err.message : 'Unknown error',
        code: typeof err.code === 'string' ? err.code : undefined,
      },
    };
  }
  return { kind: 'unknown' };
}

/**
 * Test-injection seam: the production hook calls these adapters which
 * resolve to the real `useAgent`/`useAgentChat`. Tests pass mocks via
 * the optional second parameter to `useChatStream`.
 */
export interface ChatStreamAdapters {
  useAgent: (options: { agent: string; name: string }) => ChatSocketLike;
  useAgentChat: (options: {
    agent: ChatSocketLike & { agent: string; name: string };
  }) => ChatHelpers;
  /** Override the session loader. Defaults to a `fetch`-based loader. */
  loadSession?: (sessionId: string) => Promise<AgentSession>;
}

/**
 * Default session loader. Hits the same REST contract as
 * `SessionsApiClient.getSession()` (Stream L's `sessions.api.ts`) but
 * doesn't import that class — keeping the hook's surface decoupled from
 * the API client choice.
 */
async function defaultLoadSession(
  sessionId: string,
  baseUrl = '',
): Promise<AgentSession> {
  const response = await fetch(
    `${baseUrl.replace(/\/$/, '')}/plugins/agents/sessions/${encodeURIComponent(sessionId)}`,
    { credentials: 'include' },
  );
  if (!response.ok) {
    throw new Error(`Failed to load session ${sessionId}: ${response.status}`);
  }
  return (await response.json()) as AgentSession;
}

/**
 * Default adapters resolve `agents/react` and `@cloudflare/ai-chat/react`
 * via static `import`. Both are marked as `neverBundle` peer deps in
 * `tsdown.config.ts`, so the bundler emits bare specifiers and the
 * consumer's package manager satisfies them at runtime.
 *
 * For tests that don't have those peer deps installed (the workerd
 * vitest pool, for example), pass an `adapters` override on
 * `useChatStream(sessionId, adapters)` — the default adapter is only
 * invoked when no override is supplied.
 */
function loadDefaultAdapters(): ChatStreamAdapters {
  // The `// @ts-ignore` is necessary because `agents/react` declares
  // `react@^19` peer-dep types but the consumer bundle pins react 18.
  // The runtime contract is identical — we only use `useAgent`'s
  // return shape, which is stable across the two react majors.
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — peer dep, resolved by host bundler
  // eslint-disable-next-line import/no-unresolved
  const agentsMod = require('agents/react') as {
    useAgent: (opts: { agent: string; name: string }) => ChatSocketLike;
  };
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — peer dep, resolved by host bundler
  // eslint-disable-next-line import/no-unresolved
  const aiChatMod = require('@cloudflare/ai-chat/react') as {
    useAgentChat: (opts: {
      agent: ChatSocketLike & { agent: string; name: string };
    }) => ChatHelpers;
  };
  return {
    useAgent: (options) => agentsMod.useAgent(options),
    useAgentChat: (options) => aiChatMod.useAgentChat(options),
  };
}

export interface UseChatStreamOptions {
  /** Override the API base URL. Defaults to same-origin. */
  apiBaseUrl?: string;
}

/**
 * Stream of `AgentEvent`s for a session, plus controls.
 *
 * @param sessionId The session id to stream.
 * @param adapters Test override hook for `useAgent`/`useAgentChat`.
 * @param options Optional config (API base URL, …).
 */
export function useChatStream(
  sessionId: string,
  adapters?: ChatStreamAdapters,
  options: UseChatStreamOptions = {},
): UseChatStreamReturn {
  const adaptersRef = React.useRef<ChatStreamAdapters | null>(null);
  if (!adaptersRef.current) {
    adaptersRef.current = adapters ?? loadDefaultAdapters();
  }
  const a = adaptersRef.current;

  const [session, setSession] = React.useState<AgentSession | undefined>();
  const [events, setEvents] = React.useState<AgentEvent[]>([]);
  const [status, setStatus] = React.useState<UseChatStreamReturn['status']>(
    'connecting',
  );
  const [error, setError] = React.useState<string | undefined>();
  const [resolvedPermissions, setResolvedPermissions] = React.useState<
    Record<string, 'allow' | 'deny'>
  >({});
  const [resolvedHumanInputs, setResolvedHumanInputs] = React.useState<
    Record<string, true>
  >({});

  // Step 1 — load the session.
  React.useEffect(() => {
    let cancelled = false;
    const loader = a.loadSession ?? ((id) => defaultLoadSession(id, options.apiBaseUrl));
    setStatus('connecting');
    setError(undefined);
    loader(sessionId)
      .then((row) => {
        if (cancelled) {
          return;
        }
        setSession(row);
      })
      .catch((err: unknown) => {
        if (cancelled) {
          return;
        }
        setError(err instanceof Error ? err.message : String(err));
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, a, options.apiBaseUrl]);

  // Step 2 — connect to the DO. We MUST NOT call `useAgent` until we
  // have a `doAgentName`; conditionally-calling a hook breaks the rules
  // of hooks. The trick: we always call `useAgent` but pass `''` when
  // not ready, and the underlying PartySocket either no-ops or 404s —
  // either way our local code guards on `session?.doAgentName` before
  // sending. In production this is fine; tests stub the adapter.
  const doName = session?.doAgentName ?? '';
  const socket = a.useAgent({ agent: 'AgentChatDO', name: doName });
  const chat = a.useAgentChat({
    agent: Object.assign(socket, { agent: 'AgentChatDO', name: doName }),
  });

  // Step 3 — stream agent events from the socket.
  React.useEffect(() => {
    if (!session?.doAgentName) {
      return;
    }
    const onMessage = (msg: MessageEvent) => {
      const frame = parseInboundFrame(msg.data);
      if (frame.kind === 'agent-event') {
        setEvents((prev) => [...prev, frame.event]);
        setStatus((prev) => (prev === 'error' ? prev : 'streaming'));
        if (frame.event.type === 'session-end') {
          setStatus('idle');
        }
      } else if (frame.kind === 'agent-error') {
        setError(frame.error.message);
        setStatus('error');
      }
    };
    socket.addEventListener('message', onMessage);
    setStatus((prev) => (prev === 'error' ? prev : 'idle'));
    return () => {
      socket.removeEventListener('message', onMessage);
    };
  }, [session?.doAgentName, socket]);

  // Step 4 — outbound helpers.
  const sendControl = React.useCallback(
    (envelope: OutboundControlEnvelope) => {
      try {
        socket.send(JSON.stringify(envelope));
      } catch {
        // Swallow — readyState may briefly be CONNECTING; the consumer
        // can re-attempt by re-clicking the relevant button.
      }
    },
    [socket],
  );

  const send = React.useCallback(
    async (text: string) => {
      if (!session) {
        throw new Error('Session not loaded yet');
      }
      const trimmed = text.trim();
      if (!trimmed) {
        return;
      }
      setStatus('streaming');
      chat.sendMessage({ text: trimmed });
    },
    [chat, session],
  );

  const interrupt = React.useCallback(() => {
    sendControl({ type: 'flowlib.interrupt' });
    chat.stop();
    setStatus('idle');
  }, [chat, sendControl]);

  const permissionResponse = React.useCallback(
    (id: string, decision: 'allow' | 'deny') => {
      sendControl({ type: 'flowlib.permission-response', id, decision });
      setResolvedPermissions((prev) => ({ ...prev, [id]: decision }));
    },
    [sendControl],
  );

  const hilResponse = React.useCallback(
    (id: string, response: unknown) => {
      sendControl({ type: 'flowlib.hil-response', id, response });
      setResolvedHumanInputs((prev) => ({ ...prev, [id]: true }));
    },
    [sendControl],
  );

  return {
    events,
    status,
    error,
    session,
    send,
    interrupt,
    permissionResponse,
    hilResponse,
    resolvedPermissions,
    resolvedHumanInputs,
  };
}
