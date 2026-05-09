/**
 * InputBar — text area + send button + model picker. Enter submits;
 * Shift-Enter inserts a newline. Ctrl/Cmd-Enter is treated identically
 * to Enter (matches most chat clients).
 *
 * The "attach" affordance is rendered as a placeholder button; v1 does
 * not implement file uploads (the contract is upstream — Stream J).
 *
 * `onSend(text)` is called with the trimmed text; empty or whitespace-only
 * submissions are dropped silently.
 *
 * The `Stop` button is only shown when `streaming === true` and calls
 * `onInterrupt()`. The interrupt path is the typed WebSocket message —
 * plumbed through `useChatStream`.
 */
import * as React from 'react';
import { ModelPicker } from './ModelPicker';
import type { AgentProviderId } from '../../shared/types';

export interface InputBarProps {
  onSend: (text: string) => void;
  onInterrupt?: () => void;
  /** True while a turn is in flight. */
  streaming?: boolean;
  /** True when the WS isn't ready yet. */
  disabled?: boolean;
  /** Currently selected model. */
  model?: string | null;
  onModelChange?: (modelId: string) => void;
  providerId?: AgentProviderId;
  /** Override placeholder. */
  placeholder?: string;
}

export const InputBar: React.FC<InputBarProps> = ({
  onSend,
  onInterrupt,
  streaming = false,
  disabled = false,
  model = null,
  onModelChange,
  providerId,
  placeholder,
}) => {
  const [text, setText] = React.useState('');
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);

  const handleSend = React.useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }
    onSend(trimmed);
    setText('');
    // Refocus for chat ergonomics.
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [text, onSend]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter') {
      return;
    }
    if (event.shiftKey) {
      // Newline.
      return;
    }
    event.preventDefault();
    handleSend();
  };

  return (
    <div className="border-t border-fl-border bg-fl-background px-3 py-2">
      <div className="flex items-end gap-2">
        <button
          type="button"
          aria-label="Attach file"
          className="shrink-0 px-2 py-2 rounded text-fl-muted-foreground hover:bg-fl-muted disabled:opacity-50"
          disabled
          title="Attachments — coming soon"
        >
          📎
        </button>
        <textarea
          ref={textareaRef}
          aria-label="Message"
          className="flex-1 min-h-[2.5rem] max-h-48 resize-y border border-fl-border rounded bg-fl-background text-fl-foreground p-2 text-sm focus:outline-none focus:ring-2 focus:ring-fl-ring disabled:opacity-50"
          value={text}
          rows={1}
          disabled={disabled || streaming}
          placeholder={placeholder ?? 'Send a message — Enter to send, Shift-Enter for newline'}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div className="flex flex-col items-end gap-1 shrink-0">
          {onModelChange ? (
            <ModelPicker
              value={model}
              onChange={onModelChange}
              providerId={providerId}
              disabled={streaming}
            />
          ) : null}
          {streaming && onInterrupt ? (
            <button
              type="button"
              onClick={onInterrupt}
              className="px-3 py-1 rounded bg-fl-destructive text-fl-primary-foreground text-sm hover:bg-fl-destructive/90"
              aria-label="Stop generation"
            >
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSend}
              disabled={disabled || streaming || text.trim() === ''}
              className="px-3 py-1 rounded bg-fl-primary text-fl-primary-foreground text-sm hover:bg-fl-primary/90 disabled:opacity-50"
              aria-label="Send"
            >
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

InputBar.displayName = 'InputBar';
