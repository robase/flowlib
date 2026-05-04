/**
 * Kysely-side type contract for `flowlib_flow_access`.
 *
 * Owned by the auth plugin (per its abstract `AUTH_SCHEMA`) but read and
 * written almost exclusively by RBAC. Plugins import this and intersect
 * with their own DB shape.
 *
 * The better-auth-managed tables (`flowlib_user`, `flowlib_session`,
 * `flowlib_account`, `flowlib_verification`, `flowlib_two_factor`,
 * `flowlib_apikey`) are intentionally NOT mirrored here — their column
 * shapes are owned by better-auth and shift across major versions, so
 * pinning a typed mirror would create a maintenance burden disproportionate
 * to the win. Plugins that need user/session lookups should route through
 * the auth plugin's API surface, or fall back to `executeRows(sql\`\`)` for
 * one-off reads.
 *
 * See [pkg/db/src/kysely-types.ts] for type-convention notes
 * (date columns, booleans, JSON encoding).
 */

import type { ColumnType } from 'kysely';

// Inline rather than imported from `@flowlib/rbac` to avoid creating a
// type-level cycle (rbac → auth via peerDep, the reverse would be circular).
// Kept in lockstep with the canonical declaration in `@flowlib/rbac/types`.
type FlowAccessPermission = 'owner' | 'editor' | 'operator' | 'viewer';

/**
 * ISO-string timestamp. The `Selectable` shape is `string` because every
 * existing plugin treats these values as ISO strings — SQLite stores text
 * directly; PG/MySQL drivers return `Date` objects which the bridge layer
 * is responsible for coercing (or callers do `new Date(v).toISOString()`
 * defensively at comparison points). Insertable/Updateable accept both
 * `string` and `Date` so plugins can pass either format on write.
 */
type Timestamp = ColumnType<string, string | Date | undefined, string | Date>;

export interface FlowAccessTable {
  id: string;
  flow_id: string;
  user_id: string | null;
  team_id: string | null;
  permission: FlowAccessPermission;
  granted_by: string | null;
  granted_at: Timestamp;
  expires_at: Timestamp | null;
}

export interface AuthDB {
  flowlib_flow_access: FlowAccessTable;
}
