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

import type { TimestampColumn } from '@flowlib/db/kysely';

// Inline rather than imported from `@flowlib/rbac` to avoid creating a
// type-level cycle (rbac → auth via peerDep, the reverse would be circular).
// Kept in lockstep with the canonical declaration in `@flowlib/rbac/types`.
type FlowAccessPermission = 'owner' | 'editor' | 'operator' | 'viewer';

/**
 * Reuse the shared Kysely timestamp alias from `@flowlib/db/kysely` so
 * plugin-owned tables stay aligned with the core DB surface.
 */

export interface FlowAccessTable {
  id: string;
  flow_id: string;
  user_id: string | null;
  team_id: string | null;
  permission: FlowAccessPermission;
  granted_by: string | null;
  granted_at: TimestampColumn;
  expires_at: TimestampColumn | null;
}

export interface AuthDB {
  flowlib_flow_access: FlowAccessTable;
}
