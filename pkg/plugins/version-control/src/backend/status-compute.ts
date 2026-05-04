// =============================================================================
// Phase 2 — Status computation + cache materialization
//
// Two halves:
//
// 1. `computeFlowState(input)` — pure function that maps DB-derived facts
//    (config row, latest version, latest sync history, branch comparison)
//    to a `VcSyncState` + chip label + action label. Tested directly with
//    fixture inputs, no DB needed.
//
// 2. `StatusCacheService` — refreshes `flowlib_vc_status_cache` from the
//    facts above. The reconciler calls `refreshAll(db)` at the end of each
//    tick so the dashboard render path is a single SELECT.
//
// Why split: dashboard reads are *constant* (one SELECT per render); state
// recomputation is *amortized* (once per reconciler tick). Decoupling lets
// us add SSE later without churning the chip semantics.
// =============================================================================

import type { PluginDatabaseApi } from '@flowlib/core';
import { sql } from 'kysely';
import type { VcDB } from './db-types';
import type {
  VcStatusDisplay,
  VcStatusCacheEntry,
  VcSyncState,
  VcDirtyFlow,
} from '../shared/types';

/**
 * Inputs to per-flow state computation. Decoupled from DB rows so tests
 * can drive the function with fixtures and the reconciler can pre-batch
 * the joins.
 */
export interface FlowStateInput {
  flowId: string;
  flowName: string;
  /** Whether vc_sync_config exists + enabled for this flow. */
  hasConfig: boolean;
  /** Highest version number on flow_versions for this flow. 0 when no versions. */
  currentVersion: number;
  /** vc_sync_config.lastSyncedVersion. */
  lastSyncedVersion: number | null;
  /** vc_sync_config.lastCommitSha (blob SHA after Phase 0c). */
  lastCommitSha: string | null;
  /** vc_sync_config.activePrNumber. */
  activePrNumber: number | null;
  /** Action of the most recent vc_sync_history row. */
  lastSyncAction: string | null;
  /** Optional error message from the last sync attempt. */
  lastSyncError: string | null;
  /** ISO timestamp of last sync (any action). */
  lastSyncedAt: string | null;
}

/**
 * Map a state to its UI display hints. Centralized so the chip mapping
 * stays consistent across the cache writer, the live `/vc/flows/:id/status`
 * endpoint, and any future CLI output.
 */
const STATE_DISPLAY: Record<VcSyncState, Omit<VcStatusDisplay, 'state'>> = {
  untracked: {
    chipColor: 'grey',
    chipLabel: 'Not tracked',
    actionLabel: 'Track this flow',
    banner: null,
  },
  'never-synced': {
    chipColor: 'yellow',
    chipLabel: 'Never synced',
    actionLabel: 'Push to git',
    banner: 'This flow is tracked but hasn’t been pushed yet.',
  },
  synced: {
    chipColor: 'green',
    chipLabel: '✓ In sync',
    actionLabel: null,
    banner: null,
  },
  dirty: {
    chipColor: 'blue',
    chipLabel: 'Unpushed changes',
    actionLabel: 'Sync changes',
    banner: null,
  },
  behind: {
    chipColor: 'yellow',
    chipLabel: 'Behind remote',
    actionLabel: 'Pull updates',
    banner: 'Someone else pushed updates to this flow.',
  },
  diverged: {
    chipColor: 'red',
    chipLabel: 'Conflicts with remote',
    actionLabel: 'Resolve',
    banner: 'Both this instance and the repo changed. Pick a winner.',
  },
  'conflict-pending': {
    chipColor: 'red',
    chipLabel: 'Conflict',
    actionLabel: 'Force-push / pull',
    banner: 'Last sync attempt was a conflict. Resolution required.',
  },
  'pr-open': {
    chipColor: 'purple',
    chipLabel: 'PR open',
    actionLabel: 'View PR',
    banner: 'Saving will append commits to the open PR.',
  },
  orphaned: {
    chipColor: 'grey',
    chipLabel: 'PR closed',
    actionLabel: 'Re-open PR',
    banner: 'PR was closed without merging.',
  },
  'stale-sha': {
    chipColor: 'yellow',
    chipLabel: 'Out of sync',
    actionLabel: 'Reconcile',
    banner: 'Last sync points at a missing commit. Reconciler will recover.',
  },
  renamed: {
    chipColor: 'blue',
    chipLabel: 'Renamed, not synced',
    actionLabel: 'Sync rename',
    banner: 'File path will change on the next push.',
  },
  deleted: {
    chipColor: 'grey',
    chipLabel: 'Deleted, not synced',
    actionLabel: 'Sync deletion',
    banner: null,
  },
  error: {
    chipColor: 'red',
    chipLabel: 'Sync failed',
    actionLabel: 'Retry',
    banner: null,
  },
};

