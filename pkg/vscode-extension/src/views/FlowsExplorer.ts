/**
 * Activity-bar tree of flows, expandable to show recent runs per flow.
 *
 * Layout:
 *   Flows
 *   ├─ some-flow                   ← click: open .flow.ts editor
 *   │  ├─ ✓ a1b2c3d4  2m ago       ← click: open editor + jump to runs view
 *   │  └─ ✗ e5f6g7h8  1h ago
 *   └─ another-flow
 *
 * Flow items are read from the embedded backend's `listFlows()` (which
 * scans the workspace for `.flow.ts` files). Run children are fetched
 * lazily on first expand via `listRuns(fileUri)`.
 */

import * as vscode from 'vscode';
import type { Backend, RunSummary } from '../backend/Backend';
import { getExtensionLogger } from '../util/logger';

export type FlowsExplorerItem =
  | { kind: 'flow'; flowId: string; fileUri?: string; label: string; description?: string }
  | {
      kind: 'run';
      runId: string;
      flowId: string;
      flowVersion?: number;
      fileUri?: string;
      label: string;
      description?: string;
      status: string;
    }
  | { kind: 'placeholder'; label: string; description?: string }
  | { kind: 'error'; label: string; description?: string }
  | { kind: 'no-runs'; flowId: string };

const STATUS_ICONS: Record<string, string> = {
  SUCCESS: 'pass',
  COMPLETED: 'pass',
  FAILED: 'error',
  ERROR: 'error',
  RUNNING: 'sync~spin',
  PENDING: 'circle-outline',
  CANCELLED: 'circle-slash',
  PAUSED: 'debug-pause',
};

