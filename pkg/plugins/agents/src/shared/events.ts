/**
 * The `AgentEvent` union — the canonical event shape every provider streams.
 *
 * Provider adapters (Claude Code, opencode, raw-LLM, …) translate their
 * native event format into this union before yielding. UI components,
 * persistence, hooks, and the DO transport all consume `AgentEvent`
 * directly so a new provider drops in without touching any consumer.
 *
 * See `plans/agents/sessions.md` for the per-provider mapping table.
 */
export type AgentEvent =
  | TextDeltaEvent
  | ToolCallEvent
  | ToolResultEvent
  | FileEditEvent
  | PermissionRequestEvent
  | HumanInputRequestEvent
  | MessageCompleteEvent
  | SessionEndEvent;

/** A streamed chunk of assistant text. Concatenate by `messageId`. */
export interface TextDeltaEvent {
  type: 'text-delta';
  /** Stable id for the assistant message currently streaming. */
  messageId: string;
  /** The new text fragment to append. */
  text: string;
}

/** Provider invoked a tool. The follow-up `tool-result` shares the same `id`. */
export interface ToolCallEvent {
  type: 'tool-call';
  /** Parent assistant message that issued the call. */
  messageId: string;
  /** Provider-supplied tool-call id, used to correlate with the result. */
  id: string;
  /** Tool name as the provider sees it (e.g. `gmail_send_message`). */
  name: string;
  /** Validated tool input. Typed `unknown` because it varies per tool. */
  input: unknown;
}

/** Output from a tool call. */
export interface ToolResultEvent {
  type: 'tool-result';
  messageId: string;
  /** Matches the originating `ToolCallEvent.id`. */
  id: string;
  output: unknown;
  /** True when the tool threw or returned an explicit error. */
  isError?: boolean;
}

/**
 * The agent edited a file in the workspace.
 *
 * Emitted by:
 * - Claude Code's PostToolUse hook on `Write` / `Edit` / `MultiEdit`
 * - opencode's file-modification tool result, synthesised by the events mapper
 */
export interface FileEditEvent {
  type: 'file-edit';
  messageId: string;
  /** Workspace-relative path of the file the agent touched. */
  path: string;
  /** Pre-edit contents. Omitted when the file was newly created. */
  before?: string;
  /** Post-edit contents. Omitted when the file was deleted. */
  after?: string;
}

/**
 * Provider is asking the user to approve a tool call.
 *
 * Emitted by Claude Code's `canUseTool` callback when `permissionMode` is
 * `default` (vs. `acceptEdits` or `plan`). The frontend renders a permission
 * card and replies with allow/deny via the WebSocket.
 */
export interface PermissionRequestEvent {
  type: 'permission-request';
  /** Stable id, used by the client when replying. */
  id: string;
  tool: string;
  input: unknown;
}

/**
 * Agent paused waiting for human input (HIL — see `plans/agents/hil.md`).
 *
 * `blocking: true` halts the loop until the user responds; `blocking: false`
 * is fire-and-forget (the agent continues but the user can intervene).
 */
export interface HumanInputRequestEvent {
  type: 'human-input-request';
  id: string;
  prompt: string;
  blocking: boolean;
}

/** A single assistant message finished streaming. */
export interface MessageCompleteEvent {
  type: 'message-complete';
  messageId: string;
  /** Provider-reported token usage for the message, when available. */
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

/** Whole session ended — reason indicates how. */
export interface SessionEndEvent {
  type: 'session-end';
  reason: 'stopped' | 'max-turns' | 'error' | 'completed';
  /** Set when `reason === 'error'`. */
  error?: string;
}

/** Narrowed type-guards for individual event variants. */
export const isAgentEvent = (value: unknown): value is AgentEvent => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const t = (value as { type?: unknown }).type;
  return (
    t === 'text-delta' ||
    t === 'tool-call' ||
    t === 'tool-result' ||
    t === 'file-edit' ||
    t === 'permission-request' ||
    t === 'human-input-request' ||
    t === 'message-complete' ||
    t === 'session-end'
  );
};
