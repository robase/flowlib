// =============================================================================
// Phase 1 — Instance state read/write helpers
//
// `flowlib_vc_instance_state` is a single row per (repo, branch) holding:
//   - The reconciler's last position on the branch (Phase 0b).
//   - The break-glass override window for prod read-only mode (Phase 1).
//
// These helpers keep the SQL in one place so the reconciler, the read-only
// hook, and the break-glass endpoints all see consistent state. The `Service`
// suffix is intentional — Phase 5 will extend this with environment-derived
// fields and operator-facing health metrics.
// =============================================================================

import type { PluginDatabaseApi } from '@flowlib/core';
import type { VcDB } from './db-types';

export interface InstanceStateRow {
  id: string;
  repo: string;
  branch: string;
  last_instance_commit_sha: string | null;
  last_reconciler_tick_at: string | null;
  last_reconciler_error: string | null;
  break_glass_until: string | null;
  break_glass_actor: string | null;
  break_glass_reason: string | null;
}

export interface BreakGlassWindow {
  until: string;
  actor: string | null;
  reason: string | null;
}

/**
 * Service for reading and mutating the singleton instance state row.
 *
 * Stateless — just SQL. Caller passes the DB connection per call so it
 * composes with the reconciler's `getDb` deferral and the per-request
 * `ctx.database` used by endpoints.
 */
export class InstanceStateService {
  constructor(
    private readonly repo: string,
    private readonly branch: string,
  ) {}

  async read(db: PluginDatabaseApi): Promise<InstanceStateRow | null> {
    const row = await db
      .kysely<VcDB>()
      .selectFrom('flowlib_vc_instance_state')
      .where('repo', '=', this.repo)
      .where('branch', '=', this.branch)
      .selectAll()
      .limit(1)
      .executeTakeFirst();
    return (row as InstanceStateRow | undefined) ?? null;
  }

  /**
   * Ensure a singleton row exists for (repo, branch). Idempotent — used at
   * plugin init so subsequent reads don't need to handle the "no row yet"
   * case for non-reconciler fields.
   */
  async ensureRow(db: PluginDatabaseApi): Promise<void> {
    const existing = await this.read(db);
    if (existing) {
      return;
    }
    const now = new Date().toISOString();
    await db.execute(
      `INSERT INTO flowlib_vc_instance_state
       (id, repo, branch, last_instance_commit_sha, last_reconciler_tick_at, last_reconciler_error,
        break_glass_until, break_glass_actor, break_glass_reason, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [crypto.randomUUID(), this.repo, this.branch, null, null, null, null, null, null, now, now],
    );
  }

  /**
   * Open a break-glass window. Idempotent: opening when one is already
   * active replaces it with the new window (operator may extend / change
   * reason mid-incident). Audit history is NOT written here — callers
   * record `override-write` events on each subsequent mutation, and the
   * window open/close itself is logged separately by the endpoint handler.
   */
  async openBreakGlass(
    db: PluginDatabaseApi,
    window: { until: string; actor: string | null; reason: string | null },
  ): Promise<void> {
    await this.ensureRow(db);
    const now = new Date().toISOString();
    await db.execute(
      `UPDATE flowlib_vc_instance_state
       SET break_glass_until = ?, break_glass_actor = ?, break_glass_reason = ?, updated_at = ?
       WHERE repo = ? AND branch = ?`,
      [window.until, window.actor, window.reason, now, this.repo, this.branch],
    );
  }

  /** Close the active window early. No-op if none is open. */
  async closeBreakGlass(db: PluginDatabaseApi): Promise<void> {
    const now = new Date().toISOString();
    await db.execute(
      `UPDATE flowlib_vc_instance_state
       SET break_glass_until = NULL, break_glass_actor = NULL, break_glass_reason = NULL, updated_at = ?
       WHERE repo = ? AND branch = ?`,
      [now, this.repo, this.branch],
    );
  }

  /**
   * Active break-glass window if any. Returns null when no window is open
   * OR the window has expired (caller treats both as "read-only enforced").
   */
  async getActiveBreakGlass(db: PluginDatabaseApi): Promise<BreakGlassWindow | null> {
    const row = await this.read(db);
    if (!row || !row.break_glass_until) {
      return null;
    }
    if (new Date(row.break_glass_until).getTime() <= Date.now()) {
      return null;
    }
    return {
      until: row.break_glass_until,
      actor: row.break_glass_actor,
      reason: row.break_glass_reason,
    };
  }
}
