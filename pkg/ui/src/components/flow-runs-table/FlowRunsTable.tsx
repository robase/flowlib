import React, { useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router';
import { useFlows } from '../../api/flows.api';
import { useListFlowRuns } from '../../api/executions.api';
import { Flow, FlowRun } from '@flowlib/core/types';
import {
  CheckCircle,
  XCircle,
  Loader2,
  Clock,
  AlertCircle,
  Eye,
  Pause,
  Calendar,
  X,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Copy,
  ChevronUp,
  ChevronDown,
  Play,
  Search,
} from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { InvectLoader } from '../shared/InvectLoader';

// Execution status constants with proper typing
const EXECUTION_STATUSES = [
  'PENDING',
  'RUNNING',
  'SUCCESS',
  'FAILED',
  'PAUSED',
  'CANCELLED',
  'PAUSED_FOR_BATCH',
] as const;

type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

// Helper function to format dates as "2:36pm" and "7 Jul 25" on separate lines
function formatExecutionDate(dateString: string): { time: string; date: string } {
  try {
    const date = new Date(dateString);
    const time = date
      .toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      })
      .toLowerCase();

    // Format as "7 Jul 25"
    const day = date.getDate();
    const month = date.toLocaleDateString('en-US', { month: 'short' });
    const year = date.getFullYear().toString().slice(-2);
    const dateStr = `${day} ${month} ${year}`;

    return { time, date: dateStr };
  } catch {
    return { time: 'Unknown', date: 'time' };
  }
}

