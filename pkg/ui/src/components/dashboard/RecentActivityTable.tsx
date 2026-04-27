import { Link } from 'react-router';
import { Activity } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table';
import { StatusBadge, formatRelativeTime, formatDuration } from './status-helpers';
import type { Flow, FlowRun } from '@flowlib/core/types';
import { InvectLoader } from '../shared/InvectLoader';

interface RecentActivityTableProps {
  runs: FlowRun[];
  flows: Flow[];
  basePath: string;
  isLoading: boolean;
}

export function RecentActivityTable({
  runs,
  flows,
  basePath,
  isLoading,
}: RecentActivityTableProps) {
  const flowMap = new Map(flows.map((f) => [f.id, f]));

  if (isLoading) {
    return <InvectLoader className="py-8" iconClassName="h-10" label="Loading activity..." />;
  }

  if (runs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-sm text-muted-foreground">
        <div className="rounded-full bg-muted p-3 mb-3">
          <Activity className="h-6 w-6 text-muted-foreground" />
        </div>
        <p className="font-medium text-sm">No activity yet</p>
        <p className="text-xs mt-1 text-center max-w-[200px]">
          Run your first flow to see execution history here
        </p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[160px]">Flow</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>When</TableHead>
          <TableHead className="text-right">Duration</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {runs.map((run) => {
          const flow = flowMap.get(run.flowId);
          const duration =
            run.completedAt && run.startedAt
              ? new Date(String(run.completedAt)).getTime() -
                new Date(String(run.startedAt)).getTime()
              : null;

          return (
            <TableRow key={run.id} className="cursor-pointer">
              <TableCell className="font-medium">
                <Link
                  to={`${basePath}/flow/${run.flowId}`}
                  className="hover:underline truncate block max-w-[160px] text-xs"
                >
                  {flow?.name ?? run.flowId.slice(0, 16)}
                </Link>
              </TableCell>
              <TableCell>
                <StatusBadge status={run.status} />
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {formatRelativeTime(run.startedAt)}
              </TableCell>
              <TableCell className="text-right text-xs font-mono text-muted-foreground">
                {duration !== null ? formatDuration(duration) : '—'}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
