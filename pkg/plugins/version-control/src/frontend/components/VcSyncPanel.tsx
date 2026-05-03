/**
 * VcSyncPanel — Panel tab for the flow editor.
 *
 * Shows sync status, push/pull controls, and recent sync history
 * for the current flow. Registered as a panelTab contribution
 * for the 'flowEditor' context.
 */

import { useState } from 'react';
import {
  GitBranch,
  ArrowUpFromLine,
  ArrowDownToLine,
  Clock,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ExternalLink,
  Unplug,
  Send,
} from 'lucide-react';
import {
  useFlowSyncStatus,
  useFlowSyncHistory,
  usePushFlow,
  usePullFlow,
  useForcePushFlow,
  useForcePullFlow,
  usePublishFlow,
  useDisconnectSync,
} from '../hooks/useFlowSync';
import { ConnectFlowForm } from './ConnectFlowForm';
import type { PanelTabProps } from '@flowlib/ui';
import type { VcSyncStatus } from '../../shared/types';

export function VcSyncPanel({ flowId }: PanelTabProps) {
  const { data, isLoading, error } = useFlowSyncStatus(flowId);
  const { data: historyData } = useFlowSyncHistory(flowId);
  const pushMutation = usePushFlow(flowId);
  const pullMutation = usePullFlow(flowId);
  const forcePushMutation = useForcePushFlow(flowId);
  const forcePullMutation = useForcePullFlow(flowId);
  const publishMutation = usePublishFlow(flowId);
  const disconnectMutation = useDisconnectSync(flowId);
  const [showConnect, setShowConnect] = useState(false);
  const [showConflictActions, setShowConflictActions] = useState(false);

  const isBusy =
    pushMutation.isPending ||
    pullMutation.isPending ||
    forcePushMutation.isPending ||
    forcePullMutation.isPending ||
    publishMutation.isPending ||
    disconnectMutation.isPending;

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <span className="text-sm text-fl-muted-foreground">Loading sync status...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <span className="text-sm text-red-500">
          {error instanceof Error ? error.message : 'Failed to load sync status'}
        </span>
      </div>
    );
  }

  const status = data?.status ?? 'not-connected';
  const config = data?.config;
  const history = historyData?.history ?? [];

  // Not connected — show connect form
  if (status === 'not-connected' || !config) {
    if (showConnect) {
      return (
        <div className="flex h-full flex-col p-4">
          <ConnectFlowForm flowId={flowId} onCancel={() => setShowConnect(false)} />
        </div>
      );
    }

    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-4">
        <GitBranch className="h-8 w-8 text-fl-muted-foreground/50" />
        <p className="text-sm text-fl-muted-foreground">Not connected to version control</p>
        <button
          onClick={() => setShowConnect(true)}
          className="rounded-md bg-fl-primary px-3 py-1.5 text-sm font-medium text-fl-primary-foreground hover:bg-fl-primary/90"
        >
          Connect to Git
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col p-4">
      {/* Status header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-fl-muted-foreground" />
          <h3 className="text-sm font-medium">Version Control</h3>
        </div>
        <StatusBadge status={status} />
      </div>

      {/* Config info */}
      <div className="mb-4 space-y-1 rounded-md border border-fl-border bg-fl-muted/30 p-3 text-xs">
        <div className="flex justify-between">
          <span className="text-fl-muted-foreground">Repo</span>
          <span className="font-mono">{config.repo}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-fl-muted-foreground">Branch</span>
          <span className="font-mono">{config.branch}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-fl-muted-foreground">File</span>
          <span className="font-mono truncate max-w-[180px]" title={config.filePath}>
            {config.filePath}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-fl-muted-foreground">Mode</span>
          <span>{config.mode}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-fl-muted-foreground">Direction</span>
          <span>{config.syncDirection}</span>
        </div>
        {config.activePrUrl && (
          <div className="flex justify-between">
            <span className="text-fl-muted-foreground">Active PR</span>
            <a
              href={config.activePrUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-fl-primary hover:underline"
            >
              #{config.activePrNumber}
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="mb-4 flex gap-2">
        {config.syncDirection !== 'pull' && (
          <button
            onClick={() => pushMutation.mutate()}
            disabled={isBusy}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-fl-border bg-fl-background px-3 py-1.5 text-xs font-medium hover:bg-fl-muted disabled:opacity-50"
          >
            <ArrowUpFromLine className="h-3.5 w-3.5" />
            Push
          </button>
        )}
        {config.syncDirection !== 'push' && (
          <button
            onClick={() => pullMutation.mutate()}
            disabled={isBusy}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-fl-border bg-fl-background px-3 py-1.5 text-xs font-medium hover:bg-fl-muted disabled:opacity-50"
          >
            <ArrowDownToLine className="h-3.5 w-3.5" />
            Pull
          </button>
        )}
        {config.mode === 'pr-per-publish' && config.syncDirection !== 'pull' && (
          <button
            onClick={() => publishMutation.mutate()}
            disabled={isBusy}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-fl-primary px-3 py-1.5 text-xs font-medium text-fl-primary-foreground hover:bg-fl-primary/90 disabled:opacity-50"
          >
            <Send className="h-3.5 w-3.5" />
            Publish
          </button>
        )}
      </div>

      {/* Conflict resolution */}
      {status === 'conflict' && (
        <div className="mb-4 rounded-md border border-yellow-500/30 bg-yellow-500/10 p-3">
          <p className="mb-2 text-xs font-medium text-yellow-600">
            Conflict detected — remote file has changed.
          </p>
          {!showConflictActions ? (
            <button
              onClick={() => setShowConflictActions(true)}
              className="text-xs text-yellow-600 underline hover:text-yellow-700"
            >
              Resolve conflict...
            </button>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={() => forcePushMutation.mutate()}
                disabled={isBusy}
                className="flex-1 rounded-md border border-yellow-500/30 px-2 py-1 text-xs font-medium hover:bg-yellow-500/20 disabled:opacity-50"
              >
                Force Push (local wins)
              </button>
              <button
                onClick={() => forcePullMutation.mutate()}
                disabled={isBusy}
                className="flex-1 rounded-md border border-yellow-500/30 px-2 py-1 text-xs font-medium hover:bg-yellow-500/20 disabled:opacity-50"
              >
                Force Pull (remote wins)
              </button>
            </div>
          )}
        </div>
      )}

      {/* Mutation feedback */}
      {(pushMutation.data ||
        pullMutation.data ||
        publishMutation.data ||
        forcePushMutation.data ||
        forcePullMutation.data) && (
        <MutationResult
          result={
            pushMutation.data ??
            pullMutation.data ??
            publishMutation.data ??
            forcePushMutation.data ??
            forcePullMutation.data ??
            null
          }
        />
      )}
      {(pushMutation.error ||
        pullMutation.error ||
        publishMutation.error ||
        forcePushMutation.error ||
        forcePullMutation.error ||
        disconnectMutation.error) && (
        <div className="mb-3 rounded-md border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-600">
          {
            (
              pushMutation.error ??
              pullMutation.error ??
              publishMutation.error ??
              forcePushMutation.error ??
              forcePullMutation.error ??
              disconnectMutation.error
            )?.message
          }
        </div>
      )}

      {/* Sync history */}
      <div className="flex items-center gap-2 mb-2">
        <Clock className="h-3.5 w-3.5 text-fl-muted-foreground" />
        <h4 className="text-xs font-medium text-fl-muted-foreground">Recent History</h4>
      </div>

      <div className="flex-1 overflow-y-auto space-y-1">
        {history.length === 0 ? (
          <p className="text-xs text-fl-muted-foreground">No sync history yet</p>
        ) : (
          history.slice(0, 10).map((entry) => (
            <div
              key={entry.id}
              className="flex items-start gap-2 rounded-md px-2 py-1.5 bg-fl-muted/20 text-xs"
            >
              <ActionIcon action={entry.action} />
              <div className="flex-1 min-w-0">
                <p className="truncate">{entry.message ?? entry.action}</p>
                <p className="text-fl-muted-foreground">
                  {new Date(entry.createdAt).toLocaleString()}
                  {entry.commitSha && (
                    <span className="ml-1 font-mono">{entry.commitSha.slice(0, 7)}</span>
                  )}
                </p>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Disconnect */}
      <div className="mt-3 border-t border-fl-border pt-3">
        <button
          onClick={() => {
            if (window.confirm('Disconnect this flow from version control?')) {
              disconnectMutation.mutate();
            }
          }}
          disabled={isBusy}
          className="flex items-center gap-1.5 text-xs text-fl-muted-foreground hover:text-red-500 disabled:opacity-50"
        >
          <Unplug className="h-3.5 w-3.5" />
          Disconnect
        </button>
      </div>
    </div>
  );
}

// =============================================================================
// Sub-components
// =============================================================================

function StatusBadge({ status }: { status: VcSyncStatus }) {
  const styles: Record<VcSyncStatus, string> = {
    synced: 'border-green-500/30 bg-green-500/10 text-green-600',
    pending: 'border-yellow-500/30 bg-yellow-500/10 text-yellow-600',
    conflict: 'border-red-500/30 bg-red-500/10 text-red-600',
    'not-connected': 'border-fl-border bg-fl-muted text-fl-muted-foreground',
    error: 'border-red-500/30 bg-red-500/10 text-red-600',
  };

  const icons: Record<VcSyncStatus, React.ReactNode> = {
    synced: <CheckCircle2 className="h-3 w-3" />,
    pending: <Clock className="h-3 w-3" />,
    conflict: <AlertTriangle className="h-3 w-3" />,
    'not-connected': null,
    error: <XCircle className="h-3 w-3" />,
  };

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${styles[status]}`}
    >
      {icons[status]}
      {status}
    </span>
  );
}

function ActionIcon({ action }: { action: string }) {
  switch (action) {
    case 'push':
      return <ArrowUpFromLine className="mt-0.5 h-3 w-3 text-blue-500 shrink-0" />;
    case 'pull':
      return <ArrowDownToLine className="mt-0.5 h-3 w-3 text-green-500 shrink-0" />;
    case 'pr-created':
      return <GitBranch className="mt-0.5 h-3 w-3 text-purple-500 shrink-0" />;
    case 'pr-merged':
      return <CheckCircle2 className="mt-0.5 h-3 w-3 text-green-600 shrink-0" />;
    case 'conflict':
      return <AlertTriangle className="mt-0.5 h-3 w-3 text-yellow-500 shrink-0" />;
    default:
      return <Clock className="mt-0.5 h-3 w-3 text-fl-muted-foreground shrink-0" />;
  }
}

function MutationResult({
  result,
}: {
  result: {
    success: boolean;
    error?: string;
    prUrl?: string;
    prNumber?: number;
    commitSha?: string;
  } | null;
}) {
  if (!result) {
    return null;
  }

  if (!result.success) {
    return (
      <div className="mb-3 rounded-md border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-600">
        {result.error ?? 'Operation failed'}
      </div>
    );
  }

  return (
    <div className="mb-3 rounded-md border border-green-500/30 bg-green-500/10 p-2 text-xs text-green-600">
      Success
      {result.commitSha && <span className="ml-1 font-mono">({result.commitSha.slice(0, 7)})</span>}
      {result.prUrl && (
        <a
          href={result.prUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-1 underline hover:text-green-700"
        >
          PR #{result.prNumber}
        </a>
      )}
    </div>
  );
}
