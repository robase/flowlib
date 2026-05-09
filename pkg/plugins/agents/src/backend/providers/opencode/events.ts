/**
 * opencode SSE event → `AgentEvent` mapper.
 *
 * The `@opencode-ai/sdk` server publishes a discriminated union of events
 * over `/event` (SSE). We translate the subset relevant to a single
 * `prompt()` turn into the canonical {@link AgentEvent} union; everything
 * else is dropped.
 *
 * The mapper is **stateless except for a small per-turn cache** kept inside
 * the calling iterator (`runtime.ts`) — that's where we remember which
 * tool-call ids we have already announced (so we don't emit duplicate
 * `tool-call` events from repeated `running`/`completed` `state` updates).
 *
 * This file has zero runtime imports of `@opencode-ai/sdk` — it works off
 * the structural shape of events. That keeps the mapper unit-testable
 * without instantiating an opencode server, and avoids pulling the SDK
 * onto the module-load path.
 *
 * Mapping summary (see `plans/agents/sessions.md`):
 *
 *   message.part.updated  + part.type='text' (delta) → text-delta
 *   message.part.updated  + part.type='tool' status='running'  → tool-call (once per callID)
 *   message.part.updated  + part.type='tool' status='completed' → tool-result + maybe file-edit
 *   message.part.updated  + part.type='tool' status='error'    → tool-result (isError: true)
 *   permission.updated                                          → permission-request
 *   file.edited                                                 → file-edit (synthetic)
 *   message.updated      + info.time.completed                  → message-complete
 *   session.idle                                                → message-complete (terminator)
 *   session.error                                               → session-end { reason: 'error' }
 */

import type { AgentEvent } from '../../../shared/events';

/** Heuristic: tool names we treat as filesystem-modifying. */
const FILE_EDIT_TOOLS = new Set(['write', 'edit', 'multiedit', 'patch', 'create']);

/**
 * Per-turn state threaded through `mapOpencodeEvent`. The orchestrator
 * creates a fresh state for each `prompt()` call. Resetting the state
 * between turns guarantees `tool-call` is emitted exactly once per
 * tool invocation even if opencode publishes multiple `state` updates.
 */
export interface OpencodeMapperState {
  /** Set of tool callIDs we have already announced via `tool-call`. */
  announcedToolCalls: Set<string>;
  /** Set of message ids we have already terminated. */
  completedMessages: Set<string>;
  /** Most recent assistant messageId observed — used by `session.idle`/`session.error`. */
  lastMessageId?: string;
}

export function createMapperState(): OpencodeMapperState {
  return {
    announcedToolCalls: new Set(),
    completedMessages: new Set(),
  };
}

/**
 * Structural shape of the opencode events we consume.  Mirrors
 * `@opencode-ai/sdk`'s `Event` union (`gen/types.gen.d.ts`) but defined
 * locally so the mapper has no runtime dep on the SDK.
 */
export type OpencodeEvent =
  | { type: 'message.updated'; properties: { info: OpencodeMessageInfo } }
  | { type: 'message.part.updated'; properties: { part: OpencodePart; delta?: string } }
  | { type: 'message.part.removed'; properties: { sessionID: string; messageID: string; partID: string } }
  | { type: 'permission.updated'; properties: OpencodePermission }
  | { type: 'permission.replied'; properties: { sessionID: string; permissionID: string; response: string } }
  | { type: 'session.idle'; properties: { sessionID: string } }
  | { type: 'session.error'; properties: { sessionID?: string; error?: OpencodeErrorShape } }
  | { type: 'file.edited'; properties: { file: string } }
  // Catch-all for unmapped events. Kept separate so the typed branches
  // above narrow normally inside `mapOpencodeEvent`.
  | OpencodeUnknownEvent;

/**
 * Catch-all for events we don't surface (`session.created`, `tui.*`, etc).
 * `type` is intentionally `string` here; consumers branch on the typed
 * variants first and fall through to this case for everything else.
 */
export interface OpencodeUnknownEvent {
  type: string;
  properties?: unknown;
}

