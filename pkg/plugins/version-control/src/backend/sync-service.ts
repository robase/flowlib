// =============================================================================
// Version Control Sync Service — orchestrates push/pull/publish operations
// =============================================================================

import type { GitProvider, TreeCommitFile } from './git-provider';
import { StaleHeadError } from './git-provider';
import type { PluginDatabaseApi } from '@flowlib/core';
import type { VcDB } from './db-types';
import type { VersionControlPluginOptions } from './types';
import type {
  VcSyncConfig,
  VcSyncHistoryRecord,
  VcSyncResult,
  VcSyncStatus,
  ConfigureSyncInput,
  VcFlowDiffResponse,
} from '../shared/types';
import { normalizeSyncDirection } from '../shared/types';
import { emitSdkSource } from '@flowlib/sdk';
import { substituteCredentialEnvs } from './credential-env-substitution';
import {
  buildAggregateManifest,
  buildFlowManifestEntry,
  decorateWithRequires,
  extractRequiredEnvs,
  manifestFilePath,
  serializeManifest,
  type FlowManifestEntry,
} from './manifest';
import { LockManager, LockBusyError } from './lock-manager';
import { buildSideBySideDiff } from './diff';

interface FlowRow {
  id: string;
  name: string;
  description: string | null;
  tags: string | null;
}

interface FlowVersionRow {
  flow_id: string;
  version: number;
  flowlib_definition: string;
}

type Logger = {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
};

/**
 * Result for one flow inside a batch push. Per-flow status because the
 * outcome is per-flow even though the underlying commit is atomic — e.g.
 * a flow can be `'unchanged'` (no diff vs. last push) while others in the
 * batch are `'pushed'`.
 */
export interface BatchPushFlowResult {
  flowId: string;
  status: 'pushed' | 'unchanged' | 'error';
  filePath?: string;
  blobSha?: string;
  version?: number;
  error?: string;
}

export interface BatchPushResult {
  /** True iff a commit landed (some flows may still be `'unchanged'`). */
  success: boolean;
  /** New commit SHA when at least one flow was pushed. */
  commitSha?: string;
  /** Per-flow outcome. */
  results: BatchPushFlowResult[];
  /** Top-level error when the whole batch fails (e.g. stale head, no flows). */
  error?: string;
}

export class VcSyncService {
  /**
   * Per-flow lock manager. Public for tests; production callers should go
   * through the service methods which acquire locks correctly.
   */
  readonly locks = new LockManager();

  constructor(
    private provider: GitProvider,
    private options: VersionControlPluginOptions,
    private logger: Logger,
  ) {}

  // =========================================================================
  // Configuration
  // =========================================================================