export class FlowsExplorerProvider
  implements vscode.TreeDataProvider<FlowsExplorerItem>, vscode.Disposable
{
  private readonly emitter = new vscode.EventEmitter<FlowsExplorerItem | undefined | void>();
  readonly onDidChangeTreeData = this.emitter.event;

  private client: Backend | null = null;
  private flowsCache: FlowsExplorerItem[] | null = null;
  /** Per-flow runs cache; key = flow id (file URI in embedded mode). */
  private readonly runsCache = new Map<string, FlowsExplorerItem[]>();
  /**
   * Per-flow latest run status. Drives the parent flow row's icon, so a
   * collapsed flow visibly transitions to a spinner the moment one of
   * its runs starts and back to a check / × on completion.
   */
  private readonly flowStatusCache = new Map<string, string>();
  /** Per-flow live subscription disposers — one per visible flow. */
  private readonly subscriptions = new Map<string, () => void>();

  setClient(client: Backend | null): void {
    this.disposeAllSubscriptions();
    this.client = client;
    this.flowsCache = null;
    this.runsCache.clear();
    this.flowStatusCache.clear();
    this.emitter.fire();
  }

  refresh(): void {
    this.disposeAllSubscriptions();
    this.flowsCache = null;
    this.runsCache.clear();
    this.flowStatusCache.clear();
    this.emitter.fire();
  }

  dispose(): void {
    this.disposeAllSubscriptions();
    this.emitter.dispose();
  }

  private disposeAllSubscriptions(): void {
    for (const dispose of this.subscriptions.values()) {
      try {
        dispose();
      } catch {
        /* disposers must not throw, but be defensive */
      }
    }
    this.subscriptions.clear();
  }

  /** Refresh runs for a single flow without rebuilding the whole tree. */
  refreshFlowRuns(flowId: string): void {
    this.runsCache.delete(flowId);
    this.emitter.fire();
  }

  getTreeItem(item: FlowsExplorerItem): vscode.TreeItem {
    if (item.kind === 'flow') {
      const tree = new vscode.TreeItem(item.label, vscode.TreeItemCollapsibleState.Collapsed);
      // Show the latest run's status as the row icon when known. A flow
      // with an in-flight run shows the spinner even while collapsed; a
      // failed last run shows the error icon. Idle flows fall back to
      // the static node-graph glyph.
      const status = this.flowStatusCache.get(item.flowId);
      const iconId = status ? (STATUS_ICONS[status] ?? 'symbol-event') : 'symbol-event';
      tree.description =
        item.description ?? (status && status !== 'SUCCESS' ? status.toLowerCase() : undefined);
      tree.iconPath = new vscode.ThemeIcon(iconId);
      tree.contextValue = 'flowlib.flow';
      tree.id = item.flowId; // stable id so TreeView can `.reveal(item)` later
      if (item.fileUri) {
        tree.resourceUri = vscode.Uri.parse(item.fileUri);
        // Custom command opens the file AND expands the row to show
        // its runs. Plain `vscode.openWith` would only do half the job.
        tree.command = {
          command: 'flowlib.openFlow',
          title: 'Open flow',
          arguments: [item],
        };
      }
      return tree;
    }
    if (item.kind === 'run') {
      const tree = new vscode.TreeItem(item.label, vscode.TreeItemCollapsibleState.None);
      tree.description = item.description;
      tree.iconPath = new vscode.ThemeIcon(STATUS_ICONS[item.status] ?? 'question');
      tree.contextValue = 'flowlib.run';
      tree.command = {
        command: 'flowlib.viewRun',
        title: 'View run',
        arguments: [item.runId, item.fileUri ?? item.flowId, item.flowVersion],
      };
      return tree;
    }
    if (item.kind === 'no-runs') {
      const tree = new vscode.TreeItem('No runs yet', vscode.TreeItemCollapsibleState.None);
      tree.description = 'Click Run on the canvas';
      tree.iconPath = new vscode.ThemeIcon('info');
      return tree;
    }
    if (item.kind === 'placeholder') {
      const tree = new vscode.TreeItem(item.label, vscode.TreeItemCollapsibleState.None);
      tree.description = item.description;
      tree.iconPath = new vscode.ThemeIcon('plug');
      tree.command = { command: 'flowlib.connect', title: 'Connect…' };
      return tree;
    }
    // error
    const tree = new vscode.TreeItem(item.label, vscode.TreeItemCollapsibleState.None);
    tree.description = item.description;
    tree.iconPath = new vscode.ThemeIcon('warning');
    return tree;
  }

  async getChildren(parent?: FlowsExplorerItem): Promise<FlowsExplorerItem[]> {
    if (!this.client) {
      return [{ kind: 'placeholder', label: 'Connect to a backend…' }];
    }
    if (!parent) {
      return this.getRootItems();
    }
    if (parent.kind === 'flow') {
      return this.getRunItems(parent.flowId, parent.fileUri);
    }
    return [];
  }

  /**
   * Required by VSCode for `treeView.reveal()` to work, even for root
   * items. Flow items live at the root (parent = undefined). Run items
   * live under their flow — we look it up by id in the cached root list.
   */
  getParent(item: FlowsExplorerItem): FlowsExplorerItem | undefined {
    if (item.kind === 'run') {
      const root = this.flowsCache;
      if (!root) {
        return undefined;
      }
      return root.find((r) => r.kind === 'flow' && r.flowId === item.flowId);
    }
    return undefined;
  }

  // ── Internals ──────────────────────────────────────────────────────────

  private async getRootItems(): Promise<FlowsExplorerItem[]> {
    if (this.flowsCache) {
      return this.flowsCache;
    }
    const client = this.client;
    if (!client) {
      return [{ kind: 'placeholder', label: 'Connect to a backend…' }];
    }
    try {
      const flows = await client.listFlows();
      this.flowsCache = flows.map<FlowsExplorerItem>((f) => ({
        kind: 'flow',
        flowId: f.id,
        fileUri: typeof f.fileUri === 'string' ? f.fileUri : undefined,
        label: f.name ?? f.id,
        description: f.description,
      }));
      if (this.flowsCache.length === 0) {
        this.flowsCache = [{ kind: 'placeholder', label: 'No flows on this backend.' }];
      } else {
        // Subscribe to every visible flow so collapsed rows still react
        // to runs starting / completing. Run in the background — the
        // tree should render immediately; status icons and run children
        // populate as the listRuns probes resolve.
        void this.attachLiveSubscriptions(client, this.flowsCache);
      }
      return this.flowsCache;
    } catch (err) {
      const msg = (err as Error).message;
      getExtensionLogger().error('flows explorer fetch failed', { error: msg });
      return [{ kind: 'error', label: `Error: ${msg}` }];
    }
  }

  /**
   * Attach a live-update subscription for every visible flow and prime
   * the runs / status caches with an initial fetch. Idempotent — flows
   * already subscribed are skipped, so calling this on cache refresh
   * won't double-subscribe.
   */
  private async attachLiveSubscriptions(
    client: Backend,
    flows: FlowsExplorerItem[],
  ): Promise<void> {
    for (const f of flows) {
      if (f.kind !== 'flow' || this.subscriptions.has(f.flowId)) {
        continue;
      }
      const flowId = f.flowId;
      const fileUri = f.fileUri;
      try {
        const dispose = await client.subscribeFlowRuns(flowId, () => {
          if (this.client === client) {
            void this.refreshFlowFromBackend(flowId, fileUri);
          }
        });
        if (this.client !== client) {
          // Backend swapped while we were subscribing — discard.
          dispose();
          continue;
        }
        this.subscriptions.set(flowId, dispose);
      } catch (err) {
        getExtensionLogger().warn('subscribeFlowRuns failed', {
          flowId,
          error: (err as Error).message,
        });
      }
      // Prime the caches even if subscribe failed — at minimum we want
      // the parent icon to reflect the latest known status on first
      // open. Fire-and-forget; errors are logged inside.
      void this.refreshFlowFromBackend(flowId, fileUri);
    }
  }

  /**
   * Re-fetch the runs list for a single flow and update both the runs
   * cache (used by `getRunItems` when the row is expanded) and the flow
   * status cache (used by the parent row's icon). Fires the tree-data
   * emitter so the next render reflects the new state.
   */
  private async refreshFlowFromBackend(flowId: string, fileUri?: string): Promise<void> {
    const client = this.client;
    if (!client) {
      return;
    }
    try {
      const runs = await client.listRuns(flowId);
      if (this.client !== client) {
        return;
      }
      const items = runs.map<FlowsExplorerItem>((r) => ({
        kind: 'run',
        runId: r.id,
        flowId,
        flowVersion: r.flowVersion,
        fileUri,
        status: r.status,
        label: r.id.slice(0, 8),
        description: formatRunMeta(r),
      }));
      if (items.length > 0) {
        this.runsCache.set(flowId, items);
      } else {
        this.runsCache.delete(flowId);
      }
      const latest = runs[0]?.status;
      if (latest) {
        this.flowStatusCache.set(flowId, latest);
      } else {
        this.flowStatusCache.delete(flowId);
      }
      this.emitter.fire();
    } catch (err) {
      getExtensionLogger().warn('refreshFlowFromBackend failed', {
        flowId,
        error: (err as Error).message,
      });
    }
  }

  private async getRunItems(flowId: string, fileUri?: string): Promise<FlowsExplorerItem[]> {
    // Cache only positive results — empty / error / no-runs we re-fetch
    // on every expand so a flow that had no runs at first expansion
    // doesn't stay stuck on "No runs yet" after the user kicks one off.
    const cached = this.runsCache.get(flowId);
    if (cached && cached.length > 0 && cached[0]?.kind === 'run') {
      return cached;
    }
    const client = this.client;
    if (!client) {
      return [];
    }
    try {
      const runs = await client.listRuns(flowId);
      if (runs.length === 0) {
        return [{ kind: 'no-runs', flowId }];
      }
      const items = runs.map<FlowsExplorerItem>((r: RunSummary) => ({
        kind: 'run',
        runId: r.id,
        flowId,
        flowVersion: r.flowVersion,
        fileUri,
        status: r.status,
        label: r.id.slice(0, 8),
        description: formatRunMeta(r),
      }));
      this.runsCache.set(flowId, items);
      return items;
    } catch (err) {
      const msg = (err as Error).message;
      getExtensionLogger().warn('flows explorer: listRuns failed', { flowId, error: msg });
      return [{ kind: 'error', label: `Error: ${msg}` }];
    }
  }
}

function formatRunMeta(r: RunSummary): string {
  const ago = formatAgo(r.startedAt);
  const dur = formatDuration(r);
  return [r.status, ago, dur].filter(Boolean).join(' · ');
}

function formatAgo(iso?: string): string {
  if (!iso) {
    return '';
  }
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) {
    return 'now';
  }
  if (ms < 60_000) {
    return Math.round(ms / 1000) + 's ago';
  }
  if (ms < 3_600_000) {
    return Math.round(ms / 60_000) + 'm ago';
  }
  if (ms < 86_400_000) {
    return Math.round(ms / 3_600_000) + 'h ago';
  }
  return Math.round(ms / 86_400_000) + 'd ago';
}

function formatDuration(r: RunSummary): string {
  if (typeof r.duration === 'number') {
    return formatMillis(r.duration);
  }
  if (r.startedAt && r.completedAt) {
    return formatMillis(new Date(r.completedAt).getTime() - new Date(r.startedAt).getTime());
  }
  return '';
}

function formatMillis(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) {
    return '';
  }
  if (ms < 1000) {
    return ms + 'ms';
  }
  if (ms < 60_000) {
    return (ms / 1000).toFixed(1) + 's';
  }
  return Math.round(ms / 1000) + 's';
}
