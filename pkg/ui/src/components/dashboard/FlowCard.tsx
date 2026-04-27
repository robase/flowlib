import { Link, useNavigate } from 'react-router';
import { Edit, History } from 'lucide-react';
import { Button } from '~/components/ui/button';
import { useLatestFlowRun } from '~/api/executions.api';
import { StatusBadge, formatRelativeTime } from './status-helpers';
import type { Flow } from '@flowlib/core/types';

interface FlowCardProps {
  flow: Flow;
  basePath: string;
}

export function FlowCard({ flow, basePath }: FlowCardProps) {
  const { data: latestRun } = useLatestFlowRun(flow.id);
  const navigate = useNavigate();

  return (
    <div
      className="flex items-center justify-between px-4 py-3 transition-all border rounded-lg cursor-pointer group bg-card hover:shadow-sm hover:border-primary/20"
      onClick={() => navigate(`${basePath}/flow/${flow.id}`)}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2.5">
          <h3 className="text-sm font-medium truncate">{flow.name}</h3>
          {latestRun && <StatusBadge status={latestRun.status} />}
        </div>
        <div className="mt-1.5 flex items-center gap-3 text-xs text-muted-foreground">
          {flow.description && <span className="truncate max-w-75">{flow.description}</span>}
          {latestRun ? (
            <span className="shrink-0">Last run {formatRelativeTime(latestRun.startedAt)}</span>
          ) : (
            <span className="italic">Never run</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 ml-4 transition-opacity opacity-0 group-hover:opacity-100">
        <Button
          size="sm"
          variant="outline"
          className="text-xs h-7"
          onClick={(e) => {
            e.stopPropagation();
            navigate(`${basePath}/flow/${flow.id}`);
          }}
        >
          <Edit className="w-3 h-3 mr-1" />
          Edit
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="text-xs h-7"
          asChild
          onClick={(e) => e.stopPropagation()}
        >
          <Link to={`${basePath}/flow/${flow.id}/runs`}>
            <History className="w-3 h-3 mr-1" />
            Runs
          </Link>
        </Button>
      </div>
    </div>
  );
}