  async configureSyncForFlow(
    db: PluginDatabaseApi,
    flowId: string,
    input: ConfigureSyncInput,
  ): Promise<VcSyncConfig> {
    // Check if flow exists
    const flows = await db
      .kysely<VcDB>()
      .selectFrom('flowlib_flows')
      .where('id', '=', flowId)
      .select(['id', 'name'])
      .execute();
    if (flows.length === 0) {
      throw new Error(`Flow not found: ${flowId}`);
    }

    const flow = flows[0];
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const repo = input.repo ?? this.options.repo;
    const branch = input.branch ?? this.options.defaultBranch ?? 'main';
    const mode = input.mode ?? this.options.mode ?? 'direct-commit';
    const syncDirection = input.syncDirection ?? this.options.syncDirection ?? 'write';
    const filePath = input.filePath ?? this.buildFilePath(flow.name);

    // Upsert — delete existing config for this flow first
    await db.execute('DELETE FROM flowlib_vc_sync_config WHERE flow_id = ?', [flowId]);

    await db.execute(
      `INSERT INTO flowlib_vc_sync_config (id, flow_id, provider, repo, branch, file_path, mode, sync_direction, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, flowId, this.provider.id, repo, branch, filePath, mode, syncDirection, true, now, now],
    );

    return this.getSyncConfig(db, flowId) as Promise<VcSyncConfig>;
  }

  async getSyncConfig(db: PluginDatabaseApi, flowId: string): Promise<VcSyncConfig | null> {
    const rows = await db
      .kysely<VcDB>()
      .selectFrom('flowlib_vc_sync_config')
      .where('flow_id', '=', flowId)
      .selectAll()
      .execute();
    if (rows.length === 0) {
      return null;
    }
    return mapSyncConfigRow(rows[0] as unknown as VcSyncConfigRow);
  }

  async disconnectFlow(db: PluginDatabaseApi, flowId: string): Promise<void> {
    const config = await this.getSyncConfig(db, flowId);
    if (!config) {
      return;
    }

    // If there's an active PR, close it
    if (config.activePrNumber) {
      try {
        await this.provider.closePullRequest(
          config.repo,
          config.activePrNumber,
          'Sync disconnected — flow unlinked from version control.',
        );
      } catch (err) {
        this.logger.warn('Failed to close PR on disconnect', { error: (err as Error).message });
      }
    }

    // If there's a draft branch, try to clean it up
    if (config.draftBranch) {
      try {
        await this.provider.deleteBranch(config.repo, config.draftBranch);
      } catch {
        // Ignore — branch may already be deleted
      }
    }

    await db.execute('DELETE FROM flowlib_vc_sync_config WHERE flow_id = ?', [flowId]);
  }

  // =========================================================================
  // Push (DB → Remote)
  // =========================================================================

  /**
   * Atomically push N flows in a single Git Trees commit.
   *
   * Atomicity guarantee (the §C / Phase 0c promise):
   *   - All N files land in one commit, OR
   *   - No files land at all (failure mid-construction).
   *
   * Never a partial state. Even a network kill between blob uploads and the
   * final ref-advance leaves the branch unchanged — the unreferenced blobs
   * become GitHub-side garbage and are GC'd.
   *
   * Concurrency:
   *   - Acquires a per-flow lock for every flowId in the batch up front. If
   *     ANY flow is currently locked (concurrent push or pull), throws
   *     `LockBusyError` immediately — the batch never partially executes.
   *   - Captures the branch head SHA as `expectedParentSha`. If another
   *     writer races and advances the branch between capture and ref-update,
   *     the provider throws `StaleHeadError` and we surface a 409-equivalent
   *     `success: false` with the stale-SHA detail.
   *
   * Per-flow direction enforcement: any flow whose `syncDirection === 'read'`
   * is excluded from the batch with `status: 'error'` and the rest proceed
   * normally — one read-only flow doesn't poison the batch.
   */
  async pushFlowsAtomic(
    db: PluginDatabaseApi,
    flowIds: string[],
    options: { commitMessage: string; identity?: string },
  ): Promise<BatchPushResult> {
    if (flowIds.length === 0) {
      return { success: false, error: 'No flows specified', results: [] };
    }

    // Dedup — caller may pass the same id twice; locks would block themselves.
    const unique = Array.from(new Set(flowIds));

    try {
      return await this.locks.withMultipleTryLocks(unique, async () => {
        return this.runBatchPushUnderLock(db, unique, options);
      });
    } catch (err) {
      if (err instanceof LockBusyError) {
        return {
          success: false,
          error: `Push contention: ${err.lockKey} is already being pushed or pulled`,
          results: [],
        };
      }
      throw err;
    }
  }

  /**
   * Inner batch-push routine — runs with all per-flow locks held. Separated
   * so the lock-acquisition wrapper stays small and the unhappy-path branches
   * are easy to follow.
   */
  private async runBatchPushUnderLock(
    db: PluginDatabaseApi,
    flowIds: string[],
    options: { commitMessage: string; identity?: string },
  ): Promise<BatchPushResult> {
    // 1. Resolve config + render content for each flow. Skip read-only flows
    //    with an error result — they don't reach the commit.
    const items: Array<{
      flowId: string;
      config: VcSyncConfig;
      filePath: string;
      content: string;
      version: number;
    }> = [];
    const results: BatchPushFlowResult[] = [];

    for (const flowId of flowIds) {
      const config = await this.getSyncConfig(db, flowId);
      if (!config || !config.enabled) {
        results.push({
          flowId,
          status: 'error',
          error: 'Flow is not connected to version control',
        });
        continue;
      }
      if (config.syncDirection === 'read') {
        results.push({
          flowId,
          status: 'error',
          error: 'Read-only flow excluded from batch',
        });
        continue;
      }

      try {
        const { content, version } = await this.exportFlow(db, flowId);
        items.push({ flowId, config, filePath: config.filePath, content, version });
      } catch (err) {
        results.push({
          flowId,
          status: 'error',
          error: `Export failed: ${(err as Error).message}`,
        });
      }
    }

    if (items.length === 0) {
      return {
        success: false,
        error: 'No flows survived pre-flight; nothing to commit',
        results,
      };
    }

    // 2. Determine the branch we're committing to. Single-branch-per-instance
    //    for v1 (D10): every flow in the batch must be configured for the
    //    same repo + branch, otherwise we'd need a multi-commit fan-out.
    const repo = items[0].config.repo;
    const branch = items[0].config.branch;
    for (const item of items) {
      if (item.config.repo !== repo || item.config.branch !== branch) {
        return {
          success: false,
          error: `Mixed repo/branch in batch (${item.flowId} targets ${item.config.repo}@${item.config.branch}, expected ${repo}@${branch}). v1 supports single-branch batches only.`,
          results,
        };
      }
    }

    // 3. Capture the branch head as our expected parent SHA. Any concurrent
    //    writer that advances the branch between this read and our ref-update
    //    will trigger a StaleHeadError below.
    const branchInfo = await this.provider.getBranch(repo, branch);
    if (!branchInfo) {
      return {
        success: false,
        error: `Branch ${branch} not found in ${repo}`,
        results,
      };
    }

    // 4. Build the file list and call the Trees-API atomic primitive.
    const files: TreeCommitFile[] = items.map((i) => ({ path: i.filePath, content: i.content }));

    // Phase 4 — regenerate the aggregate manifest from the latest source of
    // every flow in the batch. Each flow's substituted content was prepared
    // in step 1; we extract its requires and key the entry by flowId. The
    // serialized manifest joins the same Trees commit so it lands atomically
    // with the flows it describes.
    //
    // For batch pushes, only the flows being pushed contribute their entries.
    // A more complete manifest would also include flows not in this batch
    // but already on the branch — Phase 5 (operator UX) handles that via a
    // dedicated maintenance refresh.
    const manifestEntries: FlowManifestEntry[] = items.map((i) =>
      buildFlowManifestEntry({
        content: i.content,
        flowId: i.flowId,
        name: '',
        filePath: i.filePath,
      }),
    );
    // Hydrate names from flow rows so the manifest entry is human-readable.
    const itemFlowIds = items.map((i) => i.flowId);
    if (itemFlowIds.length > 0) {
      const flowMeta = await db
        .kysely<VcDB>()
        .selectFrom('flowlib_flows')
        .where('id', 'in', itemFlowIds)
        .select(['id', 'name'])
        .execute();
      const nameById = new Map(flowMeta.map((r) => [r.id, r.name]));
      for (const e of manifestEntries) {
        e.name = nameById.get(e.flowId) ?? '';
      }
    }
    const aggregate = buildAggregateManifest(manifestEntries);
    const manifestPath = manifestFilePath(this.options.path ?? 'workflows/');
    files.push({ path: manifestPath, content: serializeManifest(aggregate) });

    let commitSha: string;
    let perFileBlob: Record<string, string>;

    try {
      const tree = await this.provider.createTreeCommit(repo, {
        branch,
        message: options.commitMessage,
        files,
        expectedParentSha: branchInfo.sha,
      });
      commitSha = tree.commitSha;
      perFileBlob = Object.fromEntries(tree.files.map((f) => [f.path, f.blobSha]));
    } catch (err) {
      if (err instanceof StaleHeadError) {
        // No commit landed. Surface as a clean conflict so callers can refresh + retry.
        for (const item of items) {
          results.push({
            flowId: item.flowId,
            status: 'error',
            error: 'Branch advanced concurrently — refresh and retry',
          });
          await this.recordHistory(db, item.flowId, 'conflict', {
            version: item.version,
            message: `Stale parent ${err.expectedSha} (branch is now ${err.actualSha})`,
            createdBy: options.identity,
          });
        }
        return {
          success: false,
          error: err.message,
          results,
        };
      }
      throw err;
    }

    // 5. Persist per-flow state and history. Each item gets its blob SHA as
    //    `lastCommitSha` — semantically "the file blob we last knew about" —
    //    which matches how the reconciler / pull path compare incoming
    //    blob SHAs.
    for (const item of items) {
      const blobSha = perFileBlob[item.filePath];
      await this.updateConfigAfterSync(db, item.flowId, blobSha, item.version);
      await this.recordHistory(db, item.flowId, 'push', {
        commitSha,
        version: item.version,
        message: options.commitMessage,
        createdBy: options.identity,
      });
      results.push({
        flowId: item.flowId,
        status: 'pushed',
        filePath: item.filePath,
        blobSha,
        version: item.version,
      });
    }

    this.logger.info('Atomic batch push committed', {
      repo,
      branch,
      commitSha,
      flowsPushed: items.length,
      flowsErrored: results.filter((r) => r.status === 'error').length,
    });

    return { success: true, commitSha, results };
  }

  async pushFlow(db: PluginDatabaseApi, flowId: string, identity?: string): Promise<VcSyncResult> {
    // Per-flow lock (Phase 0c) — concurrent push/pull on the same flow gets
    // a clean error rather than racing on lastCommitSha.
    if (!this.locks.tryAcquire(flowId)) {
      return {
        success: false,
        error: 'Operation already in progress for this flow — try again shortly',
        action: 'push',
      };
    }
    try {
      return await this.runPushFlow(db, flowId, identity);
    } finally {
      this.locks.release(flowId);
    }
  }

  private async runPushFlow(
    db: PluginDatabaseApi,
    flowId: string,
    identity?: string,
  ): Promise<VcSyncResult> {
    const config = await this.requireConfig(db, flowId);

    if (config.syncDirection === 'read') {
      return {
        success: false,
        error: 'Push is not allowed — this flow is configured for read-only sync.',
        action: 'push',
      };
    }

    const { content, version } = await this.exportFlow(db, flowId);

    try {
      if (config.mode === 'direct-commit') {
        return await this.directCommit(db, config, content, version, identity);
      } else if (config.mode === 'pr-per-save') {
        return await this.commitToPrBranch(db, config, content, version, identity, true);
      } else {
        // pr-per-publish: commit to draft branch, no PR yet
        return await this.commitToDraftBranch(db, config, content, version, identity);
      }
    } catch (err) {
      const message = (err as Error).message;

      // SHA mismatch = conflict
      if (message.includes('409') || message.includes('sha')) {
        await this.recordHistory(db, flowId, 'conflict', { version, message, createdBy: identity });
        return {
          success: false,
          error: 'Conflict: remote file has changed. Use force-push or force-pull.',
          action: 'conflict',
        };
      }

      throw err;
    }
  }

  async forcePushFlow(
    db: PluginDatabaseApi,
    flowId: string,
    identity?: string,
  ): Promise<VcSyncResult> {
    const config = await this.requireConfig(db, flowId);
    const { content, version } = await this.exportFlow(db, flowId);

    // Get current remote SHA (if file exists) to force update
    const remote = await this.provider.getFileContent(config.repo, config.filePath, config.branch);
    const sha = remote?.sha;

    const result = await this.provider.createOrUpdateFile(
      config.repo,
      config.filePath,
      content,
      `chore(flow): force-push ${this.flowFileName(config.filePath)} v${version}`,
      { branch: config.branch, sha },
    );

    await this.updateConfigAfterSync(db, flowId, result.commitSha, version);
    await this.recordHistory(db, flowId, 'push', {
      commitSha: result.commitSha,
      version,
      message: 'Force push (local wins)',
      createdBy: identity,
    });

    return { success: true, commitSha: result.commitSha, action: 'push' };
  }

  // =========================================================================
  // Pull (Remote → DB)
  // =========================================================================

  async pullFlow(db: PluginDatabaseApi, flowId: string, identity?: string): Promise<VcSyncResult> {
    // Per-flow lock (Phase 0c). Reconciler-driven pulls and manual pulls
    // both serialize through this — second concurrent caller gets a clean
    // error rather than competing for the version-row insert.
    if (!this.locks.tryAcquire(flowId)) {
      return {
        success: false,
        error: 'Operation already in progress for this flow — try again shortly',
        action: 'pull',
      };
    }
    try {
      return await this.runPullFlow(db, flowId, identity);
    } finally {
      this.locks.release(flowId);
    }
  }

  private async runPullFlow(
    db: PluginDatabaseApi,
    flowId: string,
    identity?: string,
  ): Promise<VcSyncResult> {
    const config = await this.requireConfig(db, flowId);

    if (config.syncDirection === 'write') {
      return {
        success: false,
        error: 'Pull is not allowed — this flow is configured for write-only sync.',
        action: 'pull',
      };
    }

    const remote = await this.provider.getFileContent(config.repo, config.filePath, config.branch);

    if (!remote) {
      return { success: false, error: 'Remote file not found', action: 'pull' };
    }

    // Check if we're already in sync
    if (config.lastCommitSha && remote.sha === config.lastCommitSha) {
      return { success: true, action: 'pull' }; // Already up to date
    }

    // Pass the remote blob SHA so importFlowContent can short-circuit on
    // (flowId, commitSha) idempotency — replica HA and double-fired webhooks
    // both produce duplicate calls; only one inserts a flow_versions row.
    const result = await this.importFlowContent(db, flowId, remote.content, identity, remote.sha);
    await this.updateConfigAfterSync(
      db,
      flowId,
      remote.sha,
      result.inserted ? result.version : null,
    );
    if (result.inserted) {
      await this.recordHistory(db, flowId, 'pull', {
        commitSha: remote.sha,
        version: result.version,
        message: 'Pulled from remote',
        createdBy: identity,
      });
    }

    return { success: true, commitSha: remote.sha, action: 'pull' };
  }

  async forcePullFlow(
    db: PluginDatabaseApi,
    flowId: string,
    identity?: string,
  ): Promise<VcSyncResult> {
    // Same as pull but ignores SHA check — always overwrites local.
    // Force-pull intentionally skips idempotency: the operator may want to
    // re-import the same SHA after a failed migration or DB restore.
    const config = await this.requireConfig(db, flowId);
    const remote = await this.provider.getFileContent(config.repo, config.filePath, config.branch);

    if (!remote) {
      return { success: false, error: 'Remote file not found', action: 'pull' };
    }

    await this.importFlowContent(db, flowId, remote.content, identity);
    await this.updateConfigAfterSync(db, flowId, remote.sha, null);
    await this.recordHistory(db, flowId, 'pull', {
      commitSha: remote.sha,
      message: 'Force pull (remote wins)',
      createdBy: identity,
    });

    return { success: true, commitSha: remote.sha, action: 'pull' };
  }

  // =========================================================================
  // Publish (pr-per-publish mode — open PR from draft branch)
  // =========================================================================

  async publishFlow(
    db: PluginDatabaseApi,
    flowId: string,
    identity?: string,
  ): Promise<VcSyncResult> {
    const config = await this.requireConfig(db, flowId);

    if (config.mode !== 'pr-per-publish') {
      return {
        success: false,
        error: 'Publish is only available in pr-per-publish mode',
        action: 'pr-created',
      };
    }

    if (!config.draftBranch) {
      return {
        success: false,
        error: 'No draft branch found — push changes first',
        action: 'pr-created',
      };
    }

    // Check if there's already an active PR
    if (config.activePrNumber) {
      const pr = await this.provider.getPullRequest(config.repo, config.activePrNumber);
      if (pr.state === 'open') {
        return {
          success: true,
          prNumber: config.activePrNumber,
          prUrl: config.activePrUrl ?? undefined,
          action: 'pr-created',
        };
      }
      // PR was closed/merged — clear it and create a new one
    }

    const fileName = this.flowFileName(config.filePath);
    const pr = await this.provider.createPullRequest(config.repo, {
      title: `feat(flow): publish ${fileName}`,
      body: `Automated PR from Flowlib — publishing flow changes for \`${fileName}\`.`,
      head: config.draftBranch,
      base: config.branch,
    });