/** Decorate a state with its UI hints. Pure. */
export function displayFor(state: VcSyncState): VcStatusDisplay {
  const d = STATE_DISPLAY[state];
  return { state, ...d };
}

/**
 * Map per-flow facts to the canonical state. Pure function — no DB, no IO.
 *
 * Decision order matters: a single flow can satisfy multiple predicates
 * (e.g. dirty AND has an open PR), and the order encodes priority. The
 * priority is "what does the user need to do *first*":
 *
 *   1. Untracked      — nothing to do until they opt in.
 *   2. ConflictPending — resolve before any other action makes sense.
 *   3. PrOpen         — saving appends to PR; user should know.
 *   4. NeverSynced    — first push needs explicit consent (Phase 1 §H).
 *   5. Dirty          — local edits since last sync.
 *   6. Error          — last action errored; show before "synced".
 *   7. Synced         — default fallthrough.
 *
 * Behind / Diverged / StaleSha / Renamed / Deleted are NOT computed here:
 * they require remote comparison, which only the reconciler tick performs.
 * Those states are written to the cache directly by the reconciler.
 */
export function computeFlowState(input: FlowStateInput): VcSyncState {
  if (!input.hasConfig) {
    return 'untracked';
  }
  if (input.lastSyncAction === 'conflict') {
    return 'conflict-pending';
  }
  if (input.activePrNumber !== null && input.activePrNumber !== undefined) {
    return 'pr-open';
  }
  if (input.lastCommitSha === null) {
    return 'never-synced';
  }
  if (input.lastSyncedVersion !== null && input.currentVersion > input.lastSyncedVersion) {
    return 'dirty';
  }
  if (input.lastSyncError) {
    return 'error';
  }
  return 'synced';
}

// =============================================================================
// Cache materialization
// =============================================================================

interface FactJoinRow {
  flow_id: string;
  flow_name: string;
  /**
   * Project the raw `enabled` column rather than computing has_config in
   * SQL. SQLite returns 0/1, Postgres returns boolean t/f, MySQL returns
   * 0/1 — comparing against a single literal in a CASE breaks one of them.
   * JS coerces all three uniformly.
   */
  config_enabled: boolean | number | null;
  current_version: number | null;
  last_synced_version: number | null;
  last_commit_sha: string | null;
  active_pr_number: number | null;
  last_sync_action: string | null;
  last_sync_error: string | null;
  last_synced_at: string | null;
}

/**
 * Cross-cutting service that refreshes `flowlib_vc_status_cache` and
 * surfaces dirty-list / chip queries. The reconciler owns the write path
 * (one `refreshAll` per tick); endpoints are read-only consumers.
 */
export class StatusCacheService {
  /**
   * Recompute and persist the chip state for every tracked flow.
   *
   * Does it as N small upserts rather than one bulk INSERT … ON CONFLICT
   * because the abstract plugin schema doesn't expose dialect-specific
   * upsert syntax. N is bounded by tracked flow count (≤1000 for v1
   * scale targets in PLAN.md §U) — well within tick budget.
   */
  async refreshAll(db: PluginDatabaseApi): Promise<{ refreshed: number }> {
    const facts = await this.loadFacts(db);
    let refreshed = 0;
    for (const fact of facts) {
      await this.writeOne(db, this.factToInput(fact));
      refreshed++;
    }
    return { refreshed };
  }

