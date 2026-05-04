/**
 * Kysely DB shape for the RBAC plugin's queries.
 *
 * Composes:
 *   - `CoreDB` from `@flowlib/db/kysely` — flows / flow_versions / etc.
 *   - `AuthDB` from `@flowlib/user-auth/kysely` — flow_access (auth-owned)
 *   - `RbacOwnedDB` (declared here) — rbac_teams / rbac_team_members /
 *     rbac_scope_access
 *   - The `flowlib_user` and `flowlib_rbac_teams` joins for name lookups.
 *     The `flowlib_user` table is better-auth-managed so its full shape isn't
 *     mirrored — RBAC reads `id`, `name`, `email`. Declared narrow on purpose.
 *
 * See [pkg/db/src/kysely-types.ts] for the type-convention notes
 * (date columns, booleans, JSON encoding) that apply here too.
 */

import type { CoreDB, CoreFlowsTable, TimestampColumn } from '@flowlib/db/kysely';
import type { AuthDB } from '@flowlib/user-auth/kysely';
import type { FlowAccessPermission } from '../shared/types';

// See `@flowlib/user-auth/kysely` for timestamp rationale.

export interface RbacTeamsTable {
  id: string;
  name: string;
  description: string | null;
  parent_id: string | null;
  created_by: string | null;
  created_at: TimestampColumn;
  updated_at: TimestampColumn | null;
}

export interface RbacTeamMembersTable {
  id: string;
  team_id: string;
  user_id: string;
  created_at: TimestampColumn;
}

export interface RbacScopeAccessTable {
  id: string;
  scope_id: string;
  user_id: string | null;
  team_id: string | null;
  permission: FlowAccessPermission;
  granted_by: string | null;
  granted_at: TimestampColumn;
}

/**
 * Better-auth's `flowlib_user` table — narrow type covering only what RBAC reads.
 */
export interface AuthUserTable {
  id: string;
  name: string | null;
  email: string | null;
}

/**
 * RBAC extends `flowlib_flows` with a `scope_id` column at the abstract
 * schema level (see `_rbacBackendPlugin`'s `teamsSchema`). Override that
 * column on the core flows shape so Kysely sees it.
 */
type FlowsWithScope = CoreFlowsTable & { scope_id: string | null };

interface RbacOwnedDB {
  flowlib_rbac_teams: RbacTeamsTable;
  flowlib_rbac_team_members: RbacTeamMembersTable;
  flowlib_rbac_scope_access: RbacScopeAccessTable;
  flowlib_user: AuthUserTable;
}

/**
 * Composite DB shape used by every RBAC query. Plugins call
 * `db.kysely<RbacDB>()` to get a typed instance.
 */
export type RbacDB = Omit<CoreDB, 'flowlib_flows'> & {
  flowlib_flows: FlowsWithScope;
} & AuthDB &
  RbacOwnedDB;
