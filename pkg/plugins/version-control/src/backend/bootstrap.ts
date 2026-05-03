// =============================================================================
// Phase 5 — Bootstrap & first-time use
//
// When the plugin is first installed (or a fresh prod replica is deployed),
// the local DB and the configured git branch may be in any of four states.
// The bootstrap surface lets the operator pick the right action for each:
//
//   ┌──────────────────┬──────────────────┬─────────────────────────────────┐
//   │ Repo state       │ DB state         │ Recommended action              │
//   ├──────────────────┼──────────────────┼─────────────────────────────────┤
//   │ empty            │ has flows        │ push-all                        │
//   │ has flows        │ empty            │ hydrate (the prod-replica path) │
//   │ has flows        │ has matching ids │ merge (per-flow reconcile UI)   │
//   │ has flows        │ has foreign ids  │ refuse / pick fresh repo        │
//   └──────────────────┴──────────────────┴─────────────────────────────────┘
//
// Phase 5 ships the data path and the highest-leverage action: `hydrate`,
// because that's how a fresh prod replica gets populated. `push-all`
// delegates to `pushFlowsAtomic` (Phase 0c). `merge` requires a per-flow
// reconciliation UI and returns 501 from the endpoint until Phase 5
// frontend lands.
//
// Detection rules from PLAN.md §7:
//   - empty repo:  configured `path/` has no `.flow.ts` files.
//   - fresh deploy: local `flowlib_flows` has zero rows.
//   - matching:    ≥ 50% of repo flowIds exist in local DB.
//   - foreign:     ≥ 1 file references a flowId already used locally with
//                  a different name (heuristic; surfaces as a confirmation
//                  prompt rather than a hard refuse).
// =============================================================================

import type { PluginDatabaseApi } from '@flowlib/core';
import type { GitProvider } from './git-provider';
import { extractFlowIdFromContent, parseFlowTsContent } from './sync-service';

export type BootstrapScenario =
  | 'empty-repo' // repo has no .flow.ts files; recommend push-all (or no-op)
  | 'fresh-deploy' // local DB empty; recommend hydrate
  | 'reconcile' // both sides have flows; ask user to merge / pick winner
  | 'foreign-repo' // remote IDs collide with local ones — likely wrong repo
  | 'already-bootstrapped'; // instance state row says we've done this

export type BootstrapAction = 'hydrate' | 'merge' | 'push-all' | 'refuse';

export interface BootstrapDetection {
  scenario: BootstrapScenario;
  /** Branch head SHA observed during detection — written into instance
   *  state when an action completes so the reconciler picks up from here. */
  branchSha: string | null;
  /** Number of `.flow.ts` files seen on the configured branch. */
  remoteFlowCount: number;
  /** Number of flow rows in the local DB. */
  localFlowCount: number;
  /** Count of remote flows whose flowId is present locally. */
  matchingIds: number;
  /**
   * Count of remote flows whose flowId is present locally but with a
   * different name — strong signal of a wrong-repo connection.
   */
  conflictingIds: number;
  /** Per-file detail used by the merge UI when scenario === 'reconcile'. */
  files: Array<{
    path: string;
    embeddedFlowId: string | null;
    /** Whether the embedded flowId exists locally. */
    localExists: boolean;
    /** Local flow name when the id matches; null otherwise. */
    localName: string | null;
  }>;
  /** Recommended next action for the UI to highlight. */
  recommendedAction: BootstrapAction;
}

export interface BootstrapResolveResult {
  action: BootstrapAction;
  status: 'success' | 'partial' | 'refused' | 'not-implemented' | 'error';
  /** Number of flows imported (hydrate) or pushed (push-all). */
  flowsAffected?: number;
  /** Per-flow errors for partial paths. */
  errors?: Array<{ path: string; error: string }>;
  /** Final lastInstanceCommitSha after the action — null when no advance. */
  lastInstanceCommitSha?: string | null;
  message?: string;
}

type Logger = {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
};

export interface BootstrapOptions {
  repo: string;
  branch: string;
  /** Path prefix in the repo to scan (defaults match plugin options). */
  path: string;
  provider: GitProvider;
  logger: Logger;
}

export class BootstrapService {
  constructor(private readonly opts: BootstrapOptions) {}

  // ---------------------------------------------------------------------------
  // Detection
  // ---------------------------------------------------------------------------