  /** Read the cached entry for a single flow. Null when none has been computed yet. */
  async getCached(db: PluginDatabaseApi, flowId: string): Promise<VcStatusCacheEntry | null> {
    const r = await db
      .kysely<VcDB>()
      .selectFrom('flowlib_vc_status_cache')
      .where('flow_id', '=', flowId)
      .selectAll()
      .limit(1)
      .executeTakeFirst();
    if (!r) {
      return null;
    }
    return {
      flowId: r.flow_id,
      state: r.state as VcSyncState,
      chipLabel: r.chip_label,
      actionLabel: r.action_label,
      lastError: r.last_error,
      updatedAt: String(r.updated_at),
    };
  }

  /** All cached entries — used by the dashboard to render chips. */
  async listCached(db: PluginDatabaseApi): Promise<VcStatusCacheEntry[]> {
    const rows = await db
      .kysely<VcDB>()
      .selectFrom('flowlib_vc_status_cache')
      .selectAll()
      .execute();
    return rows.map((r) => ({
      flowId: r.flow_id,
      state: r.state as VcSyncState,
      chipLabel: r.chip_label,
      actionLabel: r.action_label,
      lastError: r.last_error,
      updatedAt: String(r.updated_at),
    }));
  }

  /**
   * Flows in a state where the user can / should push: `dirty`, `never-synced`,
   * `renamed`, `deleted`. The dirty-list modal consumes this directly.
   */
  async listDirty(db: PluginDatabaseApi): Promise<VcDirtyFlow[]> {
    const facts = await this.loadFacts(db);
    const out: VcDirtyFlow[] = [];
    for (const fact of facts) {
      const input = this.factToInput(fact);
      const state = computeFlowState(input);
      if (state !== 'dirty' && state !== 'never-synced') {
        continue;
      }
      const ahead = input.currentVersion - (input.lastSyncedVersion ?? 0);
      out.push({
        flowId: input.flowId,
        flowName: input.flowName,
        state,
        filePath: '', // populated below
        currentVersion: input.currentVersion,
        lastSyncedVersion: input.lastSyncedVersion,
        ahead: ahead < 0 ? 0 : ahead,
        lastSyncedAt: input.lastSyncedAt,
      });
    }
    // Tack on file paths from vc_sync_config so the modal can show them
    // without an extra round-trip per row.
    if (out.length === 0) {
      return out;
    }
    const ids = out.map((f) => f.flowId);
    const paths = await db
      .kysely<VcDB>()
      .selectFrom('flowlib_vc_sync_config')
      .where('flow_id', 'in', ids)
      .select(['flow_id', 'file_path'])
      .execute();
    const pathByFlow = new Map(paths.map((p) => [p.flow_id, p.file_path]));
    for (const f of out) {
      f.filePath = pathByFlow.get(f.flowId) ?? '';
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Pull all the facts we need to compute every flow's state in one query.
   * The CASE/COALESCE trick keeps it portable across SQLite + Postgres +
   * MySQL — no dialect-specific window functions or LATERAL joins.
   */
  private async loadFacts(db: PluginDatabaseApi): Promise<FactJoinRow[]> {
    // The phase-1 conversion left this as a `sql\`\`` template because
    // Drizzle's builder couldn't express correlated subqueries-as-columns.
    // Kysely can — the two `eb.selectFrom(...).whereRef(...).as(alias)`
    // expressions below produce per-row aggregates against `f.id` without
    // dropping out of the typed builder.
    const rows = await db
      .kysely<VcDB>()
      .selectFrom('flowlib_flows as f')
      .leftJoin('flowlib_vc_sync_config as c', 'c.flow_id', 'f.id')
      .select((eb) => [
        'f.id as flow_id',
        'f.name as flow_name',
        'c.enabled as config_enabled',
        eb
          .selectFrom('flowlib_flow_versions')
          .whereRef('flow_id', '=', 'f.id')
          .select((eb2) => eb2.fn.max<number>('version').as('v'))
          .as('current_version'),
        'c.last_synced_version',
        'c.last_commit_sha',
        'c.active_pr_number',
        eb
          .selectFrom('flowlib_vc_sync_history as h')
          .whereRef('h.flow_id', '=', 'f.id')
          .orderBy('h.created_at', 'desc')
          .limit(1)
          .select('action')
          .as('last_sync_action'),
        sql<null>`NULL`.as('last_sync_error'),
        'c.last_synced_at',
      ])
      .execute();
    return rows as unknown as FactJoinRow[];
  }

  private factToInput(fact: FactJoinRow): FlowStateInput {
    // `config_enabled` arrives as boolean (PG), 0/1 (SQLite/MySQL), or null
    // (no row from the LEFT JOIN). Treat anything truthy as configured-and-enabled.
    const hasConfig = fact.config_enabled === true || fact.config_enabled === 1;
    return {
      flowId: fact.flow_id,
      flowName: fact.flow_name,
      hasConfig,
      currentVersion: fact.current_version ?? 0,
      lastSyncedVersion: fact.last_synced_version,
      lastCommitSha: fact.last_commit_sha,
      activePrNumber: fact.active_pr_number,
      lastSyncAction: fact.last_sync_action,
      lastSyncError: fact.last_sync_error,
      lastSyncedAt: fact.last_synced_at,
    };
  }

  private async writeOne(db: PluginDatabaseApi, input: FlowStateInput): Promise<void> {
    const state = computeFlowState(input);
    const display = displayFor(state);
    const now = new Date().toISOString();
    // Upsert via probe-then-write: portable across the three dialects
    // without dialect-specific syntax. flowId is the PK so there's no race
    // beyond the cache itself, which only the reconciler writes to.
    const existing = await db
      .kysely<VcDB>()
      .selectFrom('flowlib_vc_status_cache')
      .where('flow_id', '=', input.flowId)
      .select('flow_id')
      .limit(1)
      .execute();
    if (existing.length > 0) {
      await db.execute(
        `UPDATE flowlib_vc_status_cache
         SET state = ?, chip_label = ?, action_label = ?, last_error = ?, updated_at = ?
         WHERE flow_id = ?`,
        [state, display.chipLabel, display.actionLabel, input.lastSyncError, now, input.flowId],
      );
    } else {
      await db.execute(
        `INSERT INTO flowlib_vc_status_cache
         (flow_id, state, chip_label, action_label, last_error, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [input.flowId, state, display.chipLabel, display.actionLabel, input.lastSyncError, now],
      );
    }
  }

  /** Internal helper for tests + the reconciler's "remote-derived" overrides
   * (Behind / Diverged / StaleSha / Renamed). Bypasses computeFlowState
   * because those states are observed during the tick, not derivable from
   * local facts alone.
   */
  async overrideState(
    db: PluginDatabaseApi,
    flowId: string,
    state: VcSyncState,
    error?: string | null,
  ): Promise<void> {
    const display = displayFor(state);
    const now = new Date().toISOString();
    const existing = await db
      .kysely<VcDB>()
      .selectFrom('flowlib_vc_status_cache')
      .where('flow_id', '=', flowId)
      .select('flow_id')
      .limit(1)
      .execute();
    if (existing.length > 0) {
      await db.execute(
        `UPDATE flowlib_vc_status_cache
         SET state = ?, chip_label = ?, action_label = ?, last_error = ?, updated_at = ?
         WHERE flow_id = ?`,
        [state, display.chipLabel, display.actionLabel, error ?? null, now, flowId],
      );
    } else {
      await db.execute(
        `INSERT INTO flowlib_vc_status_cache
         (flow_id, state, chip_label, action_label, last_error, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [flowId, state, display.chipLabel, display.actionLabel, error ?? null, now],
      );
    }
  }
}
