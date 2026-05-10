/**
 * useAgentRuntime — assistant-ui runtime adapter for one chat session.
 *
 * Wires the agents plugin's existing transport (`useChatStream` over
 * the AgentChatDO WebSocket) plus REST history (`useSessionMessages`)
 * into `useExternalStoreRuntime`. The result is dropped into
 * `<AssistantRuntimeProvider>` and consumed by assistant-ui's `Thread`
 * primitives.
 *
 * Design notes:
 *
 * - History is loaded once at mount via `GET /sessions/:id/messages`.
 *   It's treated as an immutable snapshot; live updates do not mutate
 *   the cache. On thread switch the runtime is remounted (because the
 *   caller keys `<AssistantRuntimeProvider>` by sessionId), which
 *   discards the live events and reloads history.
 *
 * - Live events arrive as an append-only `AgentEvent[]` from
 *   `useChatStream`. The reducer in this file groups them into
 *   per-assistant-message ordered part lists (text + tool-call +
 *   file-edit + permission + HIL). Non-tool-call event types are
 *   projected onto synthetic tool-call parts whose `toolName` is one
 *   of the `FLOWLIB_*` sentinels — the `ChatThread` renderer switches
 *   on the sentinel to mount the right custom component.
 *
 * - User messages are optimistic: on `onNew` we push to a local
 *   `liveItems` array and call `chatStream.send(text)`. They are
 *   never "claimed" or removed during the session — they remain in
 *   the live view alongside assistant messages until the runtime
 *   remounts.
 *
 * - Permission and HIL responses flow back through the same WS via
 *   `chatStream.permissionResponse` / `chatStream.hilResponse`. The
 *   runtime exposes `stream` so the custom-part renderers can pull
 *   these handlers and the resolved-state maps from a context wrapper
 *   (`AgentStreamContext`).
 */
import * as React from 'react';
import {
  useExternalStoreRuntime,
  type AppendMessage,
  type ThreadMessage,
} from '@assistant-ui/react';
import { useChatStream } from './useChatStream';
import { useSessionMessages } from './useSessions';
import type { AgentEvent } from '../../shared/events';
import type { AgentMessage, AgentMessagePart } from '../../shared/types';

/**
 * Sentinel `toolName` values that the runtime uses to embed
 * permission / HIL / file-edit events as message parts. The
 * `ChatThread` renderer switches on these to mount the right custom
 * component.
 */
export const FLOWLIB_TOOL_NAMES = {
  fileEdit: '__flowlib_file_edit__',
  permission: '__flowlib_permission__',
  humanInput: '__flowlib_human_input__',
} as const;

interface AssistantMessageBuilder {
  id: string;
  parts: RuntimeMessagePart[];
  status: 'running' | 'complete';
  createdAt: Date;
}

type RuntimeMessagePart =
  | { type: 'text'; text: string }
  | {
      type: 'tool-call';
      toolCallId: string;
      toolName: string;
      args: unknown;
      argsText: string;
      result?: unknown;
      isError?: boolean;
    };

interface RuntimeMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  parts: RuntimeMessagePart[];
  status: 'complete' | 'running';
  createdAt: Date;
}

/**
 * Convert a persisted `AgentMessage` to the adapter's normalised
 * shape. We preserve text and tool-call/tool-result parts; non-text
 * parts that we don't yet have a renderer for are dropped silently.
 */