  /**
   * Inspect the repo + local DB and classify which bootstrap scenario applies.
   *
   * Single round-trip to the provider for the tree listing; per-file content
   * fetches happen only for files whose embedded id we want to verify
   * (capped to keep first-load latency bounded).
   */
  async detect(db: PluginDatabaseApi): Promise<BootstrapDetection> {
    // 1. If we've already bootstrapped this (repo, branch), say so. The
    //    UI uses this to skip the wizard on subsequent loads.
    const stateRows = await db.query<{ last_instance_commit_sha: string | null }>(
      'SELECT last_instance_commit_sha FROM flowlib_vc_instance_state WHERE repo = ? AND branch = ? LIMIT 1',
      [this.opts.repo, this.opts.branch],
    );
    const alreadyBootstrapped =
      stateRows.length > 0 && stateRows[0].last_instance_commit_sha !== null;

    // 2. Branch head — also surfaced so the action handlers can advance
    //    `lastInstanceCommitSha` to the right value when they finish.
    const branchInfo = await this.opts.provider.getBranch(this.opts.repo, this.opts.branch);
    const branchSha = branchInfo?.sha ?? null;

    // 3. List the tree and pull out .flow.ts files.
    const tree = branchSha
      ? await this.opts.provider.listTree(this.opts.repo, branchSha, { path: this.opts.path })
      : [];
    const flowFiles = tree.filter((e) => e.type === 'blob' && e.path.endsWith('.flow.ts'));

    // 4. Local flow count.
    const localCountRows = await db.query<{ c: number }>('SELECT COUNT(*) as c FROM flowlib_flows');
    const localFlowCount = Number(localCountRows[0]?.c ?? 0);

    // Empty repo: regardless of local state, no remote flows means push-all
    // (when local has flows) or already-bootstrapped (when both empty).
    if (flowFiles.length === 0) {
      const scenario: BootstrapScenario =
        alreadyBootstrapped || localFlowCount === 0 ? 'already-bootstrapped' : 'empty-repo';
      return {
        scenario,
        branchSha,
        remoteFlowCount: 0,
        localFlowCount,
        matchingIds: 0,
        conflictingIds: 0,
        files: [],
        recommendedAction: scenario === 'empty-repo' ? 'push-all' : 'refuse',
      };
    }

    if (alreadyBootstrapped) {
      return {
        scenario: 'already-bootstrapped',
        branchSha,
        remoteFlowCount: flowFiles.length,
        localFlowCount,
        matchingIds: 0,
        conflictingIds: 0,
        files: [],
        recommendedAction: 'refuse',
      };
    }

    // 5. Fetch each remote file's embedded flowId. Capped at 100 to keep
    //    bootstrap latency bounded — beyond that, the reconciler picks up
    //    the rest after the chosen action completes.
    const sample = flowFiles.slice(0, 100);
    const fileDetails: BootstrapDetection['files'] = [];
    let matchingIds = 0;
    let conflictingIds = 0;

    for (const entry of sample) {
      const remote = await this.opts.provider.getFileContent(
        this.opts.repo,
        entry.path,
        this.opts.branch,
      );
      const embeddedFlowId = remote ? extractFlowIdFromContent(remote.content) : null;

      let localExists = false;
      let localName: string | null = null;
      if (embeddedFlowId) {
        const localRows = await db.query<{ name: string }>(
          'SELECT name FROM flowlib_flows WHERE id = ? LIMIT 1',
          [embeddedFlowId],
        );
        if (localRows.length > 0) {
          localExists = true;
          localName = localRows[0].name;
          matchingIds++;
          // Conflict heuristic: same id, different name. Pulls the file's
          // own metadata.name out of the parsed content for comparison —
          // the substituted source still carries its name in the JSON
          // footer.
          const parsed = remote ? parseFlowTsContent(remote.content) : null;
          const remoteName = parsed?.metadata?.name;
          if (typeof remoteName === 'string' && remoteName !== '' && remoteName !== localName) {
            conflictingIds++;
          }
        }
      }

      fileDetails.push({
        path: entry.path,
        embeddedFlowId,
        localExists,
        localName,
      });
    }

    // 6. Classify.
    let scenario: BootstrapScenario;
    let recommendedAction: BootstrapAction;
    if (localFlowCount === 0) {
      scenario = 'fresh-deploy';
      recommendedAction = 'hydrate';
    } else if (conflictingIds > 0 && matchingIds < flowFiles.length / 2) {
      // ≥ 1 hard collision AND most ids don't match → likely wrong repo.
      scenario = 'foreign-repo';
      recommendedAction = 'refuse';
    } else if (matchingIds >= flowFiles.length / 2) {
      // Mostly the same flows on both sides — user picks winner per flow.
      scenario = 'reconcile';
      recommendedAction = 'merge';
    } else {
      // Mostly disjoint — still a reconcile, but the merge UI surfaces
      // the local-only and remote-only sets distinctly.
      scenario = 'reconcile';
      recommendedAction = 'merge';
    }

    return {
      scenario,
      branchSha,
      remoteFlowCount: flowFiles.length,
      localFlowCount,
      matchingIds,
      conflictingIds,
      files: fileDetails,
      recommendedAction,
    };
  }

