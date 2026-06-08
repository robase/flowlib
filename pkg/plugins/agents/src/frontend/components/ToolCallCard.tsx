/**
 * ToolCallCard — collapsible card pairing a `tool-call` with its
 * matching `tool-result`.
 *
 * The card is collapsed by default. Clicking the header (or pressing
 * Enter / Space) toggles expansion to reveal the input JSON and, when
 * present, the result. Errors are surfaced with a red ring.
 *
 * The card is purely presentational; correlation with the result event
 * happens in `groupChatEvents` (see `useChatStream`). The matched
 * result is passed in as `result`.
 */
import * as React from 'react';
import type { ToolCallEvent, ToolResultEvent } from '../../shared/events';

export interface ToolCallCardProps {
  call: ToolCallEvent;
  /** Matching tool-result. Undefined while still in flight. */
  result?: ToolResultEvent;
  /** Force-expanded state. Useful in tests. */
  defaultOpen?: boolean;
}

export const ToolCallCard: React.FC<ToolCallCardProps> = ({
  call,
  result,
  defaultOpen = false,
}) => {
  const [open, setOpen] = React.useState(defaultOpen);

  const isError = result?.isError === true;
  const isPending = result === undefined;

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setOpen((prev) => !prev);
    }
  };

  const statusLabel = isPending ? 'running…' : isError ? 'error' : 'done';

  return (
    <div
      className={`rounded border ${
        isError ? 'border-destructive' : 'border-border'
      } bg-card text-card-foreground my-2`}
      data-testid="tool-call-card"
      data-tool={call.name}
      data-status={statusLabel}
    >
      <button
        type="button"
        className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring rounded"
        aria-expanded={open}
        aria-controls={`tool-${call.id}-body`}
        onClick={() => setOpen((prev) => !prev)}
        onKeyDown={onKeyDown}
      >
        <span className="flex items-center gap-2 min-w-0">
          <span aria-hidden="true" className="inline-block w-3 text-muted-foreground">
            {open ? '▾' : '▸'}
          </span>
          <span className="font-mono text-xs truncate">{call.name}</span>
        </span>
        <span className="text-xs text-muted-foreground ml-2 shrink-0">{statusLabel}</span>
      </button>
      {open ? (
        <div id={`tool-${call.id}-body`} className="px-3 py-2 border-t border-border space-y-2">
          <ToolPayloadBlock label="input" value={call.input} />
          {result ? (
            <ToolPayloadBlock
              label={isError ? 'error' : 'output'}
              value={result.output}
              error={isError}
            />
          ) : (
            <p className="text-xs text-muted-foreground italic">Awaiting tool result…</p>
          )}
        </div>
      ) : null}
    </div>
  );
};

ToolCallCard.displayName = 'ToolCallCard';

const ToolPayloadBlock: React.FC<{
  label: string;
  value: unknown;
  error?: boolean;
}> = ({ label, value, error }) => (
  <div>
    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    <pre
      className={`text-xs whitespace-pre-wrap break-words font-mono p-2 rounded ${
        error ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground'
      }`}
    >
      {formatPayload(value)}
    </pre>
  </div>
);

function formatPayload(value: unknown): string {
  if (value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