function historyToRuntime(m: AgentMessage): RuntimeMessage {
  const parts: RuntimeMessagePart[] = [];
  // Persisted tool-result parts arrive after their tool-call sibling
  // in the same message. We pair them up so the assistant-ui part has
  // both `args` and `result`.
  const partByCallId = new Map<string, Extract<RuntimeMessagePart, { type: 'tool-call' }>>();
  for (const part of m.parts as AgentMessagePart[]) {
    if (part.type === 'text') {
      parts.push({ type: 'text', text: part.text });
    } else if (part.type === 'tool-call') {
      const next: Extract<RuntimeMessagePart, { type: 'tool-call' }> = {
        type: 'tool-call',
        toolCallId: part.id,
        toolName: part.name,
        args: part.input,
        argsText: stableStringify(part.input),
      };
      parts.push(next);
      partByCallId.set(part.id, next);
    } else if (part.type === 'tool-result') {
      const sibling = partByCallId.get(part.id);
      if (sibling) {
        sibling.result = part.output;
      } else {
        // Orphan: synthesize a tool-call part so the result still
        // renders.
        parts.push({
          type: 'tool-call',
          toolCallId: part.id,
          toolName: '(unknown tool)',
          args: undefined,
          argsText: '',
          result: part.output,
        });
      }
    }
  }
  return {
    id: m.id,
    role: m.role,
    parts: parts.length > 0 ? parts : [{ type: 'text', text: '' }],
    status: 'complete',
    createdAt: new Date(m.createdAt),
  };
}

/**
 * Build the merged message list from the three streams.
 *
 * The reducer keeps two collections:
 *
 *   - `assistantMessagesById` — assistant messages keyed by the real
 *     server-assigned messageId (or a synthetic id for permission/HIL
 *     events that arrive before any text-delta).
 *   - `liveItems` — the order in which live messages joined the view.
 *     Each item is either a user message (carried in directly) or a
 *     reference into `assistantMessagesById` by id.
 */
function buildMessages(
  history: readonly AgentMessage[],
  events: readonly AgentEvent[],
  liveItems: readonly LiveItem[],
): RuntimeMessage[] {
  const out: RuntimeMessage[] = history.map(historyToRuntime);

  // First pass: scan events into per-message part lists.
  const assistantMessagesById = new Map<string, AssistantMessageBuilder>();
  const partByCallId = new Map<string, Extract<RuntimeMessagePart, { type: 'tool-call' }>>();
  let currentMessageId: string | null = null;

  const ensureMessage = (id: string, createdAt: Date): AssistantMessageBuilder => {
    let m = assistantMessagesById.get(id);
    if (!m) {
      m = { id, parts: [], status: 'running', createdAt };
      assistantMessagesById.set(id, m);
    }
    return m;
  };

  events.forEach((event, index) => {
    switch (event.type) {
      case 'text-delta': {
        currentMessageId = event.messageId;
        const m = ensureMessage(event.messageId, new Date());
        const last = m.parts[m.parts.length - 1];
        if (last && last.type === 'text' && m.status === 'running') {
          last.text += event.text;
        } else {
          m.parts.push({ type: 'text', text: event.text });
        }
        break;
      }
      case 'message-complete': {
        const m = ensureMessage(event.messageId, new Date());
        m.status = 'complete';
        break;
      }
      case 'tool-call': {
        currentMessageId = event.messageId;
        const m = ensureMessage(event.messageId, new Date());
        const part: Extract<RuntimeMessagePart, { type: 'tool-call' }> = {
          type: 'tool-call',
          toolCallId: event.id,
          toolName: event.name,
          args: event.input,
          argsText: stableStringify(event.input),
        };
        m.parts.push(part);
        partByCallId.set(event.id, part);
        break;
      }
      case 'tool-result': {
        const sibling = partByCallId.get(event.id);
        if (sibling) {
          sibling.result = event.output;
          sibling.isError = event.isError;
        } else {
          // Orphan tool-result — synthesize a sibling tool-call part
          // attached to the result's messageId.
          const m = ensureMessage(event.messageId, new Date());
          m.parts.push({
            type: 'tool-call',
            toolCallId: event.id,
            toolName: '(unknown tool)',
            args: undefined,
            argsText: '',
            result: event.output,
            isError: event.isError,
          });
        }
        break;
      }
      case 'file-edit': {
        const m = ensureMessage(event.messageId, new Date());
        m.parts.push({
          type: 'tool-call',
          toolCallId: `__file_edit__:${index}`,
          toolName: FLOWLIB_TOOL_NAMES.fileEdit,
          args: event,
          argsText: '',
        });
        break;
      }
      case 'permission-request': {
        // Permission events have no messageId — attach to the most
        // recent assistant message, or open a synthetic message if
        // there is none yet (rare; means the request fired before any
        // text streamed).
        const targetMessageId = currentMessageId ?? `__sys_${event.id}`;
        const m = ensureMessage(targetMessageId, new Date());
        m.parts.push({
          type: 'tool-call',
          toolCallId: `__permission__:${event.id}`,
          toolName: FLOWLIB_TOOL_NAMES.permission,
          args: event,
          argsText: '',
        });
        break;
      }
      case 'human-input-request': {
        const targetMessageId = currentMessageId ?? `__sys_${event.id}`;
        const m = ensureMessage(targetMessageId, new Date());
        m.parts.push({
          type: 'tool-call',
          toolCallId: `__human_input__:${event.id}`,
          toolName: FLOWLIB_TOOL_NAMES.humanInput,
          args: event,
          argsText: '',
        });
        break;
      }
      case 'session-end': {
        // Mark every still-running message as complete.
        for (const m of assistantMessagesById.values()) {
          if (m.status === 'running') {
            m.status = 'complete';
          }
        }
        break;
      }
    }
  });

  // Second pass: walk liveItems in order, emitting user messages and
  // assistant messages as we encounter them.
  for (const item of liveItems) {
    if (item.kind === 'user') {
      out.push({
        id: item.id,
        role: 'user',
        parts: [{ type: 'text', text: item.text }],
        status: 'complete',
        createdAt: item.createdAt,
      });
    } else {
      const m = assistantMessagesById.get(item.messageId);
      if (m) {
        out.push({
          id: m.id,
          role: 'assistant',
          parts: m.parts.length > 0 ? m.parts : [{ type: 'text', text: '' }],
          status: m.status,
          createdAt: m.createdAt,
        });
      }
    }
  }

  // Surface assistant messages produced by orphan permission / HIL
  // events that never had a corresponding text-delta — they won't
  // appear in liveItems otherwise.
  for (const [id, m] of assistantMessagesById) {
    if (id.startsWith('__sys_') && !out.some((r) => r.id === id)) {
      out.push({
        id,
        role: 'assistant',
        parts: m.parts,
        status: m.status,
        createdAt: m.createdAt,
      });
    }
  }

  return out;
}

