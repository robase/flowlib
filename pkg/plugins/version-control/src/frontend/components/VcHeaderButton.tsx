/**
 * VcHeaderButton — Header action that opens version control details for a flow.
 *
 * Shows sync state and exposes flow version history, sync actions, and restore/open
 * controls for previous versions.
 */

import { useMemo, useState, type ReactNode } from 'react';
import {
  GitBranch,
  ArrowUpFromLine,
  ArrowDownToLine,
  Loader2,
  ExternalLink,
  History,
  RotateCcw,
  Send,
  ChevronLeft,
  ChevronRight,
  FolderOpen,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  useCreateFlowVersion,
  useFlowVersions,
  type HeaderActionProps,
} from '@flowlib/ui';
import type { FlowVersion } from '@flowlib/core/types';
import {
  useFlowSyncHistory,
  useFlowSyncStatus,
  usePublishFlow,
  usePullFlow,
  usePushFlow,
} from '../hooks/useFlowSync';

export function VcHeaderButton({ flowId, basePath }: HeaderActionProps) {
  if (!flowId) {
    return null;
  }

  return <VcHeaderButtonInner flowId={flowId} basePath={basePath} />;
}

const PAGE_SIZE = 8;

function VcHeaderButtonInner({ flowId, basePath }: { flowId: string; basePath: string }) {
  const [open, setOpen] = useState(false);
  const [versionsPage, setVersionsPage] = useState(1);
  const { data, isLoading } = useFlowSyncStatus(flowId);
  const { data: syncHistoryData } = useFlowSyncHistory(flowId);
  const { data: versionsData, isLoading: versionsLoading } = useFlowVersions(flowId, {
    sort: { sortBy: 'version', sortOrder: 'desc' },
    pagination: { page: 1, limit: 100 },
  });
  const createVersionMutation = useCreateFlowVersion();
  const pushMutation = usePushFlow(flowId);
  const pullMutation = usePullFlow(flowId);
  const publishMutation = usePublishFlow(flowId);

  const status = data?.status;
  const config = data?.config;
  const syncHistory = syncHistoryData?.history ?? [];
  const versions = useMemo(() => {
    const items = versionsData?.data ?? [];
    return [...items].sort((left, right) => right.version - left.version);
  }, [versionsData]);

  const isBusy =
    isLoading ||
    pushMutation.isPending ||
    pullMutation.isPending ||
    publishMutation.isPending ||
    createVersionMutation.isPending;
  const canPush = config?.syncDirection !== 'pull';
  const canPull = config?.syncDirection !== 'push';
  const canPublish = config?.mode === 'pr-per-publish' && config.syncDirection !== 'pull';
  const currentViewedVersion = getCurrentViewedVersion();
  const latestVersion = versions[0]?.version ?? null;
  const pageCount = Math.max(1, Math.ceil(versions.length / PAGE_SIZE));
  const pagedVersions = versions.slice((versionsPage - 1) * PAGE_SIZE, versionsPage * PAGE_SIZE);

  const statusColor =
    status === 'synced'
      ? 'text-green-500'
      : status === 'pending'
        ? 'text-yellow-500'
        : status === 'conflict'
          ? 'text-red-500'
          : 'text-imp-muted-foreground';

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex h-8 items-center gap-2 rounded-md border bg-background px-3 text-sm font-medium shadow-xs hover:bg-accent hover:text-accent-foreground"
          title="Open version control details"
        >
          <span className={statusColor}>
            <GitBranch className="h-4 w-4" />
          </span>
          <span>Version Control</span>
        </button>
      </DialogTrigger>
      <DialogContent
        className="flex flex-col p-0 overflow-hidden sm:max-w-4xl"
        style={{ height: '80vh', width: '900px', maxWidth: '95vw' }}
      >
        <DialogHeader
          style={{ paddingTop: '1em', paddingBottom: '1em' }}
          className="shrink-0 border-b px-6 py-5"
        >
          <DialogTitle>Version Control</DialogTitle>
          <DialogDescription>
            Review Git sync status and work with previous flow versions.
          </DialogDescription>
        </DialogHeader>

        <div
          className="grid flex-1 min-h-0 overflow-hidden"
          style={{ gridTemplateColumns: '1.1fr 1.4fr' }}
        >
          <div className="border-r overflow-y-auto px-6 py-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Git Sync</h3>
              <span className={`text-xs font-medium capitalize ${statusColor}`}>
                {status ?? 'unknown'}
              </span>
            </div>

            {config ? (
              <>
                <div className="space-y-2 rounded-lg border bg-muted/30 p-4 text-sm">
                  <InfoRow label="Repository" value={config.repo} mono />
                  <InfoRow label="Branch" value={config.branch} mono />
                  <InfoRow label="File" value={config.filePath} mono />
                  <InfoRow label="Mode" value={config.mode} />
                  <InfoRow label="Direction" value={config.syncDirection} />
                  {config.activePrUrl ? (
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-muted-foreground">Active PR</span>
                      <a
                        href={config.activePrUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-primary hover:underline"
                      >
                        #{config.activePrNumber}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  ) : null}
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {canPush ? (
                    <ActionButton
                      label="Push"
                      busy={pushMutation.isPending}
                      disabled={isBusy}
                      icon={<ArrowUpFromLine className="h-3.5 w-3.5" />}
                      onClick={() => pushMutation.mutate()}
                    />
                  ) : null}
                  {canPull ? (
                    <ActionButton
                      label="Pull"
                      busy={pullMutation.isPending}
                      disabled={isBusy}
                      icon={<ArrowDownToLine className="h-3.5 w-3.5" />}
                      onClick={() => pullMutation.mutate()}
                    />
                  ) : null}
                  {canPublish ? (
                    <ActionButton
                      label="Publish"
                      busy={publishMutation.isPending}
                      disabled={isBusy}
                      primary
                      icon={<Send className="h-3.5 w-3.5" />}
                      onClick={() => publishMutation.mutate()}
                    />
                  ) : null}
                </div>
              </>
            ) : (
              <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                This flow is not connected to a Git remote yet. Local version history is still
                available.
              </div>
            )}

            <div className="mt-6">
              <div className="mb-3 flex items-center gap-2">
                <History className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold">Recent Sync Activity</h3>
              </div>
              {syncHistory.length > 0 ? (
                <div className="space-y-2">
                  {syncHistory.slice(0, 6).map((entry) => (
                    <div key={entry.id} className="rounded-lg border px-3 py-2 text-sm">
                      <div className="flex items-center justify-between gap-4">
                        <span className="font-medium capitalize">
                          {entry.action.replace('-', ' ')}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatTimestamp(entry.createdAt)}
                        </span>
                      </div>
                      {entry.message ? (
                        <p className="mt-1 text-xs text-muted-foreground">{entry.message}</p>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No sync activity recorded yet.</p>
              )}
            </div>
          </div>

          <div className="flex flex-col overflow-y-auto px-6 py-5">
            <div className="mb-3 flex items-center justify-between gap-4">
              <h3 className="text-sm font-semibold">Flow Versions</h3>
              {versions.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  {versions.length} version{versions.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>

            {versionsLoading ? (
              <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading versions…
              </div>
            ) : versions.length === 0 ? (
              <div className="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
                No saved versions found for this flow yet.
              </div>
            ) : (
              <>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-xs text-muted-foreground">
                      <th className="pb-2 text-left font-medium">Version</th>
                      <th className="pb-2 text-left font-medium">Created</th>
                      <th className="pb-2 text-left font-medium">Author</th>
                      <th className="pb-2 text-right font-medium"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {pagedVersions.map((version) => {
                      const isLatest = latestVersion === version.version;
                      const isCurrentView = currentViewedVersion
                        ? currentViewedVersion === version.version
                        : isLatest;

                      return (
                        <tr key={`${version.flowId}-${version.version}`} className="group">
                          <td className="py-2 pr-4">
                            <div className="flex items-center gap-1.5">
                              <span className="font-medium tabular-nums">v{version.version}</span>
                              {isCurrentView && (
                                <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
                                  open
                                </span>
                              )}
                              {isLatest && (
                                <span className="rounded-full bg-green-500/10 px-1.5 py-0.5 text-xs font-medium text-green-700 dark:text-green-400">
                                  latest
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-2 pr-4 text-xs text-muted-foreground tabular-nums">
                            {formatTimestamp(version.createdAt)}
                          </td>
                          <td className="py-2 pr-4 text-xs text-muted-foreground">
                            {version.createdBy ?? 'Unknown'}
                          </td>
                          <td className="py-2">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                type="button"
                                disabled={isCurrentView}
                                title="Open this version"
                                onClick={() => openVersion(basePath, flowId, version.version)}
                                className="inline-flex h-7 w-7 items-center justify-center rounded-md border text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
                              >
                                <FolderOpen className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                disabled={createVersionMutation.isPending}
                                title="Restore as latest"
                                onClick={() =>
                                  restoreVersion({
                                    basePath,
                                    flowId,
                                    version,
                                    onDone: () => setOpen(false),
                                    restore: createVersionMutation.mutateAsync,
                                  })
                                }
                                className="inline-flex h-7 w-7 items-center justify-center rounded-md border text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
                              >
                                {createVersionMutation.isPending ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <RotateCcw className="h-3.5 w-3.5" />
                                )}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                {pageCount > 1 && (
                  <div className="mt-3 flex items-center justify-between border-t pt-3">
                    <span className="text-xs text-muted-foreground">
                      Page {versionsPage} of {pageCount}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={versionsPage === 1}
                        onClick={() => setVersionsPage((p) => p - 1)}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md border text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
                      >
                        <ChevronLeft className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={versionsPage === pageCount}
                        onClick={() => setVersionsPage((p) => p + 1)}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md border text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
                      >
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ActionButton({
  label,
  icon,
  busy,
  disabled,
  onClick,
  primary = false,
}: {
  label: string;
  icon: ReactNode;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        primary
          ? 'inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50'
          : 'inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-sm font-medium hover:bg-accent disabled:opacity-50'
      }
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon}
      {label}
    </button>
  );
}

function InfoRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={mono ? 'max-w-[16rem] truncate font-mono text-xs' : 'text-right'}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function getCurrentViewedVersion() {
  if (typeof window === 'undefined') {
    return null;
  }

  const match = window.location.pathname.match(/\/version\/(\d+)/);
  return match ? Number(match[1]) : null;
}

function openVersion(basePath: string, flowId: string, version: number) {
  if (typeof window === 'undefined') {
    return;
  }

  window.location.assign(`${basePath}/flow/${flowId}/version/${version}`);
}

async function restoreVersion({
  basePath,
  flowId,
  version,
  restore,
  onDone,
}: {
  basePath: string;
  flowId: string;
  version: FlowVersion;
  restore: (input: {
    flowId: string;
    data: { flowlibDefinition: FlowVersion['flowlibDefinition'] };
  }) => Promise<unknown>;
  onDone: () => void;
}) {
  if (typeof window !== 'undefined') {
    const confirmed = window.confirm(
      `Restore flow version v${version.version} as the latest version? This creates a new version using that definition.`,
    );
    if (!confirmed) {
      return;
    }
  }

  await restore({
    flowId,
    data: { flowlibDefinition: version.flowlibDefinition },
  });
  onDone();

  if (typeof window !== 'undefined') {
    window.location.assign(`${basePath}/flow/${flowId}`);
  }
}
