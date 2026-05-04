/**
 * Kysely DB shape for the version-control plugin's queries.
 *
 * Composes:
 *   - `CoreDB` from `@flowlib/db/kysely` — flows / flow_versions / credentials
 *   - `VcOwnedDB` (declared here) — vc_sync_config / vc_sync_history /
 *     vc_instance_state / vc_pull_commits / vc_status_cache
 *
 * See [pkg/db/src/kysely-types.ts] for type-convention notes (date columns,
 * booleans, JSON encoding) that apply here too.
 */

import type { CoreDB, DialectBoolean, TimestampColumn } from '@flowlib/db/kysely';

export interface VcSyncConfigTable {
  id: string;
  flow_id: string;
  provider: string;
  repo: string;
  branch: string;
  file_path: string;
  mode: string;
  sync_direction: string;
  last_synced_at: TimestampColumn | null;
  last_commit_sha: string | null;
  last_synced_version: number | null;
  draft_branch: string | null;
  active_pr_number: number | null;
  active_pr_url: string | null;
  // SQLite stores 0/1 in INTEGER; Drizzle's mode:'boolean' isn't applied
  // through the Kysely path, so accept either form on read.
  enabled: DialectBoolean;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

export interface VcSyncHistoryTable {
  id: string;
  flow_id: string;
  action: string;
  commit_sha: string | null;
  pr_number: number | null;
  version: number | null;
  message: string | null;
  created_at: TimestampColumn;
  created_by: string | null;
}

export interface VcInstanceStateTable {
  id: string;
  repo: string;
  branch: string;
  last_instance_commit_sha: string | null;
  last_reconciler_tick_at: TimestampColumn | null;
  last_reconciler_error: string | null;
  break_glass_until: TimestampColumn | null;
  break_glass_actor: string | null;
  break_glass_reason: string | null;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

export interface VcPullCommitsTable {
  flow_id: string;
  commit_sha: string;
  version_inserted: number | null;
  pulled_at: TimestampColumn;
}

export interface VcStatusCacheTable {
  flow_id: string;
  state: string;
  chip_label: string;
  action_label: string | null;
  last_error: string | null;
  updated_at: TimestampColumn;
}

interface VcOwnedDB {
  flowlib_vc_sync_config: VcSyncConfigTable;
  flowlib_vc_sync_history: VcSyncHistoryTable;
  flowlib_vc_instance_state: VcInstanceStateTable;
  flowlib_vc_pull_commits: VcPullCommitsTable;
  flowlib_vc_status_cache: VcStatusCacheTable;
}

export type VcDB = CoreDB & VcOwnedDB;
