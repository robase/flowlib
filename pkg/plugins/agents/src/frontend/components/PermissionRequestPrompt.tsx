/**
 * PermissionRequestPrompt — inline approve/deny UI for a
 * `permission-request` event.
 *
 * Calls back via `onRespond(decision)`. Once a decision is made the card
 * locks (visually greyed) so the same approval can't be sent twice — the
 * actual response transport (typed WebSocket message) is handled by
 * `useChatStream.permissionResponse(id, decision)`.
 */
import * as React from 'react';
import type { PermissionRequestEvent } from '../../shared/events';

export interface PermissionRequestPromptProps {
  event: PermissionRequestEvent;
  onRespond: (decision: 'allow' | 'deny') => void;
  /** When already responded to, the buttons disable. */
  resolved?: 'allow' | 'deny' | null;
}

export const PermissionRequestPrompt: React.FC<PermissionRequestPromptProps> = ({
  event,
  onRespond,
  resolved = null,
}) => {
  const [pendingDecision, setPendingDecision] = React.useState<'allow' | 'deny' | null>(resolved);

  React.useEffect(() => {
    setPendingDecision(resolved);
  }, [resolved]);

  const isResolved = pendingDecision !== null;

  const handle = (decision: 'allow' | 'deny') => {
    if (isResolved) {
      return;
    }
    setPendingDecision(decision);
    onRespond(decision);
  };

  return (
    <div
      className="rounded border border-fl-warning bg-fl-warning/10 px-3 py-2 my-2"
      role="alertdialog"
      aria-labelledby={`permission-${event.id}-title`}
      data-testid="permission-prompt"
      data-resolved={pendingDecision ?? undefined}
    >
      <div
        id={`permission-${event.id}-title`}
        className="text-sm font-medium text-fl-foreground mb-1"
      >
        Approve <span className="font-mono">{event.tool}</span>?
      </div>
      <pre className="text-xs font-mono whitespace-pre-wrap break-words bg-fl-muted text-fl-muted-foreground p-2 rounded my-2">
        {formatInput(event.input)}
      </pre>
      <div className="flex items-center gap-2 mt-2">
        <button
          type="button"
          className="px-3 py-1 rounded bg-fl-primary text-fl-primary-foreground text-sm hover:bg-fl-primary/90 disabled:opacity-50"
          disabled={isResolved}
          onClick={() => handle('allow')}
        >
          {pendingDecision === 'allow' ? 'Approved' : 'Allow'}
        </button>
        <button
          type="button"
          className="px-3 py-1 rounded bg-fl-destructive text-fl-primary-foreground text-sm hover:bg-fl-destructive/90 disabled:opacity-50"
          disabled={isResolved}
          onClick={() => handle('deny')}
        >
          {pendingDecision === 'deny' ? 'Denied' : 'Deny'}
        </button>
      </div>
    </div>
  );
};

PermissionRequestPrompt.displayName = 'PermissionRequestPrompt';

function formatInput(value: unknown): string {
  if (value === undefined || value === null) {
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
