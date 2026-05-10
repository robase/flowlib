/**
 * useChatStream — single hook the chat UI consumes.
 *
 * Steps:
 *   1. Fetch the session row from `/plugins/agents/sessions/:id` so we
 *      get the tenant-scoped `doAgentName` (computed by the backend per
 *      Stream I).
 *   2. Wrap `useAgent({ agent: 'AgentChatDO', name: doAgentName })` from
 *      `agents/react` (Cloudflare Agents SDK 0.12.x).
 *   3. Speak the `cf_agent_use_chat_request` envelope directly on the
 *      socket to submit the user's text. We used to layer
 *      `useAgentChat` from `@cloudflare/ai-chat/react` here, but that
 *      hook calls `React.use(...)` which is a React 19 API; consumer
 *      bundles pinned to React 18 crash with `E.use is not a function`.
 *      The wire format is small and stable, so we emit it inline.
 *   4. Listen for `flowlib.agent-event` envelopes on the same socket and
 *      accumulate the `AgentEvent[]` the chat UI renders.
 *   5. Send typed envelopes for `interrupt`, permission responses, and
 *      HIL responses over the WebSocket — symmetric with the DO's
 *      outgoing envelope.
 *
 * **SDK divergence notes (probed against `agents@0.12.3`):**
 *
 * - `useAgent` returns a PartySocket-like object with `send` and
 *   `addEventListener`. We hold it and emit `cf_agent_use_chat_request`
 *   frames directly through `send`.
 * - The CF SDK's persisted-messages table (`cf_ai_chat_agent_messages`
 *   on the DO) is not consulted by flowlib — the backend reads the last
 *   user-message text out of `self.messages` only. We send a
 *   single-element `messages: [user]` array each turn.
 * - The CF SDK's `stop()` cancels the local fetch but does NOT push
 *   anything back over the WS. Our `interrupt()` sends a typed
 *   `flowlib.interrupt` envelope the DO handles, plus a
 *   `cf_agent_chat_request_cancel` for the latest in-flight request id
 *   (parity with what `useAgentChat.stop()` used to send).
 *
 * For tests, the SDK call to `useAgent` is isolated behind a small
 * adapter factory. The chat helpers (`sendMessage`/`stop`) are also
 * exposed via the adapter so tests can substitute fakes; the default
 * implementation is the inline one described above.
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
  removeEventListener: (type: 'message', listener: (event: MessageEvent) => void) => void;
  /** Connection state — exposed by PartySocket. */
  readyState?: number;
}

/**
 * Outbound chat helpers we hand back to consumers. Mirrors the subset of
 * the old `useAgentChat` surface we relied on, but is now produced by an
 * inline implementation that speaks `cf_agent_use_chat_request` directly.
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
  if (env.type === 'flowlib.agent-event' && env.event && isAgentEvent(env.event)) {
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
async function defaultLoadSession(sessionId: string, baseUrl = ''): Promise<AgentSession> {
  const response = await fetch(
    `${baseUrl.replace(/\/$/, '')}/plugins/agents/sessions/${encodeURIComponent(sessionId)}`,
    { credentials: 'include' },
  );
  if (!response.ok) {
    throw new Error(`Failed to load session ${sessionId}: ${response.status}`);
  }
  return (await response.json()) as AgentSession;
}

// The `@ts-ignore` is necessary because `agents/react` declares
// `react@^19` peer-dep types but the consumer bundle pins react 18. The
// runtime contract for `useAgent({ agent, name })` (no `query` option)
// is identical across the two react majors — `agents/react` only calls
// `React.use()` on the `query` code path, which we don't use. The
// import is listed in `tsdown.config.ts` `neverBundle`, so the static
// import stays as a bare specifier in the emitted ESM.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — peer dep, resolved by host bundler
// eslint-disable-next-line import/no-unresolved
import { useAgent as agentsUseAgent } from 'agents/react';

/**
 * Generate a short opaque id for a chat request / message. Browsers all
 * have `crypto.randomUUID`; if for some reason it's missing we fall
 * back to `Math.random` which is fine for the purpose (uniqueness over
 * a single tab's session).
 */
function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/**
 * Build the `cf_agent_use_chat_request` envelope expected by
 * `AIChatAgent` (the base class `AgentChatDO` extends). This is the
 * same shape `@cloudflare/ai-chat`'s `useAgentChat` would emit, minus
 * the AI-SDK-specific fields the flowlib backend ignores.
 *
 * The backend reads `self.messages[self.messages.length - 1]` and
 * extracts the text from its `parts`; flowlib's runtime persists its
 * own session-level history elsewhere, so sending only the new user
 * message each turn is correct.
 */
function buildChatRequestEnvelope(requestId: string, text: string): string {
  return JSON.stringify({
    id: requestId,
    type: 'cf_agent_use_chat_request',
    init: {
      method: 'POST',
      body: JSON.stringify({
        trigger: 'submit-user-message',
        messages: [
          {
            id: newId(),
            role: 'user',
            parts: [{ type: 'text', text }],
          },
        ],
      }),
    },
  });
}

/**
 * Default adapters: `useAgent` resolves `agents/react` (peer dep,
 * `neverBundle`d). The chat helpers are produced inline — we used to
 * import `useAgentChat` from `@cloudflare/ai-chat/react`, but that
 * hook calls `React.use()` (a React 19 API) and crashed consumer
 * bundles pinned to React 18. The wire format
 * (`cf_agent_use_chat_request`) is documented and small.
 *
 * For tests that don't have `agents/react` available (the workerd
 * vitest pool, for example), pass an `adapters` override on
 * `useChatStream(sessionId, adapters)` — the default adapter is only
 * invoked when no override is supplied.
 */
function loadDefaultAdapters(): ChatStreamAdapters {
  return {
    useAgent: (options) =>
      (agentsUseAgent as unknown as (opts: { agent: string; name: string }) => ChatSocketLike)(
        options,
      ),
    useAgentChat: ({ agent }) => {
      // Track the most recent in-flight request id so `stop()` can send
      // a `cf_agent_chat_request_cancel` for it. Using a module-level
      // ref-by-closure here is fine: the adapter is invoked once per
      // `useChatStream` instance (the outer hook caches `adapters` in a
      // ref), and each instance gets its own closure.
      let lastRequestId: string | null = null;
      return {
        sendMessage: ({ text }) => {
          const requestId = newId();
          lastRequestId = requestId;
          try {
            agent.send(buildChatRequestEnvelope(requestId, text));
          } catch {
            // Swallow — readyState may briefly be CONNECTING. The
            // consumer can re-attempt by re-clicking send.
          }
        },
        stop: () => {
          if (!lastRequestId) {
            return;
          }
          try {
            agent.send(JSON.stringify({ id: lastRequestId, type: 'cf_agent_chat_request_cancel' }));
          } catch {
            // Swallow — same readyState reasoning as `sendMessage`.
          }
          lastRequestId = null;
        },
      };
    },
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
  const [status, setStatus] = React.useState<UseChatStreamReturn['status']>('connecting');
  const [error, setError] = React.useState<string | undefined>();
  const [resolvedPermissions, setResolvedPermissions] = React.useState<
    Record<string, 'allow' | 'deny'>
  >({});
  const [resolvedHumanInputs, setResolvedHumanInputs] = React.useState<Record<string, true>>({});

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
