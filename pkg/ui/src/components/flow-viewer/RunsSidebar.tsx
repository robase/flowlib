import React from 'react';
import { Clock, Loader2, CheckCircle, XCircle, StopCircle } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface RunListItem {
  id: string;
  status: string;
  startedAt?: string | Date;
  completedAt?: string | Date;
}

interface RunsSidebarProps {
  runs: RunListItem[];
  selectedRunId: string | null;
  onSelectRun: (runId: string) => void;
}

function formatTimestamp(dateLike?: string | Date): string {
  if (!dateLike) {
    return '';
  }
  const d = new Date(dateLike);
  return d.toLocaleString();
}

function formatSince(dateLike?: string | Date): string {
  if (!dateLike) {
    return '';
  }
  const d = new Date(dateLike).getTime();
  const diffMs = Date.now() - d;
  const minutes = Math.floor(diffMs / (1000 * 60));
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (minutes < 1) {
    return 'Just now';
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  if (hours < 24) {
    return `${hours}h ago`;
  }
  return `${days}d ago`;
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'SUCCESS':
      return <CheckCircle className="w-4 h-4 text-green-600" />;
    case 'FAILED':
      return <XCircle className="w-4 h-4 text-red-600" />;
    case 'CANCELLED':
      return <StopCircle className="w-4 h-4 text-yellow-600" />;
    case 'RUNNING':
      return <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />;
    case 'PENDING':
    case 'PAUSED':
    case 'PAUSED_FOR_BATCH':
      return <Clock className="w-4 h-4 text-muted-foreground" />;
    default:
      return <Clock className="w-4 h-4 text-muted-foreground" />;
  }
}

export const RunsSidebar: React.FC<RunsSidebarProps> = ({ runs, selectedRunId, onSelectRun }) => {
  return (
    <div className="flex flex-col w-64 border-r shrink-0 border-border bg-fl-background text-card-foreground">
      <div className="px-4 py-3 border-b border-border">
        <h2 className="text-sm font-semibold text-card-foreground">Execution History</h2>
        <p className="mt-1 text-xs text-muted-foreground">{runs.length} total runs</p>
      </div>
      <div className="flex-1 p-3 space-y-2 overflow-auto">
        {runs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full px-4 text-center">
            <Clock className="w-12 h-12 mb-3 text-muted-foreground/50" />
            <p className="mb-1 text-sm text-muted-foreground">No flow runs yet</p>
            <p className="text-xs text-muted-foreground">Run this flow to see execution history</p>
          </div>
        ) : (
          runs.map((run) => (
            <button
              key={run.id}
              onClick={() => onSelectRun(run.id)}
              className={cn(
                'w-full text-left rounded-lg border p-2 transition-colors',
                'hover:bg-muted/50',
                selectedRunId === run.id
                  ? 'bg-muted border-muted-foreground'
                  : 'bg-card border-border',
              )}
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex items-center gap-2">
                  <StatusIcon status={run.status} />
                  <span className="text-xs text-muted-foreground">
                    {formatSince(run.startedAt)}
                  </span>
                </div>
                <span
                  className={cn(
                    'rounded-full border px-2 py-0 text-xs font-medium',
                    run.status === 'SUCCESS' &&
                      'bg-green-500/10 text-green-600 border-green-500/20',
                    run.status === 'FAILED' && 'bg-red-500/10 text-red-600 border-red-500/20',
                    (run.status === 'RUNNING' ||
                      run.status === 'PENDING' ||
                      run.status === 'PAUSED' ||
                      run.status === 'PAUSED_FOR_BATCH') &&
                      'bg-blue-500/10 text-blue-600 border-blue-500/20',
                    run.status === 'CANCELLED' &&
                      'bg-yellow-500/10 text-yellow-600 border-yellow-500/20',
                  )}
                >
                  {run.status}
                </span>
              </div>
              <div className="text-xs text-muted-foreground">{formatTimestamp(run.startedAt)}</div>
            </button>
          ))
        )}
      </div>
    </div>
  );
};
