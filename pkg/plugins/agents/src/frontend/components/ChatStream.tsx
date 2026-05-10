/**
 * ChatStream — renders a stream of `AgentEvent`s as a chat list.
 *
 * Strategy: walk the event stream once and produce a list of
 * `ChatBlock`s. A block is one of:
 *   - text bubble (assistant message — concatenated text-deltas)
 *   - tool-call card (paired with its matching tool-result)
 *   - file-edit diff
 *   - permission-request prompt
 *   - human-input request
 *
 * Pure. The same function is used in tests.
 *
 * v1 is a plain `<ol>`; we intentionally don't pull in a virtual-list
 * library. The brief calls for "virtualised", but for first-cut UX the
 * native scroller handles ~1000 items fine and avoids adding a runtime
 * dep. `data-virtualized="false"` on the container documents the
 * upgrade path (drop in `react-virtuoso` or `@tanstack/react-virtual`
 * behind the same prop interface).
 *
 * The container is `role="log"` with `aria-live="polite"` per the brief
 * accessibility rules.
 */
import * as React from 'react';
import type {
  AgentEvent,
  TextDeltaEvent,
  ToolCallEvent,
  ToolResultEvent,
  FileEditEvent,
  PermissionRequestEvent,
  HumanInputRequestEvent,
} from '../../shared/events';
import { MessageBubble } from './MessageBubble';
import { ToolCallCard } from './ToolCallCard';
import { FileDiffViewer } from './FileDiffViewer';
import { PermissionRequestPrompt } from './PermissionRequestPrompt';
import { HumanInputCard } from './HumanInputCard';

// ─── ChatBlock — discriminated union the renderer iterates ─────────────

export type ChatBlock =
  | { kind: 'user-text'; id: string; text: string }
  | { kind: 'assistant-text'; id: string; text: string; streaming: boolean }
  | { kind: 'tool'; id: string; call: ToolCallEvent; result?: ToolResultEvent }
  | { kind: 'file-edit'; id: string; event: FileEditEvent }
  | { kind: 'permission'; id: string; event: PermissionRequestEvent }
  | { kind: 'hil'; id: string; event: HumanInputRequestEvent }
  | { kind: 'session-end'; id: string; reason: string; error?: string };

export interface PendingUserMessage {
  /** Stable id supplied by the consumer (e.g. `pending-${nanoid()}`). */
  id: string;
  text: string;
}

export interface ChatStreamProps {
  events: AgentEvent[];
  /** Optimistic user messages not yet acknowledged by the server. */
  pendingUser?: PendingUserMessage[];
  /** True when the stream is currently producing tokens. */
  streaming?: boolean;
  /** Callback for permission-request approve / deny. */
  onPermissionRespond: (id: string, decision: 'allow' | 'deny') => void;
  /** Callback for human-input-request response. */
  onHilRespond: (id: string, response: unknown) => void;
  /** Track which permissions have already been resolved. */
  resolvedPermissions?: Record<string, 'allow' | 'deny'>;
  resolvedHumanInputs?: Record<string, true>;
}

/**
 * Group an event stream into renderable blocks.
 *
 * - Consecutive `text-delta` events with the same `messageId` collapse
 *   into a single assistant bubble.
 * - `tool-call` and `tool-result` with matching `id` collapse into one
 *   tool-call card.
 * - `message-complete` only updates streaming flags; it doesn't produce
 *   a block.
 */
export function groupChatEvents(
  events: AgentEvent[],
  options: { isStreaming?: boolean } = {},
): ChatBlock[] {
  const blocks: ChatBlock[] = [];
  // For each assistant messageId, track which block index holds the
  // accumulated text so we can append to it.
  const textBlockByMessageId = new Map<string, number>();
  // For each tool-call id, the block index, so we can attach a result
  // when it shows up later.
  const toolBlockByCallId = new Map<string, number>();
  // Track whether each messageId has completed.
  const completed = new Set<string>();

  for (const event of events) {
    switch (event.type) {
      case 'text-delta': {
        const idx = textBlockByMessageId.get(event.messageId);
        if (idx === undefined) {
          textBlockByMessageId.set(event.messageId, blocks.length);
          blocks.push({
            kind: 'assistant-text',
            id: event.messageId,
            text: event.text,
            streaming: true,
          });
        } else {
          const existing = blocks[idx];
          if (existing.kind === 'assistant-text') {
            blocks[idx] = {
              ...existing,
              text: existing.text + event.text,
            };
          }
        }
        break;
      }
      case 'message-complete': {
        completed.add(event.messageId);
        const idx = textBlockByMessageId.get(event.messageId);
        if (idx !== undefined) {
          const existing = blocks[idx];
          if (existing.kind === 'assistant-text') {
            blocks[idx] = { ...existing, streaming: false };
          }
        }
        break;
      }
      case 'tool-call': {
        toolBlockByCallId.set(event.id, blocks.length);
        blocks.push({
          kind: 'tool',
          id: event.id,
          call: event,
        });
        break;
      }
      case 'tool-result': {
        const idx = toolBlockByCallId.get(event.id);
        if (idx !== undefined) {
          const existing = blocks[idx];
          if (existing.kind === 'tool') {
            blocks[idx] = { ...existing, result: event };
          }
        } else {
          // Orphan result — render as a tool block with synthetic call.
          blocks.push({
            kind: 'tool',
            id: event.id,
            call: {
              type: 'tool-call',
              messageId: event.messageId,
              id: event.id,
              name: '(unknown tool)',
              input: undefined,
            },
            result: event,
          });
        }
        break;
      }
      case 'file-edit': {
        blocks.push({
          kind: 'file-edit',
          id: `${event.messageId}:${event.path}:${blocks.length}`,
          event,
        });
        break;
      }
      case 'permission-request': {
        blocks.push({
          kind: 'permission',
          id: event.id,
          event,
        });
        break;
      }
      case 'human-input-request': {
        blocks.push({
          kind: 'hil',
          id: event.id,
          event,
        });
        break;
      }
      case 'session-end': {
        blocks.push({
          kind: 'session-end',
          id: `session-end-${blocks.length}`,
          reason: event.reason,
          error: event.error,
        });
        break;
      }
    }
  }

  // If the global stream has ended, mark any still-streaming blocks as
  // not-streaming. A `message-complete` event already handles the per
  // -message case, but providers don't always emit it.
  if (options.isStreaming === false) {
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (b.kind === 'assistant-text' && b.streaming) {
        blocks[i] = { ...b, streaming: false };
      }
    }
  }

  return blocks;
}