// Helper function to format duration
function formatDuration(startedAt: string, endedAt?: string): string {
  try {
    const start = new Date(startedAt);
    const end = endedAt ? new Date(endedAt) : new Date();
    const diffMs = end.getTime() - start.getTime();

    const minutes = Math.floor(diffMs / (1000 * 60));
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}d ${hours % 24}h`;
    }
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    }
    if (minutes > 0) {
      return `${minutes}m`;
    }
    return '< 1m';
  } catch {
    return 'Unknown';
  }
}

// Helper function to format JSON for display
function formatJsonPreview(inputData: unknown): string {
  let data = inputData;
  if (!data) {
    return '-';
  }

  try {
    if (typeof data === 'string') {
      // Try to parse if it's a JSON string
      try {
        const parsed = JSON.parse(data);
        data = parsed;
      } catch {
        // If not valid JSON, truncate the string
        const str = data as string;
        return str.length > 100 ? `${str.substring(0, 100)}...` : str;
      }
    }

    if (typeof data === 'object') {
      const jsonString = JSON.stringify(data, null, 0);
      return jsonString.length > 100 ? `${jsonString.substring(0, 100)}...` : jsonString;
    }

    return String(data);
  } catch {
    return 'Invalid data';
  }
}

// Helper function to copy text to clipboard
async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch (err) {
    console.warn('Could not copy text to clipboard:', err);
    throw new Error('Copy to clipboard failed');
  }
}

// Tooltip wrapper component with copy functionality
const CopyableTooltip: React.FC<{
  content: string;
  children: React.ReactNode;
}> = ({ content, children }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await copyToClipboard(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 400); // Reset after 800ms for quicker feedback
  };

  if (!content || content === '-') {
    return <>{children}</>;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="cursor-pointer">{children}</div>
        </TooltipTrigger>
        <TooltipContent className="relative max-w-md overflow-auto max-h-60 min-h-[3rem] pb-12">
          <button
            onClick={handleCopy}
            className={`fixed bottom-2 right-4 p-2 cursor-pointer rounded-md transition-all duration-200 z-50 shadow-lg border ${
              copied
                ? 'bg-primary text-primary-foreground border-primary scale-110'
                : 'bg-card text-muted-foreground border-border hover:bg-muted hover:border-muted-foreground hover:shadow-xl'
            }`}
            title={copied ? 'Copied!' : 'Copy to clipboard'}
          >
            <Copy className="w-4 h-4" />
          </button>
          <pre className="font-mono text-xs break-words whitespace-pre-wrap">{content}</pre>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

// Status badge component
const StatusBadge: React.FC<{ status: ExecutionStatus }> = ({ status }) => {
  const getStatusConfig = () => {
    switch (status) {
      case 'SUCCESS':
        return {
          icon: <CheckCircle className="w-4 h-4" />,
          variant: 'secondary' as const,
          className:
            'text-green-700 bg-green-50 border-green-200 dark:text-green-300 dark:bg-green-900/30 dark:border-green-800',
        };
      case 'FAILED':
        return {
          icon: <XCircle className="w-4 h-4" />,
          variant: 'destructive' as const,
          className:
            'text-red-700 bg-red-50 border-red-200 dark:text-red-300 dark:bg-red-900/30 dark:border-red-800',
        };
      case 'RUNNING':
        return {
          icon: <Loader2 className="w-4 h-4 animate-spin" />,
          variant: 'default' as const,
          className:
            'text-blue-700 bg-blue-50 border-blue-200 dark:text-blue-300 dark:bg-blue-900/30 dark:border-blue-800',
        };
      case 'PENDING':
        return {
          icon: <Clock className="w-4 h-4" />,
          variant: 'outline' as const,
          className: 'text-muted-foreground bg-muted border-border',
        };
      case 'PAUSED':
        return {
          icon: <Pause className="w-4 h-4" />,
          variant: 'outline' as const,
          className:
            'text-yellow-700 bg-yellow-50 border-yellow-200 dark:text-yellow-300 dark:bg-yellow-900/30 dark:border-yellow-800',
        };
      case 'PAUSED_FOR_BATCH':
        return {
          icon: <Loader2 className="w-4 h-4 animate-spin" />,
          variant: 'default' as const,
          className:
            'text-purple-700 bg-purple-50 border-purple-200 dark:text-purple-300 dark:bg-purple-900/30 dark:border-purple-800',
        };
      case 'CANCELLED':
        return {
          icon: <X className="w-4 h-4" />,
          variant: 'outline' as const,
          className: 'text-muted-foreground bg-muted border-border',
        };
      default:
        return {
          icon: <AlertCircle className="w-4 h-4" />,
          variant: 'outline' as const,
          className: 'text-muted-foreground bg-muted border-border',
        };
    }
  };

  const config = getStatusConfig();

  return (
    <Badge variant={config.variant} className={`${config.className} flex items-center gap-1`}>
      {config.icon}
      <span>{status}</span>
    </Badge>
  );
};

interface FlowRunsTableProps {
  basePath?: string;
}

export const FlowRunsTable: React.FC<FlowRunsTableProps> = ({ basePath = '' }) => {
  const navigate = useNavigate();
  const [flowSearch, setFlowSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sortBy, setSortBy] = useState<string>('startedAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  // Get flows for name lookup
  const { data: flowsResponse, isLoading: flowsLoading } = useFlows();
  const flows = flowsResponse?.data ?? [];

  // Create flow lookup map
  const flowMap = useMemo(() => {
    const map = new Map<string, { name: string }>();
    flows.forEach((flow: Flow) => {
      map.set(flow.id, { name: flow.name });
    });
    return map;
  }, [flows]);

  // Resolve flowFilter: find the flow whose name matches the search
  const flowFilter = useMemo(() => {
    const q = flowSearch.trim().toLowerCase();
    if (!q) {
      return undefined;
    }
    const match = flows.find((f: Flow) => f.name.toLowerCase().includes(q));
    return match?.id;
  }, [flowSearch, flows]);

  // When search changes, reset page
  const handleFlowSearchChange = (value: string) => {
    setFlowSearch(value);
    setPage(1);
  };

  // Get all executions with filters, pagination, and sorting applied
  const {
    data: executionsResponse,
    isLoading: executionsLoading,
    error: executionsError,
  } = useListFlowRuns(flowFilter, statusFilter, page, pageSize, sortBy, sortOrder);

  // Extract data and pagination from response
  const executions = executionsResponse?.data ?? [];
  const pagination = executionsResponse?.pagination;
  const hasPreviousPage = pagination ? pagination.page > 1 : false;
  const hasNextPage = pagination ? pagination.page < pagination.totalPages : false;

  const clearFilters = () => {
    setFlowSearch('');
    setStatusFilter(undefined);
    setPage(1);
  };

  const hasActiveFilters = flowSearch.trim() || statusFilter;

  const handleSort = (field: string) => {
    // If clicking the same field, toggle order. Otherwise, default to desc for new fields.
    if (sortBy === field) {
      setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc');
    } else {
      setSortBy(field);
      setSortOrder('desc'); // Default to descending for new sort fields
    }
    setPage(1); // Reset to first page when sorting changes
  };

  const getSortIcon = (field: string) => {
    if (sortBy !== field) {
      return (
        <ChevronDown className="w-4 h-4 text-muted-foreground transition-opacity opacity-0 group-hover:opacity-50" />
      );
    }
    return sortOrder === 'desc' ? (
      <ChevronDown className="w-4 h-4 text-primary" />
    ) : (
      <ChevronUp className="w-4 h-4 text-primary" />
    );
  };

  const SortableHeader: React.FC<{
    field: string;
    children: React.ReactNode;
    className?: string;
  }> = ({ field, children, className = '' }) => (
    <TableHead
      className={`cursor-pointer select-none hover:bg-muted group transition-colors ${className}`}
      onClick={() => handleSort(field)}
      title={`Click to sort by ${children} ${
        sortBy === field ? (sortOrder === 'desc' ? '(ascending)' : '(descending)') : ''
      }`}
    >
      <div className="flex items-center gap-1">
        {children}
        {getSortIcon(field)}
      </div>
    </TableHead>
  );

  if (executionsLoading || flowsLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <InvectLoader iconClassName="h-14" label="Loading flow runs..." />
      </div>
    );
  }

  if (executionsError) {
    return (
      <div className="p-4 border border-red-200 dark:border-red-800 rounded-lg bg-red-50 dark:bg-red-900/30">
        <div className="text-red-800 dark:text-red-300">
          <strong>Error loading flow runs:</strong>{' '}
          {executionsError instanceof Error
            ? executionsError.message
            : 'Failed to load executions from the server'}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header and Filters */}
      <div className="flex items-center gap-2">
        {/* Flow search */}
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 pointer-events-none text-muted-foreground" />
          <input
            type="text"
            value={flowSearch}
            onChange={(e) => handleFlowSearchChange(e.target.value)}
            placeholder="Search by flow name…"
            className="w-full rounded-lg border border-border bg-transparent py-2 pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground focus:border-primary/50"
          />
        </div>

        {/* Status Filter */}
        <Select
          value={statusFilter || 'ALL'}
          onValueChange={(value) => {
            setStatusFilter(value === 'ALL' ? undefined : value);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-40 bg-transparent">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            {EXECUTION_STATUSES.map((status) => (
              <SelectItem key={status} value={status}>
                {status}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Clear Filters */}
        {hasActiveFilters && (
          <Button variant="outline" size="sm" onClick={clearFilters}>
            <X className="w-4 h-4 mr-2" />
            Clear
          </Button>
        )}
      </div>

      {/* Flow Runs Table */}
      {executions.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center py-14 text-center">
            <div className="flex items-center justify-center w-14 h-14 mb-4 rounded-xl bg-muted/60">
              {hasActiveFilters ? (
                <Calendar className="w-7 h-7 text-muted-foreground" />
              ) : (
                <Play className="w-7 h-7 text-muted-foreground" />
              )}
            </div>
            <h3 className="text-base font-semibold text-foreground mb-1">
              {hasActiveFilters ? 'No flow runs match your filters' : 'No flow runs yet'}
            </h3>
            <p className="max-w-sm mx-auto text-sm text-muted-foreground mb-5">
              {hasActiveFilters
                ? 'Try adjusting your filters to see more results.'
                : 'Run a workflow from the editor to see execution history here.'}
            </p>
            <div className="flex items-center gap-2">
              {hasActiveFilters ? (
                <Button variant="outline" size="sm" onClick={clearFilters}>
                  <X className="h-3.5 w-3.5 mr-1.5" />
                  Clear filters
                </Button>
              ) : (
                <Button size="sm" onClick={() => navigate(basePath || '/')}>
                  <Play className="h-3.5 w-3.5 mr-1.5" />
                  Go to Flows
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-hidden bg-card border border-border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[200px]">Flow</TableHead>
                <TableHead className="w-[120px]">Status</TableHead>
                <SortableHeader field="startedAt" className="w-[120px]">
                  Last ran
                </SortableHeader>
                <SortableHeader field="duration" className="w-[80px]">
                  Duration
                </SortableHeader>
                <SortableHeader field="inputs" className="w-[200px]">
                  Input
                </SortableHeader>
                <SortableHeader field="outputs" className="w-[200px]">
                  Output
                </SortableHeader>
                <TableHead className="w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {executions.map((execution: FlowRun) => {
                const flow = flowMap.get(execution.flowId);
                const flowName = flow?.name || `Flow ${execution.flowId}`;

                return (
                  <TableRow key={execution.id}>
                    <TableCell className="font-medium">
                      <div className="truncate" title={flowName}>
                        {flowName}
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={execution.status as ExecutionStatus} />
                    </TableCell>
                    <TableCell>
                      <div className="font-mono text-sm">
                        <div className="text-xs text-muted-foreground">
                          {formatExecutionDate(String(execution.startedAt)).time}
                        </div>
                        <div className="text-xs">
                          {formatExecutionDate(String(execution.startedAt)).date}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">
                        {formatDuration(
                          String(execution.startedAt),
                          execution.completedAt ? String(execution.completedAt) : undefined,
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <CopyableTooltip
                        content={execution.inputs ? JSON.stringify(execution.inputs, null, 2) : ''}
                      >
                        <div className="max-w-[200px] line-clamp-2 text-xs font-mono text-muted-foreground">
                          {formatJsonPreview(execution.inputs)}
                        </div>
                      </CopyableTooltip>
                    </TableCell>
                    <TableCell>
                      <CopyableTooltip
                        content={
                          execution.outputs ? JSON.stringify(execution.outputs, null, 2) : ''
                        }
                      >
                        <div className="max-w-[200px] line-clamp-2 text-xs font-mono text-muted-foreground">
                          {formatJsonPreview(execution.outputs)}
                        </div>
                      </CopyableTooltip>
                    </TableCell>
                    <TableCell>
                      <Button variant="outline" size="sm" asChild>
                        <Link to={`${basePath}/flow/${execution.flowId}/run/${execution.id}`}>
                          <Eye className="w-4 h-4 mr-1" />
                          View
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Pagination Controls */}
      {pagination && (
        <div className="flex items-center justify-between py-4">
          <div className="text-sm text-muted-foreground">
            Showing {(pagination.page - 1) * pagination.limit + 1} to{' '}
            {pagination.page * pagination.limit} of {pagination.totalPages * pagination.limit}{' '}
            results
          </div>

          <div className="flex items-center gap-2">
            {/* Page Size Selector */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Rows per page:</span>
              <Select
                value={pageSize.toString()}
                onValueChange={(value) => {
                  setPageSize(Number(value));
                  setPage(1); // Reset to first page when changing page size
                }}
              >
                <SelectTrigger className="w-20 bg-card">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="5">5</SelectItem>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="20">20</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Page Navigation */}
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(1)}
                disabled={!hasPreviousPage}
              >
                <ChevronsLeft className="w-4 h-4" />
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(pagination.page - 1)}
                disabled={!hasPreviousPage}
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>

              <div className="flex items-center gap-1 px-2">
                <span className="text-sm">
                  Page {pagination.page} of {pagination.totalPages}
                </span>
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(pagination.page + 1)}
                disabled={!hasNextPage}
              >
                <ChevronRight className="w-4 h-4" />
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(pagination.totalPages)}
                disabled={!hasNextPage}
              >
                <ChevronsRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