type LiveItem =
  | { kind: 'user'; id: string; text: string; createdAt: Date }
  | { kind: 'assistant'; messageId: string; createdAt: Date };

/**
 * Map our `RuntimeMessage` to assistant-ui's `ThreadMessage`. The
 * `parts` array becomes `content`. We cast through `unknown` because
 * assistant-ui's `ThreadMessage` is a discriminated union with
 * role-specific extras (`metadata.steps`, `attachments`, …) that the
 * runtime fills in elsewhere; the narrow object literal we return is
 * structurally compatible with the consumer side.
 */
function convertMessage(m: RuntimeMessage): ThreadMessage {
  if (m.role === 'user') {
    return {
      id: m.id,
      role: 'user',
      content: m.parts.filter((p): p is Extract<RuntimeMessagePart, { type: 'text' }> => p.type === 'text'),
      attachments: [],
      createdAt: m.createdAt,
      metadata: { custom: {}, unstable_data: [] },
    } as unknown as ThreadMessage;
  }
  if (m.role === 'system') {
    return {
      id: m.id,
      role: 'system',
      content: m.parts.filter((p): p is Extract<RuntimeMessagePart, { type: 'text' }> => p.type === 'text'),
      createdAt: m.createdAt,
      metadata: { custom: {} },
    } as unknown as ThreadMessage;
  }
  return {
    id: m.id,
    role: 'assistant',
    content: m.parts,
    status:
      m.status === 'running'
        ? { type: 'running' }
        : { type: 'complete', reason: 'stop' },
    createdAt: m.createdAt,
    metadata: {
      custom: {},
      steps: [],
      unstable_data: [],
      unstable_state: null,
      unstable_annotations: [],
    },
  } as unknown as ThreadMessage;
}

