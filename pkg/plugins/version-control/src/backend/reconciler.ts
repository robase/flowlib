// =============================================================================
// Phase 0b — Polling Reconciler
//
// The reconciler is the **primary correctness path** for keeping the instance
// in sync with the configured branch. Webhooks are a latency optimization
// only — a missed webhook with no backstop would leave production silently
// behind forever.
//
// Each tick:
//   1. Fetches the current branch head SHA.
//   2. Compares against `flowlib_vc_instance_state.last_instance_commit_sha`.
//      If equal, the tick is a no-op (cheap — one HTTP round-trip).
//   3. If different, lists the tree at the new head, walks every `.flow.ts`,
//      reads its embedded `flowId` from the JSON footer, looks up the local
//      sync config by id (NOT by file path — rename-aware), and pulls.
//   4. Advances `last_instance_commit_sha` only after every file is processed.
//
// Key properties:
//   - **Idempotent**: pulling at the same SHA twice is a no-op the second
//     time. Replica HA: two pods receiving the same webhook tick the same
//     position; second tick sees `head === lastInstanceCommitSha`.
//   - **Lossless**: even if a webhook is dropped entirely, the next tick
//     picks up the change because comparison is against the previous
//     `lastInstanceCommitSha`, not the webhook payload.
//   - **Webhook-payload-agnostic**: webhooks never carry the SHA; they're
//     just wake-up signals. Squash-merge / rebase / reorder don't matter.
//   - **Partial-success safe**: a parse failure on one file is logged but
//     doesn't abort the tick or block other files.
//
// Concurrency:
//   - In-memory mutex (`inFlight`) per-process. A tick already running drops
//     subsequent triggers as `skipped`.
//   - Phase 0c adds the DB-level `(flowId, commitSha)` unique constraint
//     to handle multi-replica races at the version-row level.
// =============================================================================

import type { PluginDatabaseApi } from '@flowlib/core';
import type { VcDB } from './db-types';
import type { GitProvider } from './git-provider';
import type { VcSyncService } from './sync-service';
import { extractFlowIdFromContent } from './sync-service';
import { StatusCacheService } from './status-compute';

/** Why a tick fired — surfaced in logs and tick-result telemetry. */
export type ReconcilerTickReason = 'interval' | 'webhook' | 'manual' | 'startup';

/** Outcome of a single tick. */
export type ReconcilerTickStatus = 'no-op' | 'advanced' | 'skipped' | 'error';

export interface ReconcilerTickResult {
  status: ReconcilerTickStatus;
  reason: ReconcilerTickReason;
  /** Branch head SHA observed during the tick. Absent on `error`. */
  branchSha?: string;
  /** Number of flows that had a new version inserted. */
  flowsAffected?: number;
  /** Files we walked but skipped (no embedded id, unknown id, or already in sync). */
  filesSkipped?: number;
  /** Files that failed to parse or import — logged + counted, not fatal. */
  filesErrored?: number;
  /** Top-level error message (set when `status === 'error'`). */
  error?: string;
}

export interface ReconcilerHealth {
  enabled: boolean;
  intervalMs: number;
  inFlight: boolean;
  lastTickAt: string | null;
  lastTickStatus: ReconcilerTickStatus | null;
  lastTickError: string | null;
  lastInstanceCommitSha: string | null;
}

export interface ReconcilerOptions {
  /** Repository in `owner/name` form. */
  repo: string;
  /** Branch this reconciler tracks. v1: single branch per instance. */
  branch: string;
  /** Path prefix in the repo to scan (e.g. `flows/`). */
  path: string;
  /** Auto-tick interval in ms. Set 0 / undefined to disable. */
  intervalMs?: number;
  /** Logger — must accept `(message, structuredFields?)` calls. */
  logger: {
    debug(message: string, ...args: unknown[]): void;
    info(message: string, ...args: unknown[]): void;
    warn(message: string, ...args: unknown[]): void;
    error(message: string, ...args: unknown[]): void;
  };
  /** Git provider (uses `getBranch`, `listTree`, `getFileContent`). */
  provider: GitProvider;
  /** Sync service — used for `findFlowConfigByEmbeddedId` + `pullFlow`. */
  syncService: VcSyncService;
  /**
   * Get a fresh DB connection. Called on every tick because long-running
   * background work shouldn't pin a single connection across the lifetime
   * of the interval — pools recycle, drivers reconnect.
   */
  getDb: () => Promise<PluginDatabaseApi> | PluginDatabaseApi;
}

interface InstanceStateRow {
  id: string;
  repo: string;
  branch: string;
  last_instance_commit_sha: string | null;
  last_reconciler_tick_at: string | null;
  last_reconciler_error: string | null;
}

export class ReconcilerService {
  private inFlight = false;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private lastTickAt: string | null = null;
  private lastTickStatus: ReconcilerTickStatus | null = null;
  private lastTickError: string | null = null;
  private lastInstanceCommitShaMemo: string | null = null;
  // Phase 2 — refresh status chips at the end of every tick. The reconciler
  // is the natural cadence for this: per-flow facts (current version, last
  // PR, conflict history) are stable between ticks anyway, and the dashboard
  // wants a single SELECT regardless of flow count.
  private readonly statusCache = new StatusCacheService();

