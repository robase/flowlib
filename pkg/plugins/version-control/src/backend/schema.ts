// =============================================================================
// Version Control Plugin — Database Schema (abstract, dialect-agnostic)
// =============================================================================

import type { FlowlibPluginSchema } from '@flowlib/db';

const SYNC_MODES = ['direct-commit', 'pr-per-save', 'pr-per-publish'] as const;
const SYNC_DIRECTIONS = ['read', 'write', 'read-write'] as const;
const SYNC_ACTIONS = ['push', 'pull', 'pr-created', 'pr-merged', 'conflict'] as const;
// Phase 2 — chip states. Mirrors `VcSyncState` in shared/types.ts.
const SYNC_STATES = [
  'untracked',
  'never-synced',
  'synced',
  'dirty',
  'behind',
  'diverged',
  'conflict-pending',
  'pr-open',
  'orphaned',
  'stale-sha',
  'renamed',
  'deleted',
  'error',
] as const;

export const VC_SCHEMA: FlowlibPluginSchema = {
  vc_sync_config: {
    tableName: 'flowlib_vc_sync_config',
    order: 10,
    fields: {
      id: { type: 'string', primaryKey: true },
      flowId: {
        type: 'string',
        required: true,
        unique: true,
        references: { table: 'flowlib_flows', field: 'id', onDelete: 'cascade' },
        index: true,
      },
      provider: { type: 'string', required: true },
      repo: { type: 'string', required: true },
      branch: { type: 'string', required: true },
      filePath: { type: 'string', required: true },
      mode: { type: [...SYNC_MODES], required: true },
      syncDirection: { type: [...SYNC_DIRECTIONS], required: true, defaultValue: 'write' },
      lastSyncedAt: { type: 'date', required: false },
      lastCommitSha: { type: 'string', required: false },
      lastSyncedVersion: { type: 'number', required: false },
      draftBranch: { type: 'string', required: false },
      activePrNumber: { type: 'number', required: false },
      activePrUrl: { type: 'string', required: false },
      enabled: { type: 'boolean', required: true, defaultValue: true },
      createdAt: { type: 'date', required: true, defaultValue: 'now()' },
      updatedAt: { type: 'date', required: true, defaultValue: 'now()' },
    },
  },

  vc_sync_history: {
    tableName: 'flowlib_vc_sync_history',
    order: 20,
    fields: {
      id: { type: 'uuid', primaryKey: true, defaultValue: 'uuid()' },
      flowId: {
        type: 'string',
        required: true,
        references: { table: 'flowlib_flows', field: 'id', onDelete: 'cascade' },
        index: true,
      },
      action: { type: [...SYNC_ACTIONS], required: true },
      commitSha: { type: 'string', required: false },
      prNumber: { type: 'number', required: false },
      version: { type: 'number', required: false },
      message: { type: 'string', required: false },
      createdAt: { type: 'date', required: true, defaultValue: 'now()' },
      createdBy: { type: 'string', required: false },
    },
  },

  // ===========================================================================
  // Phase 0b — Reconciler instance state.
  //
  // Tracks the polling reconciler's position on the configured branch so a
  // missed webhook can't leave the instance silently behind: each tick fetches
  // the branch head and compares against `lastInstanceCommitSha`. Equal means
  // no-op; different drives a tree-walk + per-flow pull.
  //
  // Keyed on (repo, branch) — one row per (repo, branch) the instance tracks.
  // Phase 1 extends this with `environment`, `breakGlassUntil`, etc.
  // ===========================================================================
  vc_instance_state: {
    tableName: 'flowlib_vc_instance_state',
    order: 30,
    fields: {
      id: { type: 'uuid', primaryKey: true, defaultValue: 'uuid()' },
      repo: { type: 'string', required: true, index: true },
      branch: { type: 'string', required: true },
      lastInstanceCommitSha: { type: 'string', required: false },
      lastReconcilerTickAt: { type: 'date', required: false },
      lastReconcilerError: { type: 'string', required: false },
      // Phase 1 — break-glass override. When set and in the future, the
      // read-only gate on prod is temporarily disabled so ops can hotfix.
      // Cleared automatically once the timestamp passes.
      breakGlassUntil: { type: 'date', required: false },
      breakGlassActor: { type: 'string', required: false },
      breakGlassReason: { type: 'string', required: false },
      createdAt: { type: 'date', required: true, defaultValue: 'now()' },
      updatedAt: { type: 'date', required: true, defaultValue: 'now()' },
    },
  },

  // ===========================================================================
  // Phase 0c — Pull idempotency.
  //
  // Records every (flowId, commitSha) pair that has already been pulled.
  // The pull path inserts here BEFORE writing a flow_versions row, using the
  // composite primary key as the idempotency token: a duplicate insert means
  // this commit was already pulled by another replica, so we skip the
  // version-row write entirely.
  //
  // Why a separate table instead of a unique index on flow_versions:
  //   - flow_versions is a core table; partial-unique-with-WHERE is awkward
  //     to express through the abstract plugin schema.
  //   - This table is plugin-owned, plugin-cleanup'd via FK cascade.
  //   - The `versionInserted` column lets the audit trail point at the
  //     specific version row that came from a given commit.
  //
  // FK cascade on flowId means rows clean up when a flow is deleted.
  // ===========================================================================
  vc_pull_commits: {
    tableName: 'flowlib_vc_pull_commits',
    order: 40,
    compositePrimaryKey: ['flowId', 'commitSha'],
    fields: {
      flowId: {
        type: 'string',
        required: true,
        references: { table: 'flowlib_flows', field: 'id', onDelete: 'cascade' },
      },
      commitSha: { type: 'string', required: true },
      versionInserted: { type: 'number', required: false },
      pulledAt: { type: 'date', required: true, defaultValue: 'now()' },
    },
  },

  // ===========================================================================
  // Phase 2 — Materialized status cache for chip rendering.
  //
  // The reconciler refreshes this on every tick so the dashboard render path
  // is a single SELECT regardless of flow count. Without this, computing
  // 100 chips would N+1-query (vc_sync_config × flow_versions × history)
  // — fine for 10 flows, breaks at 1000.
  //
  // Single row per flowId. The reconciler tick is the only writer; readers
  // (the /vc/flows-status endpoint, future SSE stream) only read.
  // ===========================================================================
  vc_status_cache: {
    tableName: 'flowlib_vc_status_cache',
    order: 50,
    fields: {
      flowId: {
        type: 'string',
        primaryKey: true,
        references: { table: 'flowlib_flows', field: 'id', onDelete: 'cascade' },
      },
      state: { type: [...SYNC_STATES], required: true },
      chipLabel: { type: 'string', required: true },
      actionLabel: { type: 'string', required: false },
      lastError: { type: 'string', required: false },
      updatedAt: { type: 'date', required: true, defaultValue: 'now()' },
    },
  },
};