interface OpencodeMessageInfo {
  id: string;
  role: 'user' | 'assistant';
  sessionID: string;
  time: { created: number; completed?: number };
  tokens?: {
    input: number;
    output: number;
    reasoning: number;
    cache: { read: number; write: number };
  };
  error?: OpencodeErrorShape;
}

interface OpencodeTextPart {
  id: string;
  sessionID: string;
  messageID: string;
  type: 'text';
  text: string;
}

interface OpencodeToolPart {
  id: string;
  sessionID: string;
  messageID: string;
  type: 'tool';
  callID: string;
  tool: string;
  state:
    | { status: 'pending'; input: Record<string, unknown> }
    | { status: 'running'; input: Record<string, unknown>; title?: string }
    | {
        status: 'completed';
        input: Record<string, unknown>;
        output: string;
        title?: string;
        metadata?: Record<string, unknown>;
      }
    | {
        status: 'error';
        input: Record<string, unknown>;
        error: string;
        metadata?: Record<string, unknown>;
      };
}

type OpencodePart =
  | OpencodeTextPart
  | OpencodeToolPart
  | { id: string; sessionID: string; messageID: string; type: string; [k: string]: unknown };

interface OpencodePermission {
  id: string;
  sessionID: string;
  messageID: string;
  callID?: string;
  type: string;
  title: string;
  pattern?: string | string[];
  metadata?: Record<string, unknown>;
}

interface OpencodeErrorShape {
  name: string;
  data?: { message?: string };
}

// ─── Public mapper ──────────────────────────────────────────────────────

/**
 * Translate a single opencode SSE event into zero or more `AgentEvent`s.
 *
 * Returns an array because some events (a tool finishing with a
 * file-modification side effect) fan out to multiple consumer events.
 * Returns an empty array for events we don't surface (`session.created`,
 * `vcs.branch.updated`, lsp/tui chatter, …).
 */
export function mapOpencodeEvent(
  event: OpencodeEvent,
  state: OpencodeMapperState,
): AgentEvent[] {
  // We narrow by `type` then cast `properties` — the union has a
  // catch-all branch so TS widens `properties` to `unknown` across the
  // whole union. The branches below are the authoritative shape.
  const type = event.type;
  const props = event.properties as unknown;

  switch (type) {
    case 'message.part.updated':
      return mapPartUpdated(props as { part: OpencodePart; delta?: string }, state);

    case 'message.updated':
      return mapMessageUpdated(props as { info: OpencodeMessageInfo }, state);

    case 'permission.updated':
      return mapPermission(props as OpencodePermission);

    case 'file.edited':
      return mapFileEdited(props as { file: string }, state);

    case 'session.idle':
      return mapSessionIdle(state);

    case 'session.error':
      return mapSessionError(props as { error?: OpencodeErrorShape });

    default:
      return [];
  }
}

// ─── Per-event branches ─────────────────────────────────────────────────

function mapPartUpdated(
  props: { part: OpencodePart; delta?: string },
  state: OpencodeMapperState,
): AgentEvent[] {
  const part = props.part;
  if (!part || typeof part !== 'object') return [];

  // Track the most-recent assistant message so terminators (idle/error) can
  // attach a sensible messageId.
  state.lastMessageId = part.messageID;

  if (part.type === 'text') {
    const textPart = part as OpencodeTextPart;
    // Prefer delta when the SDK provides one (incremental); fall back to
    // the cumulative `text` field if not (full-replace updates).
    const text = typeof props.delta === 'string' && props.delta.length > 0
      ? props.delta
      : textPart.text;
    if (!text) return [];
    return [{ type: 'text-delta', messageId: textPart.messageID, text }];
  }

  if (part.type === 'tool') {
    return mapToolPart(part as OpencodeToolPart, state);
  }

  return [];
}

