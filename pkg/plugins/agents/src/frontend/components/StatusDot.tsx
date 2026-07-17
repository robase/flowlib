/**
 * StatusDot — a small coloured dot conveying a session's liveness.
 *
 * The four states map onto the `fl-*` theme tokens:
 *   running → info (pulsing)   active → success
 *   idle    → muted            error  → destructive
 */
import * as React from 'react';
import { cn } from '../lib/cn';

export type SessionStatus = 'running' | 'active' | 'idle' | 'error';

const STATUS_STYLES: Record<SessionStatus, { dot: string; label: string }> = {
  running: { dot: 'bg-info animate-pulse', label: 'Running' },
  active: { dot: 'bg-success', label: 'Active' },
  idle: { dot: 'bg-muted-foreground/50', label: 'Idle' },
  error: { dot: 'bg-destructive', label: 'Error' },
};

export function StatusDot({
  status,
  withLabel = false,
}: {
  status: SessionStatus;
  withLabel?: boolean;
}): React.ReactElement {
  const s = STATUS_STYLES[status];
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('h-2 w-2 shrink-0 rounded-full', s.dot)} aria-hidden="true" />
      {withLabel && <span className="text-xs text-muted-foreground">{s.label}</span>}
      <span className="sr-only">{s.label}</span>
    </span>
  );
}

/**
 * Map the live chat-stream status onto the session status palette used by
 * `StatusDot`. `streaming` lights the pulsing "running" dot.
 */
export function streamStatusToDot(
  status: 'connecting' | 'streaming' | 'idle' | 'error',
): SessionStatus {
  switch (status) {
    case 'streaming':
      return 'running';
    case 'connecting':
      return 'idle';
    case 'idle':
      return 'active';
    case 'error':
      return 'error';
  }
}
