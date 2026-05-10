/**
 * MessageBubble — renders a single user/assistant text message.
 *
 * v1 renders plain text with whitespace pre-wrapped + paragraph splits on
 * blank lines. We intentionally avoid pulling in a markdown library here:
 *
 * - Keeps the chat surface dependency-free (no `react-markdown`,
 *   `react-syntax-highlighter`, `remark-gfm`).
 * - Plays nicely with the existing tsdown/build pipeline, which already
 *   marks `react`, `react-dom`, and `agents` as `neverBundle`.
 *
 * **Upgrade path**: drop in `react-markdown` + a syntax highlighter behind
 * the same component boundary. Consumers don't need to change anything —
 * `MessageBubble` is the single entry for assistant text rendering.
 *
 * Theme tokens follow the repo's `fl-*` convention (the canonical name in
 * `pkg/ui/src/app.css`). The brief's `imp-*` references are an older alias.
 */
import * as React from 'react';

export interface MessageBubbleProps {
  /** Message author. `system` is rendered as a small italic note. */
  role: 'user' | 'assistant' | 'system';
  /** Message text. Streaming consumers may pass partial text. */
  text: string;
  /**
   * When the assistant bubble is currently streaming, an inline cursor
   * shows after the last character. Purely cosmetic.
   */
  streaming?: boolean;
  /**
   * Optional id used as a stable React key when bubbles are rebuilt from
   * an event stream. Not consumed by the bubble itself.
   */
  id?: string;
}

/**
 * Splits text into paragraphs on blank lines while preserving whitespace
 * inside each paragraph. This is the v1 substitute for markdown.
 */
export function splitParagraphs(text: string): string[] {
  if (!text) {
    return [];
  }
  // Normalise CRLF and split on 2+ newlines.
  return text.replace(/\r\n/g, '\n').split(/\n{2,}/);
}

const roleStyles: Record<MessageBubbleProps['role'], string> = {
  user: 'self-end max-w-[80%] rounded-lg bg-fl-primary text-fl-primary-foreground px-3 py-2',
  assistant:
    'self-start max-w-[80%] rounded-lg bg-fl-card text-fl-card-foreground border border-fl-border px-3 py-2',
  system: 'self-center max-w-[80%] text-xs italic text-fl-muted-foreground px-3 py-1',
};

export const MessageBubble: React.FC<MessageBubbleProps> = ({ role, text, streaming = false }) => {
  const paragraphs = splitParagraphs(text);
  return (
    <div
      className={`flex flex-col gap-1 ${roleStyles[role]}`}
      data-role={role}
      data-streaming={streaming ? 'true' : undefined}
    >
      {paragraphs.length === 0 && streaming ? (
        <span className="inline-block w-2 h-4 bg-fl-foreground/60 animate-pulse" />
      ) : null}
      {paragraphs.map((p, i) => (
        <p key={i} className="whitespace-pre-wrap text-sm leading-relaxed m-0">
          {p}
          {streaming && i === paragraphs.length - 1 ? (
            <span className="inline-block w-2 h-4 ml-0.5 align-text-bottom bg-fl-foreground/60 animate-pulse" />
          ) : null}
        </p>
      ))}
    </div>
  );
};

MessageBubble.displayName = 'MessageBubble';