    await db.execute(
      'UPDATE flowlib_vc_sync_config SET active_pr_number = ?, active_pr_url = ?, updated_at = ? WHERE flow_id = ?',
      [pr.number, pr.url, new Date().toISOString(), flowId],
    );

    await this.recordHistory(db, flowId, 'pr-created', {
      prNumber: pr.number,
      message: `PR #${pr.number} created`,
      createdBy: identity,
    });

    return { success: true, prNumber: pr.number, prUrl: pr.url, action: 'pr-created' };
  }

  // =========================================================================
  // Status & History
  // =========================================================================

  async getFlowSyncStatus(
    db: PluginDatabaseApi,
    flowId: string,
  ): Promise<{
    status: VcSyncStatus;
    config: VcSyncConfig | null;
    lastSync: VcSyncHistoryRecord | null;
  }> {
    const config = await this.getSyncConfig(db, flowId);
    if (!config) {
      return { status: 'not-connected', config: null, lastSync: null };
    }

    const history = await db
      .kysely<VcDB>()
      .selectFrom('flowlib_vc_sync_history')
      .where('flow_id', '=', flowId)
      .orderBy('created_at', 'desc')
      .limit(1)
      .selectAll()
      .execute();

    const lastSync =
      history.length > 0 ? mapHistoryRow(history[0] as unknown as VcSyncHistoryRow) : null;

    let status: VcSyncStatus = 'synced';
    if (!config.enabled) {
      status = 'not-connected';
    } else if (lastSync?.action === 'conflict') {
      status = 'conflict';
    } else if (!config.lastSyncedAt) {
      status = 'pending';
    } else {
      // Check if there are newer versions than what was synced.
      // Kysely's `fn.max<number>` types the result as `number` even when
      // the underlying driver returns string for BIGINT (Postgres).
      const versionRow = await db
        .kysely<VcDB>()
        .selectFrom('flowlib_flow_versions')
        .where('flow_id', '=', flowId)
        .select((eb) => eb.fn.max<number>('version').as('version'))
        .executeTakeFirst();
      const latestVersion =
        versionRow?.version !== null && versionRow?.version !== undefined
          ? Number(versionRow.version)
          : null;
      if (latestVersion && config.lastSyncedVersion && latestVersion > config.lastSyncedVersion) {
        status = 'pending';
      }
    }

    return { status, config, lastSync };
  }

  async getSyncHistory(
    db: PluginDatabaseApi,
    flowId: string,
    limit = 20,
  ): Promise<VcSyncHistoryRecord[]> {
    const rows = await db
      .kysely<VcDB>()
      .selectFrom('flowlib_vc_sync_history')
      .where('flow_id', '=', flowId)
      .orderBy('created_at', 'desc')
      .limit(limit)
      .selectAll()
      .execute();
    return rows.map((row) => mapHistoryRow(row as unknown as VcSyncHistoryRow));
  }

  async listSyncedFlows(
    db: PluginDatabaseApi,
  ): Promise<Array<VcSyncConfig & { flowName: string }>> {
    const rows = await db
      .kysely<VcDB>()
      .selectFrom('flowlib_vc_sync_config')
      .innerJoin('flowlib_flows', 'flowlib_flows.id', 'flowlib_vc_sync_config.flow_id')
      .selectAll('flowlib_vc_sync_config')
      .select('flowlib_flows.name as flow_name')
      .orderBy('flowlib_vc_sync_config.updated_at', 'desc')
      .execute();
    return rows.map((r) => ({
      ...mapSyncConfigRow(r as unknown as VcSyncConfigRow),
      flowName: (r as unknown as { flow_name: string }).flow_name,
    }));
  }

  /**
   * Build the Phase 7 diff-viewer payload for one tracked flow.
   *
   * Remote (left side) is the configured branch file. Local (right side) is
   * the latest DB version emitted through the same export pipeline used by
   * push, so reviewers see the exact source that force-push would write.
   */
  async getFlowDiff(db: PluginDatabaseApi, flowId: string): Promise<VcFlowDiffResponse> {
    const config = await this.requireConfig(db, flowId);
    const local = await this.exportFlow(db, flowId);
    const remote = await this.provider.getFileContent(config.repo, config.filePath, config.branch);
    const remoteContent = remote?.content ?? '';
    const lines = buildSideBySideDiff(remoteContent, local.content);

    return {
      flowId,
      filePath: config.filePath,
      repo: config.repo,
      branch: config.branch,
      hasRemote: Boolean(remote),
      hasChanges: !remote || remote.content !== local.content,
      local: {
        version: local.version,
        content: local.content,
      },
      remote: {
        sha: remote?.sha ?? null,
        content: remote?.content ?? null,
      },
      lines,
    };
  }

  // =========================================================================
  // Flow deletion hook
  // =========================================================================

  async onFlowDeleted(db: PluginDatabaseApi, flowId: string): Promise<void> {
    const config = await this.getSyncConfig(db, flowId);
    if (!config) {
      return;
    }

    // Delete the file from the remote
    try {
      const remote = await this.provider.getFileContent(
        config.repo,
        config.filePath,
        config.branch,
      );
      if (remote) {
        await this.provider.deleteFile(
          config.repo,
          config.filePath,
          `chore(flow): delete ${this.flowFileName(config.filePath)}`,
          { branch: config.branch, sha: remote.sha },
        );
        this.logger.info('Deleted flow file from remote', { flowId, filePath: config.filePath });
      }
    } catch (err) {
      this.logger.warn('Failed to delete flow file from remote', {
        flowId,
        error: (err as Error).message,
      });
    }

    // Close active PR if any
    if (config.activePrNumber) {
      try {
        await this.provider.closePullRequest(
          config.repo,
          config.activePrNumber,
          'Flow deleted — closing PR.',
        );
      } catch {
        // Ignore
      }
    }

    // Clean up draft branch
    if (config.draftBranch) {
      try {
        await this.provider.deleteBranch(config.repo, config.draftBranch);
      } catch {
        // Ignore
      }
    }

    // DB records cascade-delete from the flows FK
  }

  // =========================================================================
  // Internal — commit strategies
  // =========================================================================

  private async directCommit(
    db: PluginDatabaseApi,
    config: VcSyncConfig,
    content: string,
    version: number,
    identity?: string,
  ): Promise<VcSyncResult> {
    const sha = config.lastCommitSha ?? undefined;

    // Try to get remote SHA if we don't have one (first push)
    let remoteSha = sha;
    if (!remoteSha) {
      const remote = await this.provider.getFileContent(
        config.repo,
        config.filePath,
        config.branch,
      );
      remoteSha = remote?.sha;
    }

    const result = await this.provider.createOrUpdateFile(
      config.repo,
      config.filePath,
      content,
      `chore(flow): update ${this.flowFileName(config.filePath)} v${version}`,
      { branch: config.branch, sha: remoteSha },
    );

    await this.updateConfigAfterSync(db, config.flowId, result.commitSha, version);
    await this.recordHistory(db, config.flowId, 'push', {
      commitSha: result.commitSha,
      version,
      message: `Direct commit v${version}`,
      createdBy: identity,
    });

    return { success: true, commitSha: result.commitSha, action: 'push' };
  }

  private async commitToPrBranch(
    db: PluginDatabaseApi,
    config: VcSyncConfig,
    content: string,
    version: number,
    identity?: string,
    openPr: boolean = true,
  ): Promise<VcSyncResult> {
    const branchName = config.draftBranch ?? `flowlib/flow/${this.flowSlug(config.filePath)}`;

    // Create branch if it doesn't exist
    const existing = await this.provider.getBranch(config.repo, branchName);
    if (!existing) {
      await this.provider.createBranch(config.repo, branchName, config.branch);
    }

    // Get current file SHA on the branch
    const remote = await this.provider.getFileContent(config.repo, config.filePath, branchName);

    const result = await this.provider.createOrUpdateFile(
      config.repo,
      config.filePath,
      content,
      `chore(flow): update ${this.flowFileName(config.filePath)} v${version}`,
      { branch: branchName, sha: remote?.sha },
    );

    // Save draft branch reference
    await db.execute(
      'UPDATE flowlib_vc_sync_config SET draft_branch = ?, updated_at = ? WHERE flow_id = ?',
      [branchName, new Date().toISOString(), config.flowId],
    );

    let prNumber = config.activePrNumber ?? undefined;
    let prUrl = config.activePrUrl ?? undefined;

    // Open PR if needed
    if (openPr && !prNumber) {
      const pr = await this.provider.createPullRequest(config.repo, {
        title: `feat(flow): update ${this.flowFileName(config.filePath)}`,
        body: `Automated PR from Flowlib — flow changes for \`${this.flowFileName(config.filePath)}\`.`,
        head: branchName,
        base: config.branch,
      });
      prNumber = pr.number;
      prUrl = pr.url;

      await db.execute(
        'UPDATE flowlib_vc_sync_config SET active_pr_number = ?, active_pr_url = ?, updated_at = ? WHERE flow_id = ?',
        [prNumber, prUrl, new Date().toISOString(), config.flowId],
      );

      await this.recordHistory(db, config.flowId, 'pr-created', {
        commitSha: result.commitSha,
        prNumber,
        version,
        message: `PR #${prNumber} created`,
        createdBy: identity,
      });
    } else {
      await this.recordHistory(db, config.flowId, 'push', {
        commitSha: result.commitSha,
        version,
        message: `Updated PR branch v${version}`,
        createdBy: identity,
      });
    }

    await this.updateConfigAfterSync(db, config.flowId, result.commitSha, version);

    return {
      success: true,
      commitSha: result.commitSha,
      prNumber,
      prUrl,
      action: prNumber ? 'pr-created' : 'push',
    };
  }

  private async commitToDraftBranch(
    db: PluginDatabaseApi,
    config: VcSyncConfig,
    content: string,
    version: number,
    identity?: string,
  ): Promise<VcSyncResult> {
    // Same as PR branch commit but without opening a PR
    return this.commitToPrBranch(db, config, content, version, identity, false);
  }

  // =========================================================================
  // Internal — flow export / import
  // =========================================================================

  private async exportFlow(
    db: PluginDatabaseApi,
    flowId: string,
  ): Promise<{ content: string; version: number }> {
    const flows = await db
      .kysely<VcDB>()
      .selectFrom('flowlib_flows')
      .where('id', '=', flowId)
      .select(['id', 'name', 'description', 'tags'])
      .execute();
    if (flows.length === 0) {
      throw new Error(`Flow not found: ${flowId}`);
    }
    const flow = flows[0] as unknown as FlowRow;

    const versions = await db
      .kysely<VcDB>()
      .selectFrom('flowlib_flow_versions')
      .where('flow_id', '=', flowId)
      .orderBy('version', 'desc')
      .limit(1)
      .select(['flow_id', 'version', 'flowlib_definition'])
      .execute();
    if (versions.length === 0) {
      throw new Error(`No versions found for flow: ${flowId}`);
    }
    const fv = versions[0] as unknown as FlowVersionRow;

    const definition =
      typeof fv.flowlib_definition === 'string'
        ? JSON.parse(fv.flowlib_definition)
        : fv.flowlib_definition;

    let tags: string[] | undefined;
    if (flow.tags) {
      try {
        tags = typeof flow.tags === 'string' ? JSON.parse(flow.tags) : flow.tags;
      } catch {
        tags = undefined;
      }
    }

    // Flow name may contain spaces / punctuation; derive a JS-safe export
    // identifier for the emitter. Adds a `Flow` suffix only when the name
    // doesn't already end with one so exports read naturally.
    const flowName = toFlowExportName(flow.name);

    const { code } = emitSdkSource(definition, {
      flowName,
      includeJsonFooter: true,
      metadata: {
        // Embed flowId so the pull side can resolve by id, not file path.
        // Renames change the path but the id is stable for the flow's lifetime.
        flowId: flow.id,
        name: flow.name,
        ...(flow.description ? { description: flow.description } : {}),
        ...(tags && tags.length > 0 ? { tags } : {}),
      },
    });

    // Rewrite raw `credentialId: "cred_xxx"` refs in the human-readable
    // section to `{{env.XXX_CREDENTIAL}}` so committed flow files are
    // portable across Flowlib instances. The footer keeps the raw id for
    // authoritative round-trip on pull.
    const substituted = substituteCredentialEnvs(code);

    // Phase 4 — prepend the `@flowlib-requires` header listing the env
    // credentials this flow needs. Reviewer sees deps at the top of the
    // diff; the aggregate manifest in `_manifest.json` is the contract.
    const required = extractRequiredEnvs(substituted);
    const content = decorateWithRequires(substituted, required);

    return { content, version: fv.version };
  }

  private async importFlowContent(
    db: PluginDatabaseApi,
    flowId: string,
    content: string,
    identity?: string,
    /**
     * Blob SHA of the remote file being imported. When provided, the import
     * is gated by `flowlib_vc_pull_commits` — a duplicate `(flowId, sha)`
     * means another replica already pulled this commit, so we no-op rather
     * than insert a duplicate flow_versions row. Phase 0c idempotency.
     */
    commitSha?: string,
  ): Promise<{ inserted: boolean; version: number }> {
    // Parse the .flow.ts content statically — no eval/jiti to avoid
    // arbitrary code execution from untrusted remote files.
    const definition = parseFlowTsContent(content);

    if (
      !definition ||
      typeof definition !== 'object' ||
      !Array.isArray(definition.nodes) ||
      !Array.isArray(definition.edges)
    ) {
      throw new Error(
        'Imported .flow.ts file did not produce a valid FlowlibDefinition. ' +
          'Expected an object with "nodes" and "edges" arrays.',
      );
    }

    // If the file has an embedded flowId, it must match the one we're
    // importing into. A mismatch means we'd silently overwrite the wrong
    // flow's history — refuse rather than corrupt. Files without a footer
    // (legacy or hand-written) skip this check.
    const embeddedFlowId = definition.metadata?.flowId;
    if (typeof embeddedFlowId === 'string' && embeddedFlowId !== flowId) {
      throw new Error(
        `Embedded flowId mismatch: file declares flowId=${embeddedFlowId} ` +
          `but pull target is flowId=${flowId}. Refusing to import to avoid ` +
          `corrupting flow history. Look up the flow by embedded id first.`,
      );
    }

    // Replica idempotency (D8): if another replica/process already pulled
    // this exact (flowId, commitSha) pair, the composite-PK insert below
    // will conflict and we no-op. We check first so the no-op path is
    // observable in the return value.
    if (commitSha) {
      const existing = await db
        .kysely<VcDB>()
        .selectFrom('flowlib_vc_pull_commits')
        .where('flow_id', '=', flowId)
        .where('commit_sha', '=', commitSha)
        .select('version_inserted')
        .execute();
      if (existing.length > 0) {
        const v = existing[0].version_inserted ?? 0;
        this.logger.debug('Pull is idempotent — commit already imported', {
          flowId,
          commitSha,
          version: v,
        });
        return { inserted: false, version: v };
      }
    }

    // Get current latest version number. Kysely's `fn.max<number>` types it
    // as `number`; coerce to handle Postgres's BIGINT-as-string return.
    const maxRow = await db
      .kysely<VcDB>()
      .selectFrom('flowlib_flow_versions')
      .where('flow_id', '=', flowId)
      .select((eb) => eb.fn.max<number>('version').as('version'))
      .executeTakeFirst();
    const nextVersion =
      (maxRow?.version !== null && maxRow?.version !== undefined ? Number(maxRow.version) : 0) + 1;

    // Insert new flow version. Persist only the canonical fields; metadata
    // is descriptive and lives on the flows row, not the version blob.
    const defJson = JSON.stringify({
      nodes: definition.nodes,
      edges: definition.edges,
    });

    await db.execute(
      `INSERT INTO flowlib_flow_versions (flow_id, version, flowlib_definition, created_at, created_by)
       VALUES (?, ?, ?, ?, ?)`,
      [flowId, nextVersion, defJson, new Date().toISOString(), identity ?? null],
    );

    // Update flow's live version
    await db.execute(
      'UPDATE flowlib_flows SET live_version_number = ?, updated_at = ? WHERE id = ?',
      [nextVersion, new Date().toISOString(), flowId],
    );

    // Record the idempotency token AFTER the version row exists — if the
    // version insert fails, we don't lock out a future retry.
    if (commitSha) {
      await db.execute(
        `INSERT INTO flowlib_vc_pull_commits (flow_id, commit_sha, version_inserted, pulled_at)
         VALUES (?, ?, ?, ?)`,
        [flowId, commitSha, nextVersion, new Date().toISOString()],
      );
    }

    this.logger.info('Flow imported from remote', {
      flowId,
      version: nextVersion,
    });
    return { inserted: true, version: nextVersion };
  }

  /**
   * Look up a sync config by the flowId embedded in a `.flow.ts` file's
   * footer. Used by rename-aware pull paths and the reconciler (Phase 0b)
   * to find the local row when the remote file path may have changed.
   *
   * Returns null when no row matches that flowId, indicating either a
   * fresh flow being introduced (caller decides whether to create one)
   * or a foreign flowId from an unrelated repo (caller may refuse).
   */
  async findFlowConfigByEmbeddedId(
    db: PluginDatabaseApi,
    embeddedFlowId: string,
  ): Promise<VcSyncConfig | null> {
    const rows = await db
      .kysely<VcDB>()
      .selectFrom('flowlib_vc_sync_config')
      .where('flow_id', '=', embeddedFlowId)
      .selectAll()
      .limit(1)
      .execute();
    return rows.length > 0 ? mapSyncConfigRow(rows[0] as unknown as VcSyncConfigRow) : null;
  }

  // =========================================================================
  // Internal — helpers
  // =========================================================================

  private buildFilePath(flowName: string): string {
    const basePath = this.options.path ?? 'workflows/';
    const slug = flowName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    return `${basePath}${slug}.flow.ts`;
  }

  private flowFileName(filePath: string): string {
    return filePath.split('/').pop() ?? filePath;
  }

  private flowSlug(filePath: string): string {
    const name = this.flowFileName(filePath);
    return name.replace(/\.flow\.ts$/, '');
  }

  private async requireConfig(db: PluginDatabaseApi, flowId: string): Promise<VcSyncConfig> {
    const config = await this.getSyncConfig(db, flowId);
    if (!config) {
      throw new Error(`Flow ${flowId} is not connected to version control`);
    }
    if (!config.enabled) {
      throw new Error(`Version control sync is disabled for flow ${flowId}`);
    }
    return config;
  }

  private async updateConfigAfterSync(
    db: PluginDatabaseApi,
    flowId: string,
    commitSha: string,
    version: number | null,
  ): Promise<void> {
    const now = new Date().toISOString();
    if (version !== null) {
      await db.execute(
        'UPDATE flowlib_vc_sync_config SET last_synced_at = ?, last_commit_sha = ?, last_synced_version = ?, updated_at = ? WHERE flow_id = ?',
        [now, commitSha, version, now, flowId],
      );
    } else {
      await db.execute(
        'UPDATE flowlib_vc_sync_config SET last_synced_at = ?, last_commit_sha = ?, updated_at = ? WHERE flow_id = ?',
        [now, commitSha, now, flowId],
      );
    }
  }

  private async recordHistory(
    db: PluginDatabaseApi,
    flowId: string,
    action: import('../shared/types').VcSyncAction,
    opts: {
      commitSha?: string;
      prNumber?: number;
      version?: number;
      message?: string;
      createdBy?: string;
    },
  ): Promise<void> {
    await db.execute(
      `INSERT INTO flowlib_vc_sync_history (id, flow_id, action, commit_sha, pr_number, version, message, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        crypto.randomUUID(),
        flowId,
        action,
        opts.commitSha ?? null,
        opts.prNumber ?? null,
        opts.version ?? null,
        opts.message ?? null,
        new Date().toISOString(),
        opts.createdBy ?? null,
      ],
    );
  }
}

// =============================================================================
// Row mappers (snake_case DB rows → camelCase types)
// =============================================================================

interface VcSyncConfigRow {
  id: string;
  flow_id: string;
  provider: string;
  repo: string;
  branch: string;
  file_path: string;
  mode: string;
  sync_direction: string;
  last_synced_at: string | null;
  last_commit_sha: string | null;
  last_synced_version: number | null;
  draft_branch: string | null;
  active_pr_number: number | null;
  active_pr_url: string | null;
  enabled: boolean | number;
  created_at: string;
  updated_at: string;
}

interface VcSyncHistoryRow {
  id: string;
  flow_id: string;
  action: string;
  commit_sha: string | null;
  pr_number: number | null;
  version: number | null;
  message: string | null;
  created_at: string;
  created_by: string | null;
}

/**
 * Convert a human-authored flow name into a JS-safe export identifier for the
 * emitter. Non-alphanumeric runs collapse to camelCase boundaries; a leading
 * digit gets an `_` prefix; empty strings fall back to `myFlow`. Adds a
 * trailing `Flow` only when the name doesn't already end in one.
 */
function toFlowExportName(raw: string): string {
  const segments = raw.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  if (segments.length === 0) {
    return 'myFlow';
  }
  const camel = segments
    .map((s, i) =>
      i === 0 ? s.charAt(0).toLowerCase() + s.slice(1) : s.charAt(0).toUpperCase() + s.slice(1),
    )
    .join('');
  const base = /^[0-9]/.test(camel) ? `_${camel}` : camel;
  return /[Ff]low$/.test(base) ? base : `${base}Flow`;
}

function mapSyncConfigRow(r: VcSyncConfigRow): VcSyncConfig {
  return {
    id: r.id,
    flowId: r.flow_id,
    provider: r.provider,
    repo: r.repo,
    branch: r.branch,
    filePath: r.file_path,
    mode: r.mode as VcSyncConfig['mode'],
    syncDirection: normalizeSyncDirection(r.sync_direction),
    lastSyncedAt: r.last_synced_at,
    lastCommitSha: r.last_commit_sha,
    lastSyncedVersion: r.last_synced_version,
    draftBranch: r.draft_branch,
    activePrNumber: r.active_pr_number,
    activePrUrl: r.active_pr_url,
    enabled: r.enabled === true || r.enabled === 1,
  };
}

function mapHistoryRow(r: VcSyncHistoryRow): VcSyncHistoryRecord {
  return {
    id: r.id,
    flowId: r.flow_id,
    action: r.action as VcSyncHistoryRecord['action'],
    commitSha: r.commit_sha,
    prNumber: r.pr_number,
    version: r.version,
    message: r.message,
    createdAt: r.created_at,
    createdBy: r.created_by,
  };
}

// =============================================================================
// Static .flow.ts parser — extracts definition without eval
// =============================================================================

/**
 * Parsed `.flow.ts` content.
 *
 * `metadata` is surfaced when the file carries a JSON footer (the emitted form),
 * so callers can read embedded fields like `flowId` for identity-based pull
 * lookup. Hand-written files without a footer return `metadata: undefined`.
 */
export interface ParsedFlowTsContent {
  nodes: unknown[];
  edges: unknown[];
  metadata?: Record<string, unknown>;
}

/**
 * Parse a .flow.ts file content to extract the FlowlibDefinition.
 *
 * This is a static parser that does NOT evaluate the TypeScript file.
 * It works by extracting the `defineFlow({ ... })` call's argument as a
 * JS object literal string and parsing it with a safe JSON5-like approach.
 *
 * Falls back to extracting raw `nodes` and `edges` arrays if defineFlow
 * wrapper is not found.
 */
export function parseFlowTsContent(content: string): ParsedFlowTsContent | null {
  // Strategy 1 (preferred): Look for the embedded JSON block comment.
  // The serializer embeds `/* @flowlib-definition {...} */` for reliable round-tripping.
  const jsonCommentMatch = content.match(/\/\*\s*@flowlib-definition\s+([\s\S]*?)\s*\*\//);
  if (jsonCommentMatch) {
    try {
      const footer = JSON.parse(jsonCommentMatch[1]) as {
        nodes: unknown[];
        edges: unknown[];
        metadata?: Record<string, unknown>;
      };
      if (Array.isArray(footer.nodes) && Array.isArray(footer.edges)) {
        return {
          nodes: footer.nodes,
          edges: footer.edges,
          metadata:
            footer.metadata && typeof footer.metadata === 'object' ? footer.metadata : undefined,
        };
      }
    } catch {
      // Fall through to strategy 2
    }
  }

  // Strategy 2 (fallback): Extract the defineFlow({ ... }) argument.
  // Used for hand-written or older .flow.ts files without the JSON comment.
  const defineFlowMatch = content.match(/defineFlow\s*\(\s*\{/);
  if (defineFlowMatch && defineFlowMatch.index !== undefined) {
    const startIdx = defineFlowMatch.index + defineFlowMatch[0].length - 1; // { position
    const objStr = extractBalancedBraces(content, startIdx);
    if (objStr) {
      try {
        const parsed = parseObjectLiteral(objStr);
        if (parsed && Array.isArray(parsed.nodes) && Array.isArray(parsed.edges)) {
          return { nodes: parsed.nodes, edges: parsed.edges };
        }
      } catch {
        // Fall through
      }
    }
  }

  return null;
}

/**
 * Extract the embedded flowId from a `.flow.ts` file's JSON footer, if any.
 *
 * The reconciler (Phase 0b) and rename-aware pull paths use this to find the
 * local flow row by id rather than file path — paths can change on rename
 * but flowId is stable for the lifetime of the flow.
 *
 * Returns null when:
 *   - the file has no footer (legacy / hand-written file),
 *   - the footer has no `metadata.flowId` field (file emitted by an older
 *     version of the plugin before flowId embedding),
 *   - the footer parse fails.
 */
export function extractFlowIdFromContent(content: string): string | null {
  const parsed = parseFlowTsContent(content);
  const id = parsed?.metadata?.flowId;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/** Extract a balanced {} block from a string starting at the given { index */
function extractBalancedBraces(str: string, startIdx: number): string | null {
  let depth = 0;
  let inString: string | false = false;
  let escaped = false;

  for (let i = startIdx; i < str.length; i++) {
    const ch = str[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === '\\') {
      escaped = true;
      continue;
    }

    if (inString) {
      if (ch === inString) {
        inString = false;
      }
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
      continue;
    }

    if (ch === '{' || ch === '[') {
      depth++;
    } else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) {
        return str.slice(startIdx, i + 1);
      }
    }
  }

  return null;
}

/**
 * Parse a JS object literal string into a JSON-compatible value.
 *
 * Handles: unquoted keys, single-quoted strings, trailing commas,
 * template literals (simplified), and function calls by converting
 * them to strings.
 */
function parseObjectLiteral(objStr: string): Record<string, unknown> | null {
  try {
    // Normalize JS object literal to JSON:
    // 1. Strip single-line comments
    let normalized = objStr.replace(/\/\/.*$/gm, '');
    // 2. Strip multi-line comments
    normalized = normalized.replace(/\/\*[\s\S]*?\*\//g, '');
    // 3. Replace single quotes with double quotes (outside existing double quotes)
    normalized = replaceQuotes(normalized);
    // 4. Quote unquoted keys
    normalized = normalized.replace(/(?<=[{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)(?=\s*:)/g, '"$1"');
    // 5. Remove trailing commas before } or ]
    normalized = normalized.replace(/,\s*([}\]])/g, '$1');
    // 6. Replace function calls like input("ref", {...}) with a placeholder string
    // This handles the helper calls in the nodes array
    normalized = replaceFunctionCalls(normalized);

    return JSON.parse(normalized);
  } catch {
    return null;
  }
}

/** Replace single-quoted strings with double-quoted */
function replaceQuotes(str: string): string {
  let result = '';
  let inDouble = false;
  let inSingle = false;
  let escaped = false;

  for (let i = 0; i < str.length; i++) {
    const ch = str[i];

    if (escaped) {
      result += ch;
      escaped = false;
      continue;
    }

    if (ch === '\\') {
      result += ch;
      escaped = true;
      continue;
    }

    if (!inSingle && ch === '"') {
      inDouble = !inDouble;
      result += ch;
    } else if (!inDouble && ch === "'") {
      inSingle = !inSingle;
      result += '"';
    } else {
      result += ch;
    }
  }

  return result;
}

/**
 * Replace function calls like `input("ref", { ... })` with a JSON object
 * that captures the node structure. This handles the SDK helper calls
 * in the serialized .flow.ts nodes array.
 *
 * Pattern: `helperName("refId", { params })` → `{ "type": "helperName", "referenceId": "refId", "params": { ... } }`
 * Also handles namespaced: `ns.helperName("refId", { ... })`
 */
function replaceFunctionCalls(str: string): string {
  // Match function calls: word.word( or word( at the start of array items
  const callPattern =
    /([a-zA-Z_$][\w$]*\.[a-zA-Z_$][\w$]*|[a-zA-Z_$][\w$]*)\s*\(\s*"([^"]*)"\s*,\s*(\{)/g;

  let result = str;
  let match: RegExpExecArray | null;
  let offset = 0;

  // Reset lastIndex
  callPattern.lastIndex = 0;

  while ((match = callPattern.exec(str)) !== null) {
    const fnName = match[1];
    const refId = match[2];
    const braceStart = match.index + match[0].length - 1;

    const paramsBlock = extractBalancedBraces(str, braceStart);
    if (!paramsBlock) {
      continue;
    }

    // Find the closing ) after the params block
    const afterParams = braceStart + paramsBlock.length;
    let closeParen = afterParams;
    while (closeParen < str.length && str[closeParen] !== ')') {
      closeParen++;
    }

    const fullCall = str.slice(match.index, closeParen + 1);
    const replacement = `{ "__type": "${fnName}", "referenceId": "${refId}", "params": ${paramsBlock} }`;

    result =
      result.slice(0, match.index + offset) +
      replacement +
      result.slice(match.index + offset + fullCall.length);

    offset += replacement.length - fullCall.length;
  }

  return result;
}