  constructor(private readonly opts: ReconcilerOptions) {}

  // ---------------------------------------------------------------------------
  // Public lifecycle
  // ---------------------------------------------------------------------------

  /** Begin auto-ticking on `intervalMs`. Safe to call multiple times. */
  start(): void {
    if (this.intervalHandle) {
      return;
    }
    const ms = this.opts.intervalMs ?? 0;
    if (ms <= 0) {
      return; // explicit opt-out
    }
    this.intervalHandle = setInterval(() => {
      // Fire-and-forget; tick records its own errors.
      this.tick('interval').catch((err) => {
        this.opts.logger.error('reconciler interval tick threw unexpectedly', {
          error: (err as Error).message,
        });
      });
    }, ms);
    // Ensure the interval doesn't keep the process alive in CLI/test contexts.
    if (typeof this.intervalHandle === 'object' && 'unref' in this.intervalHandle) {
      (this.intervalHandle as { unref: () => void }).unref();
    }
  }

  /** Stop auto-ticking. Idempotent. */
  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  /** Wake the reconciler immediately — used by webhook handlers. */
  async triggerOutOfCycle(): Promise<ReconcilerTickResult> {
    return this.tick('webhook');
  }

  /** Operator-facing health summary. */
  getHealth(): ReconcilerHealth {
    return {
      enabled: this.intervalHandle !== null,
      intervalMs: this.opts.intervalMs ?? 0,
      inFlight: this.inFlight,
      lastTickAt: this.lastTickAt,
      lastTickStatus: this.lastTickStatus,
      lastTickError: this.lastTickError,
      lastInstanceCommitSha: this.lastInstanceCommitShaMemo,
    };
  }

  // ---------------------------------------------------------------------------
  // The tick
  // ---------------------------------------------------------------------------