function mapToolPart(part: OpencodeToolPart, state: OpencodeMapperState): AgentEvent[] {
  const out: AgentEvent[] = [];
  const callId = part.callID;
  const messageId = part.messageID;

  // Announce the tool call exactly once. The SDK may emit `pending` →
  // `running` → `completed`; we want a single `tool-call` event.
  if (!state.announcedToolCalls.has(callId)) {
    state.announcedToolCalls.add(callId);
    out.push({
      type: 'tool-call',
      messageId,
      id: callId,
      name: part.tool,
      input: part.state.input,
    });
  }

  if (part.state.status === 'completed') {
    out.push({
      type: 'tool-result',
      messageId,
      id: callId,
      output: part.state.output,
    });
    // Synthesise `file-edit` for filesystem-modifying tools when we can
    // recover a path from the input shape. We don't know `before`/`after`
    // contents here — those come via `file.edited` if at all. This event
    // is the "the agent just modified X" beat the UI uses.
    const path = filePathFromToolInput(part.tool, part.state.input);
    if (path) {
      out.push({ type: 'file-edit', messageId, path });
    }
  } else if (part.state.status === 'error') {
    out.push({
      type: 'tool-result',
      messageId,
      id: callId,
      output: part.state.error,
      isError: true,
    });
  }

  return out;
}

function mapMessageUpdated(
  props: { info: OpencodeMessageInfo },
  state: OpencodeMapperState,
): AgentEvent[] {
  const info = props.info;
  if (!info || info.role !== 'assistant') return [];
  if (info.time?.completed === undefined) return [];
  if (state.completedMessages.has(info.id)) return [];

  state.completedMessages.add(info.id);
  state.lastMessageId = info.id;

  return [
    {
      type: 'message-complete',
      messageId: info.id,
      ...(info.tokens
        ? {
            usage: {
              inputTokens: info.tokens.input,
              outputTokens: info.tokens.output,
            },
          }
        : {}),
    },
  ];
}

function mapPermission(props: OpencodePermission): AgentEvent[] {
  // opencode v1 surfaces permission requests via `permission.updated`
  // even though we declare `permissionPrompts: false`. If the platform
  // ever flips a per-org flag to honour them, the consumer will see
  // proper events without a mapper change.
  return [
    {
      type: 'permission-request',
      id: props.id,
      tool: props.type,
      input: { title: props.title, pattern: props.pattern, metadata: props.metadata },
    },
  ];
}

function mapFileEdited(
  props: { file: string },
  state: OpencodeMapperState,
): AgentEvent[] {
  if (!props.file) return [];
  return [
    {
      type: 'file-edit',
      messageId: state.lastMessageId ?? '',
      path: props.file,
    },
  ];
}

function mapSessionIdle(state: OpencodeMapperState): AgentEvent[] {
  // `session.idle` is opencode's "turn finished" signal. If we already
  // emitted a `message-complete` from `message.updated`, suppress this
  // one to avoid duplicates.
  const messageId = state.lastMessageId;
  if (!messageId) return [];
  if (state.completedMessages.has(messageId)) return [];
  state.completedMessages.add(messageId);
  return [{ type: 'message-complete', messageId }];
}

function mapSessionError(props: {
  error?: OpencodeErrorShape;
}): AgentEvent[] {
  const message =
    props.error?.data?.message ??
    props.error?.name ??
    'opencode session error';
  return [{ type: 'session-end', reason: 'error', error: message }];
}

// ─── Helpers ────────────────────────────────────────────────────────────

/**
 * Best-effort recovery of the file path from a tool-call input object.
 *
 * opencode's first-party file tools (Write, Edit, MultiEdit, Patch, …)
 * expose the path as `file_path` or `path`. Third-party MCP tools may
 * use other keys; we deliberately do not hand-maintain a long shape
 * map — false negatives here just mean the UI doesn't show a `file-edit`
 * card, which is acceptable. The `file.edited` event from the watcher
 * is the authoritative signal.
 */
function filePathFromToolInput(tool: string, input: Record<string, unknown>): string | undefined {
  if (!FILE_EDIT_TOOLS.has(tool.toLowerCase())) return undefined;
  const candidates = ['file_path', 'path', 'filepath'];
  for (const key of candidates) {
    const v = input?.[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}
