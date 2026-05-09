/**
 * `SDKMessage` → `AgentEvent` mapper for the Claude Code provider.
 *
 * Pure, side-effect-free translation. The provider's `prompt()` drains
 * the SDK's `AsyncGenerator<SDKMessage>` and pipes each message through
 * `mapSdkMessage` to produce zero or more `AgentEvent`s.
 *
 * Mapping table — keep in sync with `plans/agents/sessions.md`:
 *
 * | SDKMessage                                  | AgentEvent                  |
 * | ------------------------------------------- | --------------------------- |
 * | `assistant` (`text` content block)          | `text-delta` (one per turn) |
 * | `assistant` (`tool_use` content block)      | `tool-call`                 |
 * | `user` (`tool_result` content block)        | `tool-result`               |
 * | `result` (success or error)                 | `message-complete`          |
 * | `system` (`init` / subagent_* / …)          | swallowed                   |
 *
 * `permission-request` is emitted by the runtime out of the
 * `canUseTool` callback, not from `SDKMessage`s, so it doesn't appear
 * in this mapper. Same story for `file-edit` (synthesised from a
 * matching `Write` / `Edit` tool-use + tool-result pair).
 *
 * Type approach: we don't import `SDKMessage` at module top level
 * because the SDK is a lazy `import()`. The mapper accepts a
 * structurally-typed shape that captures only the fields we touch.
 * Keeping it structural means the mapper is unit-testable from
 * hand-built fixtures without dragging the real SDK into the test.
 */

import type {
  AgentEvent,
  TextDeltaEvent,
  ToolCallEvent,
  ToolResultEvent,
  MessageCompleteEvent,
} from '../../../shared/events';

// ─── Structural types — narrow subset of the SDK shape ────────────────

/**
 * Subset of `BetaContentBlock` we read. Real SDK has many more variants
 * (`thinking`, `redacted_thinking`, server tools, MCP, …) — we ignore
 * everything we don't recognise so unknown blocks don't crash the loop.
 */
type AssistantContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: string; [key: string]: unknown };

/**
 * Subset of `BetaToolResultBlockParam` we read off a `user` SDK message.
 * The SDK serialises tool results as content blocks on user-role
 * messages — see Anthropic's tool-use docs.
 */
type ToolResultContentBlock =
  | {
      type: 'tool_result';
      tool_use_id: string;
      content?: unknown;
      is_error?: boolean;
    }
  | { type: string; [key: string]: unknown };

/** Structural `SDKAssistantMessage`. */
interface AssistantMessage {
  type: 'assistant';
  message: {
    id?: string;
    content?: ReadonlyArray<AssistantContentBlock>;
  };
  parent_tool_use_id?: string | null;
  uuid?: string;
}

/** Structural `SDKUserMessage` carrying tool results. */
interface UserMessage {
  type: 'user';
  message: {
    content?: ReadonlyArray<ToolResultContentBlock> | string;
  };
  parent_tool_use_id?: string | null;
  uuid?: string;
}