  /**
   * Run one reconciler tick. Idempotent and safe to call concurrently —
   * a second concurrent call returns `{ status: 'skipped' }` immediately.
   */
  async tick(reason: ReconcilerTickReason): Promise<ReconcilerTickResult> {
    if (this.inFlight) {
      return { status: 'skipped', reason };
    }
    this.inFlight = true;
    try {
      const branchInfo = await this.opts.provider.getBranch(this.opts.repo, this.opts.branch);
      if (!branchInfo) {
        const msg = `Branch ${this.opts.branch} not found in ${this.opts.repo}`;
        await this.recordTickError(msg);
        return { status: 'error', reason, error: msg };
      }
      const head = branchInfo.sha;

      const db = await this.opts.getDb();
      const state = await this.readInstanceState(db);

      // No change since last tick → no-op. Still bump tick timestamp so
      // health reflects the reconciler is alive, and refresh the chip
      // cache so any locally-driven state changes (new dirty version, PR
      // closed) propagate to the dashboard within one tick interval.
      if (state && state.last_instance_commit_sha === head) {
        await this.writeInstanceState(db, { sha: head, error: null });
        this.lastInstanceCommitShaMemo = head;
        try {
          await this.statusCache.refreshAll(db);
        } catch (err) {
          this.opts.logger.warn('reconciler: status cache refresh failed', {
            error: (err as Error).message,
          });
        }
        this.recordTick('no-op');
        return { status: 'no-op', reason, branchSha: head };
      }

      this.opts.logger.info('reconciler advancing', {
        repo: this.opts.repo,
        branch: this.opts.branch,
        from: state?.last_instance_commit_sha ?? null,
        to: head,
        reason,
      });

      const entries = await this.opts.provider.listTree(this.opts.repo, head, {
        path: this.opts.path,
      });
      const flowFiles = entries.filter((e) => e.type === 'blob' && e.path.endsWith('.flow.ts'));

      let flowsAffected = 0;
      let filesSkipped = 0;
      let filesErrored = 0;

      for (const entry of flowFiles) {
        try {
          const result = await this.reconcileFile(db, entry.path);
          if (result === 'pulled') {
            flowsAffected++;
          } else {
            filesSkipped++;
          }
        } catch (err) {
          filesErrored++;
          this.opts.logger.error('reconciler: failed to import flow', {
            path: entry.path,
            error: (err as Error).message,
          });
          // Continue — partial-success per §B in IMPROVEMENTS.md.
        }
      }

      await this.writeInstanceState(db, { sha: head, error: null });
      this.lastInstanceCommitShaMemo = head;

      // Phase 2 — refresh chip cache so the dashboard reflects the new
      // post-pull state for every flow. Best-effort: a failure here is
      // logged but doesn't downgrade the tick result, since the pull
      // itself succeeded and the cache will recover on the next tick.
      try {
        await this.statusCache.refreshAll(db);
      } catch (err) {
        this.opts.logger.warn('reconciler: status cache refresh failed', {
          error: (err as Error).message,
        });
      }

      this.recordTick('advanced');
      return {
        status: 'advanced',
        reason,
        branchSha: head,
        flowsAffected,
        filesSkipped,
        filesErrored,
      };
    } catch (err) {
      const msg = (err as Error).message;
      await this.recordTickError(msg);
      return { status: 'error', reason, error: msg };
    } finally {
      this.inFlight = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Per-file reconciliation
  // ---------------------------------------------------------------------------

  /**
   * Process one `.flow.ts` file at the current branch head:
   *   - Fetch content + blob SHA via Contents API.
   *   - Extract embedded flowId from the JSON footer.
   *   - Look up local config by flowId (rename-aware — file path may differ).
   *   - If the file path moved, update `vc_sync_config.file_path` so the
   *     per-flow pull/push paths see the new location.
   *   - If `last_commit_sha` already matches, skip (already in sync).
   *   - Otherwise, delegate to `syncService.pullFlow` which performs the
   *     parse + version insert + history record.
   *
   * Returns:
   *   - `'pulled'`  — a new version was inserted.
   *   - `'skipped'` — file lacks an embedded id, references an unknown
   *                   flowId, or is already in sync.
   *
   * Throws on parse / network / DB errors so the tick loop can record them
   * as `filesErrored` without aborting the whole tick.
   */
  private async reconcileFile(db: PluginDatabaseApi, path: string): Promise<'pulled' | 'skipped'> {
    const remote = await this.opts.provider.getFileContent(this.opts.repo, path, this.opts.branch);
    if (!remote) {
      return 'skipped';
    }

    const embeddedId = extractFlowIdFromContent(remote.content);
    if (!embeddedId) {
      this.opts.logger.warn('reconciler: file has no embedded flowId, skipping', { path });
      return 'skipped';
    }

    const config = await this.opts.syncService.findFlowConfigByEmbeddedId(db, embeddedId);
    if (!config) {
      // The file references a flowId that doesn't exist locally. This is the
      // "foreign repo" case from §N (bootstrap) — Phase 5 surfaces a UI for
      // it. For now, log + skip rather than silently creating orphan rows.
      this.opts.logger.info('reconciler: unknown flowId, skipping', {
        path,
        embeddedFlowId: embeddedId,
      });
      return 'skipped';
    }

    if (config.lastCommitSha === remote.sha) {
      return 'skipped';
    }

    // Rename detection: the file moved. Update the local file_path so the
    // next push writes to the new path. This is the rename-aware bit that
    // makes Phase 0a pay off.
    if (config.filePath !== path) {
      this.opts.logger.info('reconciler: detected flow rename', {
        flowId: embeddedId,
        oldPath: config.filePath,
        newPath: path,
      });
      await db.execute(
        'UPDATE flowlib_vc_sync_config SET file_path = ?, updated_at = ? WHERE flow_id = ?',
        [path, new Date().toISOString(), embeddedId],
      );
    }

    const result = await this.opts.syncService.pullFlow(db, embeddedId);
    if (!result.success) {
      throw new Error(result.error ?? 'pullFlow returned unsuccessful');
    }
    return 'pulled';
  }

  // ---------------------------------------------------------------------------
  // Instance state read/write
  // ---------------------------------------------------------------------------

  private async readInstanceState(db: PluginDatabaseApi): Promise<InstanceStateRow | null> {
    const row = await db
      .kysely<VcDB>()
      .selectFrom('flowlib_vc_instance_state')
      .where('repo', '=', this.opts.repo)
      .where('branch', '=', this.opts.branch)
      .selectAll()
      .limit(1)
      .executeTakeFirst();
    return (row as InstanceStateRow | undefined) ?? null;
  }

  private async writeInstanceState(
    db: PluginDatabaseApi,
    state: { sha: string | null; error: string | null },
  ): Promise<void> {
    const now = new Date().toISOString();
    const existing = await this.readInstanceState(db);
    if (existing) {
      await db.execute(
        `UPDATE flowlib_vc_instance_state
         SET last_instance_commit_sha = ?, last_reconciler_tick_at = ?, last_reconciler_error = ?, updated_at = ?
         WHERE id = ?`,
        [state.sha, now, state.error, now, existing.id],
      );
    } else {
      await db.execute(
        `INSERT INTO flowlib_vc_instance_state
         (id, repo, branch, last_instance_commit_sha, last_reconciler_tick_at, last_reconciler_error, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          crypto.randomUUID(),
          this.opts.repo,
          this.opts.branch,
          state.sha,
          now,
          state.error,
          now,
          now,
        ],
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Tick telemetry
  // ---------------------------------------------------------------------------

  private recordTick(status: ReconcilerTickStatus): void {
    this.lastTickAt = new Date().toISOString();
    this.lastTickStatus = status;
    this.lastTickError = null;
  }

  private async recordTickError(message: string): Promise<void> {
    this.lastTickAt = new Date().toISOString();
    this.lastTickStatus = 'error';
    this.lastTickError = message;
    try {
      const db = await this.opts.getDb();
      await this.writeInstanceState(db, { sha: null, error: message });
    } catch {
      // Best-effort — DB may itself be the failing dependency.
    }
  }
}