/**
 * Stable JSON.stringify replacement so re-renders of the same `args`
 * object don't produce different `argsText` values. A small
 * recursive sort over plain objects covers the cases we see (tool
 * input shapes are JSON-shaped). Falls back to JSON.stringify for
 * anything exotic.
 */
function stableStringify(value: unknown): string {
  try {
    return JSON.stringify(value, (_, v) => {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const sorted: Record<string, unknown> = {};
        for (const k of Object.keys(v).sort()) {
          sorted[k] = (v as Record<string, unknown>)[k];
        }
        return sorted;
      }
      return v;
    });
  } catch {
    return '';
  }
}

export interface UseAgentRuntimeOptions {
  /** Override API base URL passed through to `useChatStream`. */
  apiBaseUrl?: string;
}

/**
 * Build an assistant-ui `AssistantRuntime` for a single session. The
 * caller mounts `<AssistantRuntimeProvider runtime={runtime}>` keyed
 * by `sessionId` so a thread switch tears down and rebuilds the
 * runtime.
 */
export function useAgentRuntime(sessionId: string, options: UseAgentRuntimeOptions = {}) {
  const messagesQuery = useSessionMessages(sessionId);
  const stream = useChatStream(sessionId, undefined, { apiBaseUrl: options.apiBaseUrl });

  const [liveItems, setLiveItems] = React.useState<LiveItem[]>([]);

  // Append a live placeholder for each new assistant messageId we
  // see in the event stream. The reducer reads parts/status from the
  // events themselves; we only need a single placeholder per
  // messageId so the message takes its slot in `liveItems` order.
  const seenMessageIdsRef = React.useRef<Set<string>>(new Set());
  React.useEffect(() => {
    setLiveItems((prev) => {
      let mutated = false;
      const next = prev.slice();
      for (const event of stream.events) {
        // Tool-call / file-edit / message-complete / etc. all carry a
        // messageId we'd want to slot. Permission / HIL with no
        // currentMessageId fall back to a synthetic id (rare).
        const messageId =
          'messageId' in event && typeof event.messageId === 'string' ? event.messageId : null;
        if (messageId && !seenMessageIdsRef.current.has(messageId)) {
          seenMessageIdsRef.current.add(messageId);
          next.push({ kind: 'assistant', messageId, createdAt: new Date() });
          mutated = true;
        }
      }
      return mutated ? next : prev;
    });
  }, [stream.events.length, stream.events]);

  // Reset live state on thread switch.
  React.useEffect(() => {
    seenMessageIdsRef.current = new Set();
    setLiveItems([]);
  }, [sessionId]);

  const messages = React.useMemo(
    () => buildMessages(messagesQuery.data ?? [], stream.events, liveItems),
    [messagesQuery.data, stream.events, liveItems],
  );

  const isRunning = stream.status === 'streaming';

  const onNew = React.useCallback(
    async (message: AppendMessage) => {
      const text = message.content
        .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text)
        .join('');
      if (!text.trim()) {
        return;
      }
      const id = `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setLiveItems((prev) => [...prev, { kind: 'user', id, text, createdAt: new Date() }]);
      await stream.send(text);
    },
    [stream],
  );

  const onCancel = React.useCallback(async () => {
    stream.interrupt();
  }, [stream]);

  const runtime = useExternalStoreRuntime({
    messages,
    isRunning,
    convertMessage,
    onNew,
    onCancel,
  });

  return {
    runtime,
    /** Underlying chat-stream handle — exposed for permission/HIL UIs. */
    stream,
    /** True while the initial history fetch is in flight. */
    isLoadingHistory: messagesQuery.isLoading,
  };
}