/** Structural `SDKResultMessage` (success or error). */
interface ResultMessage {
  type: 'result';
  subtype?: 'success' | 'error_max_turns' | 'error_during_execution' | string;
  is_error?: boolean;
  /** ID of the final assistant message in the turn (if any). */
  uuid?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

/** Structural `SDKSystemMessage` (init / subagent_*). */
interface SystemMessage {
  type: 'system';
  subtype?: string;
}

/**
 * Public structural type — anything with a `type` discriminator. The
 * mapper switches on `type` and falls through unrecognised shapes.
 */
export type SdkMessageLike =
  | AssistantMessage
  | UserMessage
  | ResultMessage
  | SystemMessage
  | { type: string; [key: string]: unknown };

// ─── Logger surface — match `SessionLogger` minus required fields ─────

/** Minimal logger so the mapper can be called from anywhere. */
export interface MapperLogger {
  debug?(message: string, meta?: Record<string, unknown>): void;
  warn?(message: string, meta?: Record<string, unknown>): void;
}

// ─── Mapper ────────────────────────────────────────────────────────────

/**
 * Translate a single SDK message into zero or more `AgentEvent`s.
 *
 * The current message id is required because the SDK's content-block
 * grouping is per-message: a single `assistant` message may carry one
 * text block + several `tool_use` blocks, and consumers correlate them
 * via `messageId`. The provider supplies a stable id (from
 * `message.id` or `uuid`) so all blocks from one SDK message share it.
 */
export function mapSdkMessage(
  msg: SdkMessageLike,
  logger?: MapperLogger,
): AgentEvent[] {
  switch (msg.type) {
    case 'assistant':
      return mapAssistantMessage(msg as AssistantMessage);

    case 'user':
      return mapUserMessage(msg as UserMessage);

    case 'result':
      return mapResultMessage(msg as ResultMessage);

    case 'system':
      // System init / subagent_* / status events — informational only.
      // We log at debug; consumers wire to observability if needed.
      logger?.debug?.('[agents/claude-code] system message', {
        subtype: (msg as SystemMessage).subtype,
      });
      return [];

    default:
      // Unknown / future SDK message types — log + swallow rather than
      // crash. The SDK ships many event shapes we don't model
      // (`stream_event`, `auth_status`, `task_*`, …) and forward
      // compatibility means treating unknowns as no-ops.
      logger?.debug?.('[agents/claude-code] unhandled sdk message', {
        type: msg.type,
      });
      return [];
  }
}

function resolveAssistantMessageId(msg: AssistantMessage): string {
  return msg.message?.id ?? msg.uuid ?? cryptoRandomId();
}

function mapAssistantMessage(msg: AssistantMessage): AgentEvent[] {
  const messageId = resolveAssistantMessageId(msg);
  const blocks = msg.message?.content ?? [];
  const events: AgentEvent[] = [];

  for (const block of blocks) {
    if (block.type === 'text') {
      const text = (block as { text?: string }).text ?? '';
      // Skip empty deltas — they add nothing for consumers and can
      // confuse the UI. The SDK occasionally emits an empty trailing
      // text block on stop.
      if (text.length === 0) {continue;}
      const ev: TextDeltaEvent = { type: 'text-delta', messageId, text };
      events.push(ev);
      continue;
    }

    if (block.type === 'tool_use') {
      const tu = block as { id: string; name: string; input: unknown };
      const ev: ToolCallEvent = {
        type: 'tool-call',
        messageId,
        id: tu.id,
        name: tu.name,
        input: tu.input,
      };
      events.push(ev);
      continue;
    }

    // Other block types (`thinking`, server tools, MCP) — silently
    // dropped. The SDK still surfaces the underlying activity through
    // tool_use/tool_result for blocks we care about.
  }

  return events;
}

function mapUserMessage(msg: UserMessage): AgentEvent[] {
  const content = msg.message?.content;
  if (!content || typeof content === 'string') {return [];}
  // The matching message id for a tool result is the parent assistant
  // message that issued the call. The SDK exposes this on
  // `parent_tool_use_id` when the user message is a tool result, but
  // it can also be reconstructed from the tool-use id chain in
  // consumers. We emit `messageId` as the parent_tool_use_id when
  // present, falling back to the user message's own uuid.
  const messageId =
    msg.parent_tool_use_id ?? msg.uuid ?? cryptoRandomId();
  const events: AgentEvent[] = [];

  for (const block of content) {
    if (block.type !== 'tool_result') {continue;}
    const tr = block as {
      tool_use_id: string;
      content?: unknown;
      is_error?: boolean;
    };
    const ev: ToolResultEvent = {
      type: 'tool-result',
      messageId,
      id: tr.tool_use_id,
      output: tr.content,
      ...(tr.is_error ? { isError: true } : {}),
    };
    events.push(ev);
  }

  return events;
}

function mapResultMessage(msg: ResultMessage): AgentEvent[] {
  const messageId = msg.uuid ?? cryptoRandomId();
  const usage = msg.usage;
  const ev: MessageCompleteEvent = {
    type: 'message-complete',
    messageId,
    ...(usage && (usage.input_tokens != null || usage.output_tokens != null)
      ? {
          usage: {
            inputTokens: usage.input_tokens ?? 0,
            outputTokens: usage.output_tokens ?? 0,
          },
        }
      : {}),
  };
  return [ev];
}

// ─── Utilities ─────────────────────────────────────────────────────────

/**
 * Last-resort id generator when the SDK message lacks any id.
 * `crypto.randomUUID()` is available on Node 18+ and Workers.
 */
function cryptoRandomId(): string {
  // Lazy + defensive — older runtimes may not expose `crypto.randomUUID`.
  const c =
    typeof globalThis !== 'undefined'
      ? (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
      : undefined;
  return c?.randomUUID?.() ?? `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ─── File-edit synthesis ───────────────────────────────────────────────

/**
 * Detects whether a `tool-call` is a file-edit-shaped operation (Claude
 * Code's `Write` / `Edit` / `MultiEdit`). Used by the runtime to pair a
 * tool-call with the matching tool-result and synthesise a `file-edit`
 * event when the result indicates success.
 *
 * v1 ships best-effort detection only. The SDK natively surfaces
 * file-change events through the `FileChanged` hook (see
 * `HOOK_EVENTS`); a future iteration should subscribe to that hook
 * for ground-truth instead of inferring from tool inputs.
 */
export function isFileEditTool(name: string): boolean {
  return name === 'Write' || name === 'Edit' || name === 'MultiEdit';
}

/**
 * Best-effort `path` extraction from a file-edit tool input. Returns
 * `undefined` if the shape doesn't match.
 */
export function extractFileEditPath(input: unknown): string | undefined {
  if (typeof input !== 'object' || input === null) {return undefined;}
  const rec = input as Record<string, unknown>;
  // Claude Code's Write/Edit tools both use `file_path`.
  const fp = rec.file_path;
  return typeof fp === 'string' ? fp : undefined;
}

/**
 * Best-effort `before` / `after` extraction from a file-edit tool
 * input. Returns `{}` when the SDK didn't supply enough info.
 *
 * - `Write { file_path, content }` → `{ after: content }`
 * - `Edit { file_path, old_string, new_string }` → `{ before: old_string, after: new_string }`
 *   (snippet-level, not whole-file — sufficient for diff rendering)
 * - `MultiEdit` → first edit's strings (renderer can fetch the full
 *    after-state from the workspace if needed)
 */
export function extractFileEditContents(
  toolName: string,
  input: unknown,
): { before?: string; after?: string } {
  if (typeof input !== 'object' || input === null) {return {};}
  const rec = input as Record<string, unknown>;

  if (toolName === 'Write') {
    const content = rec.content;
    return typeof content === 'string' ? { after: content } : {};
  }

  if (toolName === 'Edit') {
    const oldS = rec.old_string;
    const newS = rec.new_string;
    return {
      ...(typeof oldS === 'string' ? { before: oldS } : {}),
      ...(typeof newS === 'string' ? { after: newS } : {}),
    };
  }

  if (toolName === 'MultiEdit') {
    const edits = rec.edits;
    if (Array.isArray(edits) && edits.length > 0) {
      const first = edits[0] as Record<string, unknown>;
      const oldS = first?.old_string;
      const newS = first?.new_string;
      return {
        ...(typeof oldS === 'string' ? { before: oldS } : {}),
        ...(typeof newS === 'string' ? { after: newS } : {}),
      };
    }
    return {};
  }

  return {};
}