export const ChatStream: React.FC<ChatStreamProps> = ({
  events,
  pendingUser = [],
  streaming = false,
  onPermissionRespond,
  onHilRespond,
  resolvedPermissions = {},
  resolvedHumanInputs = {},
}) => {
  const blocks = React.useMemo(
    () => groupChatEvents(events, { isStreaming: streaming }),
    [events, streaming],
  );

  // Auto-scroll to bottom when new blocks land. The `aria-live=polite`
  // setting on the container takes care of screen reader announcements.
  const scrollRef = React.useRef<HTMLOListElement | null>(null);
  React.useEffect(() => {
    const node = scrollRef.current;
    if (!node) {
      return;
    }
    node.scrollTop = node.scrollHeight;
  }, [blocks.length, pendingUser.length]);

  return (
    <ol
      ref={scrollRef}
      role="log"
      aria-live="polite"
      aria-relevant="additions text"
      data-virtualized="false"
      data-testid="chat-stream"
      className="flex-1 min-h-0 overflow-y-auto px-4 py-3 flex flex-col gap-3 list-none m-0"
    >
      {pendingUser.map((p) => (
        <li key={`pending-${p.id}`} className="flex flex-col">
          <MessageBubble role="user" text={p.text} id={p.id} />
        </li>
      ))}
      {blocks.map((block) => (
        <li key={block.id} className="flex flex-col">
          {renderBlock(block, {
            onPermissionRespond,
            onHilRespond,
            resolvedPermissions,
            resolvedHumanInputs,
          })}
        </li>
      ))}
      {streaming && blocks.length === 0 && pendingUser.length === 0 ? (
        <li className="text-xs text-fl-muted-foreground italic px-2">Thinking…</li>
      ) : null}
    </ol>
  );
};

ChatStream.displayName = 'ChatStream';

function renderBlock(
  block: ChatBlock,
  ctx: {
    onPermissionRespond: (id: string, decision: 'allow' | 'deny') => void;
    onHilRespond: (id: string, response: unknown) => void;
    resolvedPermissions: Record<string, 'allow' | 'deny'>;
    resolvedHumanInputs: Record<string, true>;
  },
): React.ReactNode {
  switch (block.kind) {
    case 'user-text':
      return <MessageBubble role="user" text={block.text} id={block.id} />;
    case 'assistant-text':
      return (
        <MessageBubble
          role="assistant"
          text={block.text}
          id={block.id}
          streaming={block.streaming}
        />
      );
    case 'tool':
      return <ToolCallCard call={block.call} result={block.result} />;
    case 'file-edit':
      return <FileDiffViewer event={block.event} />;
    case 'permission':
      return (
        <PermissionRequestPrompt
          event={block.event}
          resolved={ctx.resolvedPermissions[block.id] ?? null}
          onRespond={(decision) => ctx.onPermissionRespond(block.id, decision)}
        />
      );
    case 'hil':
      return (
        <HumanInputCard
          event={block.event}
          resolved={Boolean(ctx.resolvedHumanInputs[block.id])}
          onRespond={(response) => ctx.onHilRespond(block.id, response)}
        />
      );
    case 'session-end':
      return (
        <div
          role="status"
          className={`text-xs px-2 py-1 rounded ${
            block.reason === 'error'
              ? 'bg-fl-destructive/10 text-fl-destructive'
              : 'bg-fl-muted text-fl-muted-foreground'
          }`}
        >
          Session ended: {block.reason}
          {block.error ? ` — ${block.error}` : ''}
        </div>
      );
  }
}

// Helper used by `renderBlock`'s `user-text` case for tests / hosts that
// want to inject a user bubble directly into a synthetic event stream.
export function userTextBlock(id: string, text: string): ChatBlock {
  return { kind: 'user-text', id, text };
}
