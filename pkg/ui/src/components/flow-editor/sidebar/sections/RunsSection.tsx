import React from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import {
  History,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import { useFlowRuns } from '../../../../api/executions.api';
import { ScrollArea } from '../../../ui/scroll-area';
import { Skeleton } from '../../../ui/skeleton';
import { cn } from '../../../../lib/utils';
import type { FlowRun } from '@flowlib/core/types';
import { FlowRunStatus } from '@flowlib/core/types';
import type { SidebarSection, SidebarSectionContext } from '../types';

export function createRunsSection(): SidebarSection {
  return {
    id: 'runs',
    title: 'Runs',
    icon: History,
    render: (ctx) => <RunsSectionBody ctx={ctx} />,
  };
}

function RunsSectionBody({ ctx }: { ctx: SidebarSectionContext }) {
  const { flowId, basePath = '' } = ctx;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const activeRunId = searchParams.get('runId');

  const { data: executionsResponse, isLoading } = useFlowRuns(flowId);
  const runs: FlowRun[] = executionsResponse?.data ?? [];

  const handleSelect = (runId: string) => {
    if (runId === activeRunId && window.location.pathname.includes('/runs')) {
      return;
    }
    navigate(`${basePath}/flow/${flowId}/runs?runId=${runId}`);
  };

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2 p-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-2 px-2 py-1.5">
            <Skeleton className="w-4 h-4 rounded-full shrink-0" />
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-12 ml-auto" />
          </div>
        ))}
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="px-4 py-6 text-center text-muted-foreground">
        <Clock className="w-6 h-6 mx-auto mb-2 opacity-30" />
        <p className="text-xs">Run this flow to see history</p>
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1 min-h-0">
      <div className="flex flex-col py-1">
        {runs.map((run) => (
          <RunRow
            key={run.id}
            run={run}
            isActive={run.id === activeRunId}
            onSelect={handleSelect}
          />
        ))}
      </div>
    </ScrollArea>
  );
}

function RunRow({
  run,
  isActive,
  onSelect,
}: {
  run: FlowRun;
  isActive: boolean;
  onSelect: (runId: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(run.id)}
      className={cn(
        'flex items-center gap-2 px-3 py-1.5 text-left transition-colors',
        'hover:bg-accent/40',
        isActive && 'bg-accent/60 text-accent-foreground',
      )}
      title={`${run.status} — started ${new Date(run.startedAt).toLocaleString()}`}
    >
      <RunStatusIcon status={run.status} />
      <span className="font-mono text-xs truncate flex-1">{shortId(run.id)}</span>
      <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
        {formatRelativeTime(run.startedAt)}
      </span>
    </button>
  );
}

function RunStatusIcon({ status }: { status: FlowRunStatus }) {
  const size = 14;
  switch (status) {
    case FlowRunStatus.SUCCESS:
      return <CheckCircle2 className="text-green-500 shrink-0" size={size} />;
    case FlowRunStatus.FAILED:
      return <XCircle className="text-red-500 shrink-0" size={size} />;
    case FlowRunStatus.RUNNING:
      return (
        <div
          className="border-2 border-blue-500 rounded-full border-t-transparent animate-spin shrink-0"
          style={{ width: size, height: size }}
        />
      );
    case FlowRunStatus.PENDING:
      return <Clock className="text-muted-foreground shrink-0" size={size} />;
    case FlowRunStatus.PAUSED:
    case FlowRunStatus.PAUSED_FOR_BATCH:
      return <AlertCircle className="text-yellow-500 shrink-0" size={size} />;
    case FlowRunStatus.CANCELLED:
      return <RefreshCw className="text-amber-500 shrink-0" size={size} />;
    default:
      return <Clock className="text-muted-foreground shrink-0" size={size} />;
  }
}

function shortId(id: string): string {
  // Display the trailing 8 chars; the full id is in the title attr.
  return id.length > 8 ? id.slice(-8) : id;
}

function formatRelativeTime(input: Date | string): string {
  const ts = typeof input === 'string' ? new Date(input).getTime() : input.getTime();
  const diffSec = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (diffSec < 5) {return 'just now';}
  if (diffSec < 60) {return `${diffSec}s ago`;}
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) {return `${diffMin}m ago`;}
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) {return `${diffHr}h ago`;}
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 7) {return `${diffDay}d ago`;}
  return new Date(ts).toLocaleDateString();
}