  // ---------------------------------------------------------------------------
  // Resolve actions
  // ---------------------------------------------------------------------------

  /**
   * Hydrate the local DB by importing every `.flow.ts` from the configured
   * branch as a new flow row.
   *
   * Pre-conditions: caller has confirmed the local DB is empty (or willing
   * to skip already-existing flowIds). This routine is permissive — it
   * skips files without an embedded flowId (legacy) and files whose flowId
   * collides with an existing row.
   *
   * Post-conditions: every imported flow has a `flowlib_flows` row, a
   * `flowlib_flow_versions` row (version 1), a `flowlib_vc_sync_config`
   * row pointing at its file path, and `vc_pull_commits` recorded so the
   * next reconciler tick is a no-op for these files.
   */
  async hydrate(
    db: PluginDatabaseApi,
    detection: BootstrapDetection,
    actor: string | null,
  ): Promise<BootstrapResolveResult> {
    if (detection.scenario === 'empty-repo') {
      return {
        action: 'hydrate',
        status: 'refused',
        message: 'Repo is empty; nothing to hydrate. Use push-all instead.',
        flowsAffected: 0,
      };
    }
    if (!detection.branchSha) {
      return {
        action: 'hydrate',
        status: 'error',
        message: 'Branch not found — cannot hydrate.',
        flowsAffected: 0,
      };
    }

    // Walk the full tree (not just the sampled files in detection.files —
    // hydrate may exceed the detection sample cap).
    const tree = await this.opts.provider.listTree(this.opts.repo, detection.branchSha, {
      path: this.opts.path,
    });
    const flowFiles = tree.filter((e) => e.type === 'blob' && e.path.endsWith('.flow.ts'));

    let imported = 0;
    const errors: Array<{ path: string; error: string }> = [];
    const now = new Date().toISOString();

    for (const entry of flowFiles) {
      try {
        const remote = await this.opts.provider.getFileContent(
          this.opts.repo,
          entry.path,
          this.opts.branch,
        );
        if (!remote) {
          errors.push({ path: entry.path, error: 'Remote file vanished mid-hydrate' });
          continue;
        }

        const embeddedFlowId = extractFlowIdFromContent(remote.content);
        if (!embeddedFlowId) {
          errors.push({ path: entry.path, error: 'No embedded flowId in footer' });
          continue;
        }

        // Skip files whose flowId already exists locally — the user
        // should resolve those via the merge action, not silently
        // overwrite. Hydrate is "fresh import only".
        const existing = await db.query<{ id: string }>(
          'SELECT id FROM flowlib_flows WHERE id = ? LIMIT 1',
          [embeddedFlowId],
        );
        if (existing.length > 0) {
          continue;
        }

        const parsed = parseFlowTsContent(remote.content);
        if (!parsed || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
          errors.push({ path: entry.path, error: 'Invalid flow definition' });
          continue;
        }

        const name =
          (typeof parsed.metadata?.name === 'string' && parsed.metadata.name) ||
          this.deriveNameFromPath(entry.path);
        const description =
          typeof parsed.metadata?.description === 'string' ? parsed.metadata.description : null;
        const tags = Array.isArray(parsed.metadata?.tags)
          ? JSON.stringify(parsed.metadata.tags)
          : null;

        // Insert flowlib_flows row. Live version starts at 1 because we
        // insert exactly one version row below.
        await db.execute(
          `INSERT INTO flowlib_flows (id, name, description, tags, is_active, live_version_number, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [embeddedFlowId, name, description, tags, 1, 1, now, now],
        );

        // Insert flowlib_flow_versions v1.
        await db.execute(
          `INSERT INTO flowlib_flow_versions (flow_id, version, flowlib_definition, created_at, created_by)
           VALUES (?, ?, ?, ?, ?)`,
          [
            embeddedFlowId,
            1,
            JSON.stringify({ nodes: parsed.nodes, edges: parsed.edges }),
            now,
            actor,
          ],
        );

        // Insert vc_sync_config so subsequent pushes/pulls work.
        await db.execute(
          `INSERT INTO flowlib_vc_sync_config
           (id, flow_id, provider, repo, branch, file_path, mode, sync_direction, last_synced_at, last_commit_sha, last_synced_version, enabled, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            crypto.randomUUID(),
            embeddedFlowId,
            this.opts.provider.id,
            this.opts.repo,
            this.opts.branch,
            entry.path,
            'direct-commit',
            'pull',
            now,
            entry.sha,
            1,
            1,
            now,
            now,
          ],
        );

        // Record the (flowId, blobSha) pull idempotency token so the
        // reconciler doesn't re-import this file on its next tick.
        await db.execute(
          `INSERT INTO flowlib_vc_pull_commits (flow_id, commit_sha, version_inserted, pulled_at)
           VALUES (?, ?, ?, ?)`,
          [embeddedFlowId, entry.sha, 1, now],
        );

        // History: 'hydrate' isn't in the existing action enum yet; record
        // as 'pull' with a descriptive message until the enum extends.
        await db.execute(
          `INSERT INTO flowlib_vc_sync_history (id, flow_id, action, commit_sha, version, message, created_at, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            crypto.randomUUID(),
            embeddedFlowId,
            'pull',
            entry.sha,
            1,
            'Hydrated from repo on bootstrap',
            now,
            actor,
          ],
        );

        imported++;
      } catch (err) {
        errors.push({ path: entry.path, error: (err as Error).message });
      }
    }

    // Advance instance state. Now that hydrate completed, the reconciler
    // sees `lastInstanceCommitSha === branch head` on its next tick →
    // no-op until a real change lands.
    await this.advanceInstanceState(db, detection.branchSha, now);

    const status = errors.length === 0 ? 'success' : imported > 0 ? 'partial' : 'error';

    this.opts.logger.info('bootstrap: hydrate complete', {
      imported,
      errored: errors.length,
      branchSha: detection.branchSha,
    });

    return {
      action: 'hydrate',
      status,
      flowsAffected: imported,
      errors: errors.length > 0 ? errors : undefined,
      lastInstanceCommitSha: detection.branchSha,
    };
  }

  /**
   * Mark `merge` as not implemented in v1. The endpoint surfaces this
   * status so the frontend (Phase 5 UI) can render an "implementation
   * pending" path while still letting the wizard reach the user.
   */
  notImplementedMerge(): BootstrapResolveResult {
    return {
      action: 'merge',
      status: 'not-implemented',
      message:
        'Merge bootstrap requires the per-flow reconciliation UI (Phase 5 frontend). Use hydrate for fresh deploys or push-all when the repo is empty.',
    };
  }

  /**
   * Mark instance state as bootstrapped without taking any action — the
   * "refuse" path. Used when the operator picks "this is the wrong repo,
   * disconnect" or to clear the wizard from a confused install.
   */
  async refuse(
    db: PluginDatabaseApi,
    detection: BootstrapDetection,
    actor: string | null,
  ): Promise<BootstrapResolveResult> {
    if (detection.branchSha) {
      const now = new Date().toISOString();
      await this.advanceInstanceState(db, detection.branchSha, now);
    }
    this.opts.logger.warn('bootstrap: user refused', {
      scenario: detection.scenario,
      actor,
    });
    return {
      action: 'refuse',
      status: 'refused',
      lastInstanceCommitSha: detection.branchSha,
    };
  }

  /**
   * Used by the endpoint after a successful `push-all` (which delegates
   * to `pushFlowsAtomic`) to bump the instance state pointer to the
   * branch head observed post-push.
   */
  async finalizePushAll(db: PluginDatabaseApi, branchSha: string): Promise<void> {
    const now = new Date().toISOString();
    await this.advanceInstanceState(db, branchSha, now);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private deriveNameFromPath(path: string): string {
    const fileName = path.split('/').pop() ?? path;
    return fileName.replace(/\.flow\.ts$/, '').replace(/[-_]+/g, ' ');
  }

  /** Idempotent advance. Mirrors the reconciler's instance-state writer. */
  private async advanceInstanceState(
    db: PluginDatabaseApi,
    branchSha: string,
    now: string,
  ): Promise<void> {
    const existing = await db.query<{ id: string }>(
      'SELECT id FROM flowlib_vc_instance_state WHERE repo = ? AND branch = ? LIMIT 1',
      [this.opts.repo, this.opts.branch],
    );
    if (existing.length > 0) {
      await db.execute(
        `UPDATE flowlib_vc_instance_state
         SET last_instance_commit_sha = ?, last_reconciler_tick_at = ?, last_reconciler_error = ?, updated_at = ?
         WHERE id = ?`,
        [branchSha, now, null, now, existing[0].id],
      );
    } else {
      await db.execute(
        `INSERT INTO flowlib_vc_instance_state
         (id, repo, branch, last_instance_commit_sha, last_reconciler_tick_at, last_reconciler_error, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [crypto.randomUUID(), this.opts.repo, this.opts.branch, branchSha, now, null, now, now],
      );
    }
  }
}
