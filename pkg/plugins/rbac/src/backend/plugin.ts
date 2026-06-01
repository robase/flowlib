/**
 * @flowlib/rbac — Backend Plugin
 *
 * RBAC plugin that provides:
 * - Flow access management endpoints (grant/revoke/list)
 * - Auth info endpoints (/auth/me, /auth/roles)
 * - Authorization hooks (enforces flow-level ACLs)
 * - UI manifest for the frontend plugin to render
 *
 * Requires the @flowlib/user-auth plugin to be loaded first
 * for session resolution. This plugin handles the *authorization* layer
 * on top of that authentication.
 */

import type {
  FlowlibPlugin,
  FlowlibPluginDefinition,
  FlowlibPluginContext,
  FlowlibPermission,
  FlowlibIdentity,
  PluginDatabaseApi,
  PluginEndpointContext,
} from '@flowlib/core';
import type { FlowlibPluginSchema } from '@flowlib/db';
import { sql } from 'kysely';
import type { RbacDB } from './db-types';
import type {
  EffectiveAccessRecord,
  FlowAccessPermission,
  FlowAccessRecord,
  MovePreviewAccessChange,
  PluginUIManifest,
  ScopeAccessRecord,
  ScopeTreeNode,
  Team,
} from '../shared/types';

// ─────────────────────────────────────────────────────────────
// Team ID Resolution Helper
// ─────────────────────────────────────────────────────────────

/**
 * Resolve team IDs for a user from the rbac_team_members table.
 * Use this in a custom `mapUser` for the auth plugin to populate
 * `identity.teamIds` automatically.
 *
 * @example
 * ```ts
 * import { resolveTeamIds } from '@flowlib/rbac/backend';
 *
 * auth({
 *   auth: betterAuthInstance,
 *   mapUser: async (user, session) => ({
 *     id: user.id,
 *     name: user.name ?? undefined,
 *     role: user.role === 'admin' ? 'admin' : 'user',
 *     teamIds: await resolveTeamIds(db, user.id),
 *   }),
 * });
 * ```
 */
export async function resolveTeamIds(db: PluginDatabaseApi, userId: string): Promise<string[]> {
  const rows = await db
    .kysely<RbacDB>()
    .selectFrom('flowlib_rbac_team_members')
    .where('user_id', '=', userId)
    .select('team_id')
    .execute();
  return rows.map((r) => r.team_id);
}

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface RbacPluginOptions {
  /**
   * Permission required to access the RBAC flows page.
   *
   * @default 'flow:read'
   */
  adminPermission?: FlowlibPermission;

  /**
   * Enable teams feature for grouping users.
   *
   * @default true
   */
  enableTeams?: boolean;

  /**
   * Frontend plugin (sidebar, routes, providers) for the RBAC UI.
   *
   * Import from `@flowlib/rbac/ui` and pass here.
   * Omit for backend-only setups.
   */
  frontend?: unknown;
}

const FLOW_RESOURCE_TYPES = new Set(['flow', 'flow-version', 'flow-run', 'node-execution']);

const FLOW_PERMISSION_LEVELS: Record<FlowAccessPermission, number> = {
  viewer: 1,
  operator: 2,
  editor: 3,
  owner: 4,
};

function isFlowAccessPermission(value: unknown): value is FlowAccessPermission {
  return value === 'viewer' || value === 'operator' || value === 'editor' || value === 'owner';
}

function toFlowAccessPermission(value: unknown): FlowAccessPermission | null {
  return isFlowAccessPermission(value) ? value : null;
}

function getHigherPermission(
  left: FlowAccessPermission | null,
  right: FlowAccessPermission | null,
): FlowAccessPermission | null {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  return FLOW_PERMISSION_LEVELS[right] > FLOW_PERMISSION_LEVELS[left] ? right : left;
}

function mapActionToRequiredPermission(action: string): FlowAccessPermission {
  if (action.includes('delete') || action.includes('share') || action.includes('admin')) {
    return 'owner';
  }
  if (action.includes('update') || action.includes('write') || action.includes('create')) {
    return 'editor';
  }
  if (action.includes('run') || action.includes('execute')) {
    return 'operator';
  }
  return 'viewer';
}

function normalizeFlowAccessRecord(row: Record<string, unknown>): FlowAccessRecord {
  return {
    id: String(row.id),
    flowId: String(row.flowId ?? row.flow_id),
    userId: (row.userId ?? row.user_id) ? String(row.userId ?? row.user_id) : null,
    teamId: (row.teamId ?? row.team_id) ? String(row.teamId ?? row.team_id) : null,
    permission: String(row.permission) as FlowAccessPermission,
    grantedBy: (row.grantedBy ?? row.granted_by) ? String(row.grantedBy ?? row.granted_by) : null,
    grantedAt: String(row.grantedAt ?? row.granted_at),
    expiresAt: (row.expiresAt ?? row.expires_at) ? String(row.expiresAt ?? row.expires_at) : null,
  };
}

function normalizeScopeAccessRecord(row: Record<string, unknown>): ScopeAccessRecord {
  return {
    id: String(row.id),
    scopeId: String(row.scopeId ?? row.scope_id),
    userId: (row.userId ?? row.user_id) ? String(row.userId ?? row.user_id) : null,
    teamId: (row.teamId ?? row.team_id) ? String(row.teamId ?? row.team_id) : null,
    permission: String(row.permission) as FlowAccessPermission,
    grantedBy: (row.grantedBy ?? row.granted_by) ? String(row.grantedBy ?? row.granted_by) : null,
    grantedAt: String(row.grantedAt ?? row.granted_at),
  };
}

function normalizeTeamRow(row: {
  id: string;
  name: string;
  description: string | null;
  parent_id?: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string | null;
}): Team {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    parentId: row.parent_id ?? null,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getFlowScopeId(db: PluginDatabaseApi, flowId: string): Promise<string | null> {
  const row = await db
    .kysely<RbacDB>()
    .selectFrom('flowlib_flows')
    .where('id', '=', flowId)
    .select('scope_id')
    .executeTakeFirst();
  return row?.scope_id ?? null;
}

// Depth cap on recursive scope traversals — protects every authorization
// path against a pathological tree (very deep, or a cycle introduced via
// direct DB write that bypassed the move-time descendant check).
const MAX_SCOPE_DEPTH = 100;

async function getAncestorScopeIds(db: PluginDatabaseApi, scopeId: string): Promise<string[]> {
  // Recursive CTE walks `parent_id` upward. Kysely's typed `withRecursive`
  // builder requires `as never` casts on the recursive self-reference and
  // breaks the chain — kept as a typed `sql<T>\`\`` template instead. The
  // outer table reference (`flowlib_rbac_teams`) is a plain identifier; the
  // result row type is checked via the `sql<{ id }>` annotation. Aliases
  // renamed `current` → `c`, `parent` → `p`: `current` is reserved in PG.
  const result = await sql<{ id: string }>`
    WITH RECURSIVE ancestors AS (
      SELECT id, parent_id, 1 AS depth FROM flowlib_rbac_teams WHERE id = ${scopeId}
      UNION ALL
      SELECT p.id, p.parent_id, c.depth + 1
      FROM flowlib_rbac_teams p
      INNER JOIN ancestors c ON p.id = c.parent_id
      WHERE c.depth < ${MAX_SCOPE_DEPTH}
    )
    SELECT id FROM ancestors
  `.execute(db.kysely<RbacDB>());
  return result.rows.map((row) => row.id);
}

async function getDescendantScopeIds(db: PluginDatabaseApi, scopeId: string): Promise<string[]> {
  const result = await sql<{ id: string }>`
    WITH RECURSIVE descendants AS (
      SELECT id, 1 AS depth FROM flowlib_rbac_teams WHERE id = ${scopeId}
      UNION ALL
      SELECT child.id, c.depth + 1
      FROM flowlib_rbac_teams child
      INNER JOIN descendants c ON child.parent_id = c.id
      WHERE c.depth < ${MAX_SCOPE_DEPTH}
    )
    SELECT id FROM descendants
  `.execute(db.kysely<RbacDB>());
  return result.rows.map((row) => row.id);
}

async function listScopeAccessForScopeIds(
  db: PluginDatabaseApi,
  scopeIds: string[],
  userId: string,
  teamIds: string[],
): Promise<ScopeAccessRecord[]> {
  if (scopeIds.length === 0) {
    return [];
  }

  const rows = await db
    .kysely<RbacDB>()
    .selectFrom('flowlib_rbac_scope_access')
    .where((eb) =>
      eb.or([
        eb.and([eb('scope_id', 'in', scopeIds), eb('user_id', '=', userId)]),
        ...(teamIds.length > 0
          ? [eb.and([eb('scope_id', 'in', scopeIds), eb('team_id', 'in', teamIds)])]
          : []),
      ]),
    )
    .select(['id', 'scope_id', 'user_id', 'team_id', 'permission', 'granted_by', 'granted_at'])
    .execute();
  return rows.map((row) => normalizeScopeAccessRecord(row as Record<string, unknown>));
}

async function listDirectFlowAccessForIdentity(
  db: PluginDatabaseApi,
  flowId: string,
  userId: string,
  teamIds: string[],
): Promise<FlowAccessRecord[]> {
  const rows = await db
    .kysely<RbacDB>()
    .selectFrom('flowlib_flow_access')
    .where((eb) =>
      eb.or([
        eb.and([eb('flow_id', '=', flowId), eb('user_id', '=', userId)]),
        ...(teamIds.length > 0
          ? [eb.and([eb('flow_id', '=', flowId), eb('team_id', 'in', teamIds)])]
          : []),
      ]),
    )
    .select([
      'id',
      'flow_id',
      'user_id',
      'team_id',
      'permission',
      'granted_by',
      'granted_at',
      'expires_at',
    ])
    .execute();
  const now = Date.now();
  return rows
    .map((row) => normalizeFlowAccessRecord(row as Record<string, unknown>))
    .filter((record) => !record.expiresAt || new Date(record.expiresAt).getTime() > now);
}

async function getEffectiveFlowAccessRecords(
  db: PluginDatabaseApi,
  flowId: string,
  userId: string,
  teamIds: string[],
): Promise<EffectiveAccessRecord[]> {
  const directRecords = (
    await listDirectFlowAccessForIdentity(db, flowId, userId, teamIds)
  ).map<EffectiveAccessRecord>((record) => ({ ...record, source: 'direct' }));

  const scopeId = await getFlowScopeId(db, flowId);
  if (!scopeId) {
    return directRecords;
  }

  const ancestorIds = await getAncestorScopeIds(db, scopeId);
  const inheritedRows = await listScopeAccessForScopeIds(db, ancestorIds, userId, teamIds);
  if (inheritedRows.length === 0) {
    return directRecords;
  }

  const scopeRows = await db
    .kysely<RbacDB>()
    .selectFrom('flowlib_rbac_teams')
    .where('id', 'in', ancestorIds)
    .select(['id', 'name'])
    .execute();
  const scopeNames = new Map(scopeRows.map((row) => [row.id, row.name]));

  return [
    ...directRecords,
    ...inheritedRows.map<EffectiveAccessRecord>((record) => ({
      id: record.id,
      flowId,
      userId: record.userId,
      teamId: record.teamId,
      permission: record.permission,
      grantedBy: record.grantedBy,
      grantedAt: record.grantedAt,
      expiresAt: null,
      source: 'inherited',
      scopeId: record.scopeId,
      scopeName: scopeNames.get(record.scopeId) ?? null,
    })),
  ];
}

async function getEffectiveFlowPermission(
  db: PluginDatabaseApi,
  flowId: string,
  identity: FlowlibIdentity,
): Promise<FlowAccessPermission | null> {
  const records = await getEffectiveFlowAccessRecords(
    db,
    flowId,
    identity.id,
    identity.teamIds ?? [],
  );

  let highest: FlowAccessPermission | null = null;
  for (const record of records) {
    highest = getHigherPermission(highest, record.permission);
  }
  return highest;
}

// Caller's effective permission on a scope itself, considering the scope's
// own grants and inheritance from ancestors. Used when granting access into a
// scope or moving a flow into one — both require owner on the target.
async function getEffectiveScopePermission(
  db: PluginDatabaseApi,
  scopeId: string,
  identity: FlowlibIdentity,
): Promise<FlowAccessPermission | null> {
  const ancestorIds = await getAncestorScopeIds(db, scopeId);
  if (ancestorIds.length === 0) {
    return null;
  }
  const records = await listScopeAccessForScopeIds(
    db,
    ancestorIds,
    identity.id,
    identity.teamIds ?? [],
  );
  let highest: FlowAccessPermission | null = null;
  for (const record of records) {
    highest = getHigherPermission(highest, record.permission);
  }
  return highest;
}

async function getCurrentUserAccessibleFlows(
  db: PluginDatabaseApi,
  identity: FlowlibIdentity,
): Promise<{ flowIds: string[]; permissions: Record<string, FlowAccessPermission | null> }> {
  const rows = await db.kysely<RbacDB>().selectFrom('flowlib_flows').select('id').execute();
  const permissions: Record<string, FlowAccessPermission | null> = {};

  await Promise.all(
    rows.map(async (row) => {
      permissions[row.id] = await getEffectiveFlowPermission(db, row.id, identity);
    }),
  );

  const flowIds = rows.map((row) => row.id).filter((flowId) => permissions[flowId]);
  return { flowIds, permissions };
}

async function getScopePath(db: PluginDatabaseApi, scopeId: string | null): Promise<string[]> {
  if (!scopeId) {
    return [];
  }

  // Recursive CTE — same shape as `getAncestorScopeIds`, but root depth is 0
  // so the leaf-to-root ORDER BY depth DESC produces the human-readable path.
  const result = await sql<{ id: string; name: string }>`
    WITH RECURSIVE ancestors AS (
      SELECT id, name, parent_id, 0 AS depth FROM flowlib_rbac_teams WHERE id = ${scopeId}
      UNION ALL
      SELECT p.id, p.name, p.parent_id, c.depth + 1
      FROM flowlib_rbac_teams p
      INNER JOIN ancestors c ON p.id = c.parent_id
    )
    SELECT id, name FROM ancestors ORDER BY depth DESC
  `.execute(db.kysely<RbacDB>());
  return result.rows.map((row) => row.name);
}

async function listAllScopeAccessForScopeIds(
  db: PluginDatabaseApi,
  scopeIds: string[],
): Promise<ScopeAccessRecord[]> {
  if (scopeIds.length === 0) {
    return [];
  }
  const rows = await db
    .kysely<RbacDB>()
    .selectFrom('flowlib_rbac_scope_access')
    .where('scope_id', 'in', scopeIds)
    .select(['id', 'scope_id', 'user_id', 'team_id', 'permission', 'granted_by', 'granted_at'])
    .execute();
  return rows.map((row) => normalizeScopeAccessRecord(row as Record<string, unknown>));
}

async function listAllDirectFlowAccess(
  db: PluginDatabaseApi,
  flowId: string,
): Promise<FlowAccessRecord[]> {
  const rows = await db
    .kysely<RbacDB>()
    .selectFrom('flowlib_flow_access')
    .where('flow_id', '=', flowId)
    .select([
      'id',
      'flow_id',
      'user_id',
      'team_id',
      'permission',
      'granted_by',
      'granted_at',
      'expires_at',
    ])
    .execute();
  const now = Date.now();
  return rows
    .map((row) => normalizeFlowAccessRecord(row as Record<string, unknown>))
    .filter((record) => !record.expiresAt || new Date(record.expiresAt).getTime() > now);
}

async function grantDirectFlowAccess(
  db: PluginDatabaseApi,
  input: {
    flowId: string;
    userId?: string;
    teamId?: string;
    permission: FlowAccessPermission;
    grantedBy?: string;
    expiresAt?: string;
  },
): Promise<FlowAccessRecord> {
  const now = new Date().toISOString();

  // Check for existing access. The previous `user_id IS ?` syntax was a
  // SQLite-only null-safe equality that silently failed on Postgres/MySQL.
  // Kysely's `'is' | '='` operator selection produces the portable form
  // (`IS NULL` when the value is null, `= ${val}` otherwise) on every dialect.
  const userIdValue = input.userId ?? null;
  const teamIdValue = input.teamId ?? null;
  const existingRows = await db
    .kysely<RbacDB>()
    .selectFrom('flowlib_flow_access')
    .where('flow_id', '=', input.flowId)
    .where('user_id', userIdValue === null ? 'is' : '=', userIdValue)
    .where('team_id', teamIdValue === null ? 'is' : '=', teamIdValue)
    .select('id')
    .execute();

  if (existingRows.length > 0) {
    const existingId = String(existingRows[0].id);
    await db.execute(
      'UPDATE flowlib_flow_access SET permission = ?, granted_by = ?, granted_at = ?, expires_at = ? WHERE id = ?',
      [input.permission, input.grantedBy ?? null, now, input.expiresAt ?? null, existingId],
    );
    return {
      id: existingId,
      flowId: input.flowId,
      userId: input.userId ?? null,
      teamId: input.teamId ?? null,
      permission: input.permission,
      grantedBy: input.grantedBy ?? null,
      grantedAt: now,
      expiresAt: input.expiresAt ?? null,
    };
  }

  const id = crypto.randomUUID();
  await db.execute(
    'INSERT INTO flowlib_flow_access (id, flow_id, user_id, team_id, permission, granted_by, granted_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [
      id,
      input.flowId,
      input.userId ?? null,
      input.teamId ?? null,
      input.permission,
      input.grantedBy ?? null,
      now,
      input.expiresAt ?? null,
    ],
  );
  return {
    id,
    flowId: input.flowId,
    userId: input.userId ?? null,
    teamId: input.teamId ?? null,
    permission: input.permission,
    grantedBy: input.grantedBy ?? null,
    grantedAt: now,
    expiresAt: input.expiresAt ?? null,
  };
}

async function revokeDirectFlowAccess(db: PluginDatabaseApi, accessId: string): Promise<void> {
  await db.execute('DELETE FROM flowlib_flow_access WHERE id = ?', [accessId]);
}

async function listAllEffectiveFlowAccessForPreview(
  db: PluginDatabaseApi,
  flowId: string,
  overrideScopeId?: string | null,
): Promise<Array<FlowAccessRecord | ScopeAccessRecord>> {
  const direct = await listAllDirectFlowAccess(db, flowId);
  const scopeId =
    overrideScopeId === undefined ? await getFlowScopeId(db, flowId) : overrideScopeId;
  if (!scopeId) {
    return direct;
  }

  const ancestorIds = await getAncestorScopeIds(db, scopeId);
  const inherited = await listAllScopeAccessForScopeIds(db, ancestorIds);
  return [...direct, ...inherited];
}

async function listAllEffectiveFlowAccessRecords(
  db: PluginDatabaseApi,
  flowId: string,
): Promise<EffectiveAccessRecord[]> {
  const directRecords = (await listAllDirectFlowAccess(db, flowId)).map<EffectiveAccessRecord>(
    (record) => ({
      ...record,
      source: 'direct',
    }),
  );

  const scopeId = await getFlowScopeId(db, flowId);
  if (!scopeId) {
    return directRecords;
  }

  const ancestorIds = await getAncestorScopeIds(db, scopeId);
  const inheritedRows = await listAllScopeAccessForScopeIds(db, ancestorIds);
  if (inheritedRows.length === 0) {
    return directRecords;
  }

  const scopeRows = await db
    .kysely<RbacDB>()
    .selectFrom('flowlib_rbac_teams')
    .where('id', 'in', ancestorIds)
    .select(['id', 'name'])
    .execute();
  const scopeNames = new Map(scopeRows.map((row) => [row.id, row.name]));

  // For team-based inherited grants, expand into per-member user records so the
  // UI shows individual users rather than team entities.
  const teamIds = [
    ...new Set(inheritedRows.map((r) => r.teamId).filter((id): id is string => !!id)),
  ];
  const teamMembersByTeamId = new Map<string, string[]>();
  if (teamIds.length > 0) {
    const memberRows = await db
      .kysely<RbacDB>()
      .selectFrom('flowlib_rbac_team_members')
      .where('team_id', 'in', teamIds)
      .select(['team_id', 'user_id'])
      .execute();
    for (const row of memberRows) {
      const members = teamMembersByTeamId.get(row.team_id) ?? [];
      members.push(row.user_id);
      teamMembersByTeamId.set(row.team_id, members);
    }
  }

  const expandedInherited: EffectiveAccessRecord[] = [];
  for (const record of inheritedRows) {
    const scopeName = scopeNames.get(record.scopeId) ?? null;
    if (record.teamId) {
      // Expand team grant → one record per team member
      const members = teamMembersByTeamId.get(record.teamId) ?? [];
      for (const userId of members) {
        expandedInherited.push({
          id: `${record.id}:${userId}`,
          flowId,
          userId,
          teamId: null,
          permission: record.permission,
          grantedBy: record.grantedBy,
          grantedAt: record.grantedAt,
          expiresAt: null,
          source: 'inherited',
          scopeId: record.scopeId,
          scopeName,
        });
      }
    } else {
      expandedInherited.push({
        id: record.id,
        flowId,
        userId: record.userId,
        teamId: null,
        permission: record.permission,
        grantedBy: record.grantedBy,
        grantedAt: record.grantedAt,
        expiresAt: null,
        source: 'inherited',
        scopeId: record.scopeId,
        scopeName,
      });
    }
  }

  return [...directRecords, ...expandedInherited];
}

function buildAccessKey(record: { userId?: string | null; teamId?: string | null }): string {
  if (record.userId) {
    return `user:${record.userId}`;
  }
  if (record.teamId) {
    return `team:${record.teamId}`;
  }
  return 'unknown';
}

async function resolveAccessChangeNames(
  db: PluginDatabaseApi,
  entries: Array<{
    userId?: string | null;
    teamId?: string | null;
    permission: FlowAccessPermission;
    source: string;
  }>,
): Promise<MovePreviewAccessChange[]> {
  const userIds = Array.from(
    new Set(entries.map((entry) => entry.userId).filter(Boolean)),
  ) as string[];
  const teamIds = Array.from(
    new Set(entries.map((entry) => entry.teamId).filter(Boolean)),
  ) as string[];

  const k = db.kysely<RbacDB>();
  const [userRows, teamRows] = await Promise.all([
    userIds.length > 0
      ? k
          .selectFrom('flowlib_user')
          .where('id', 'in', userIds)
          .select(['id', 'name', 'email'])
          .execute()
      : Promise.resolve([] as Array<{ id: string; name: string | null; email: string | null }>),
    teamIds.length > 0
      ? k
          .selectFrom('flowlib_rbac_teams')
          .where('id', 'in', teamIds)
          .select(['id', 'name'])
          .execute()
      : Promise.resolve([] as Array<{ id: string; name: string }>),
  ]);

  const userMap = new Map(userRows.map((row) => [row.id, row.name || row.email || row.id]));
  const teamMap = new Map(teamRows.map((row) => [row.id, row.name]));

  return entries.map((entry) => ({
    userId: entry.userId ?? undefined,
    teamId: entry.teamId ?? undefined,
    name: entry.userId
      ? (userMap.get(entry.userId) ?? entry.userId)
      : entry.teamId
        ? (teamMap.get(entry.teamId) ?? entry.teamId)
        : 'Unknown',
    permission: entry.permission,
    source: entry.source,
  }));
}

// ─────────────────────────────────────────────────────────────
// Plugin factory
// ─────────────────────────────────────────────────────────────

export function rbac(options: RbacPluginOptions = {}): FlowlibPluginDefinition {
  const { frontend, ...backendOptions } = options;
  return {
    id: 'rbac',
    name: 'Role-Based Access Control',
    backend: _rbacBackendPlugin(backendOptions),
    frontend,
  };
}

function _rbacBackendPlugin(options: Omit<RbacPluginOptions, 'frontend'> = {}): FlowlibPlugin {
  const { adminPermission = 'flow:read', enableTeams = true } = options;

  // ── Plugin-owned tables ─────────────────────────────────────
  const teamsSchema: FlowlibPluginSchema = enableTeams
    ? {
        flows: {
          fields: {
            scope_id: {
              type: 'string',
              required: false,
              references: { table: 'flowlib_rbac_teams', field: 'id', onDelete: 'set null' },
              index: true,
            },
          },
        },
        rbac_teams: {
          tableName: 'flowlib_rbac_teams',
          fields: {
            id: { type: 'string', primaryKey: true },
            name: { type: 'string', required: true },
            description: { type: 'text', required: false },
            parent_id: {
              type: 'string',
              required: false,
              references: { table: 'flowlib_rbac_teams', field: 'id', onDelete: 'set null' },
              index: true,
            },
            created_by: {
              type: 'string',
              required: false,
              references: { table: 'flowlib_user', field: 'id' },
            },
            created_at: { type: 'date', required: true, defaultValue: 'now()' },
            updated_at: { type: 'date', required: false },
          },
        },
        rbac_team_members: {
          tableName: 'flowlib_rbac_team_members',
          fields: {
            id: { type: 'string', primaryKey: true },
            team_id: {
              type: 'string',
              required: true,
              references: { table: 'flowlib_rbac_teams', field: 'id', onDelete: 'cascade' },
              index: true,
            },
            user_id: {
              type: 'string',
              required: true,
              references: { table: 'flowlib_user', field: 'id', onDelete: 'cascade' },
              index: true,
            },
            created_at: { type: 'date', required: true, defaultValue: 'now()' },
          },
        },
        rbac_scope_access: {
          tableName: 'flowlib_rbac_scope_access',
          fields: {
            id: { type: 'string', primaryKey: true },
            scope_id: {
              type: 'string',
              required: true,
              references: { table: 'flowlib_rbac_teams', field: 'id', onDelete: 'cascade' },
              index: true,
            },
            user_id: { type: 'string', required: false, index: true },
            team_id: { type: 'string', required: false, index: true },
            permission: {
              type: 'string',
              required: true,
              defaultValue: 'viewer',
              typeAnnotation: 'FlowAccessPermission',
            },
            granted_by: { type: 'string', required: false },
            granted_at: { type: 'date', required: true, defaultValue: 'now()' },
          },
        },
      }
    : {};

  // Mutable DB reference — captured from the first endpoint handler.
  // Used by the onRequest hook to resolve teamIds for the identity.
  let capturedDbApi: PluginDatabaseApi | null = null;

  // UI manifest — declares what the frontend should render.
  // Component IDs are resolved by the frontend plugin's component registry.
  const ui: PluginUIManifest = {
    sidebar: [
      {
        label: 'Access Control',
        icon: 'Shield',
        path: '/access',
        permission: adminPermission,
      },
      ...(enableTeams ? [] : []),
    ],
    pages: [
      {
        path: '/access',
        componentId: 'rbac.AccessControlPage',
        title: 'Access Control',
      },
      ...(enableTeams ? [] : []),
    ],
    panelTabs: [
      {
        context: 'flowEditor',
        label: 'Access',
        componentId: 'rbac.FlowAccessPanel',
        permission: 'flow:read',
      },
    ],
    headerActions: [
      {
        context: 'flowHeader',
        componentId: 'rbac.ShareButton',
        permission: 'flow:update',
      },
    ],
  };

  return {
    id: 'rbac',
    name: 'Role-Based Access Control',

    // Plugin-owned database tables
    schema: teamsSchema,

    // RBAC uses the core flow_access table (already checked by core),
    // but also depends on the auth plugin's tables for user identity.
    // Declaring them here ensures a clear error if the developer has the
    // RBAC plugin enabled but forgot the auth tables.
    requiredTables: [
      'flowlib_user',
      'flowlib_session',
      ...(enableTeams
        ? ['flowlib_rbac_teams', 'flowlib_rbac_team_members', 'flowlib_rbac_scope_access']
        : []),
    ],
    setupInstructions:
      'The RBAC plugin requires user-auth tables (flowlib_user, flowlib_session). ' +
      'Make sure @flowlib/user-auth is configured, then run ' +
      '`npx flowlib-cli generate` followed by `npx drizzle-kit push`.',

    settings: {
      namespace: 'rbac',
      label: 'Role-Based Access Control',
      description:
        'RBAC settings are bound at startup. `adminPermission` controls which permission gates the RBAC admin page; `enableTeams` toggles the teams subsystem and the rbac_teams* tables. Both require restart to change.',
      fields: [
        {
          key: 'rbac.adminPermission',
          label: 'Admin permission',
          description:
            'Configured in flowlib.config.ts. Permission required to access the RBAC admin pages — wired into endpoint definitions at startup.',
          type: 'string',
          readOnly: true,
          defaultValue: adminPermission,
        },
        {
          key: 'rbac.enableTeams',
          label: 'Teams enabled',
          description:
            'Configured in flowlib.config.ts. Toggling this changes which DB tables are required and which routes are mounted.',
          type: 'boolean',
          readOnly: true,
          defaultValue: enableTeams,
        },
      ],
    },

    // ─── Initialization ───────────────────────────────────────

    init: async (ctx: FlowlibPluginContext) => {
      // Verify that the auth plugin is loaded
      if (!ctx.hasPlugin('user-auth')) {
        ctx.logger.warn(
          'RBAC plugin requires the @flowlib/user-auth plugin. ' +
            'RBAC will work with reduced functionality (no session resolution). ' +
            'Make sure auth() is registered before rbac().',
        );
      }

      ctx.logger.info('RBAC plugin initialized');
    },

    // ─── Plugin Endpoints ─────────────────────────────────────

    endpoints: [
      // ── Auth Info ──

      {
        method: 'GET',
        path: '/rbac/me',
        isPublic: false,
        handler: async (ctx) => {
          // Capture DB API on first endpoint call for the onRequest hook
          if (!capturedDbApi && enableTeams) {
            capturedDbApi = ctx.database;
          }

          const identity = ctx.identity;
          const permissions = ctx.core.getPermissions(identity);
          const resolvedRole = identity ? ctx.core.getResolvedRole(identity) : null;

          return {
            status: 200,
            body: {
              identity: identity
                ? {
                    id: identity.id,
                    name: identity.name,
                    role: identity.role,
                    resolvedRole,
                  }
                : null,
              permissions,
              isAuthenticated: !!identity,
            },
          };
        },
      },

      {
        method: 'GET',
        path: '/rbac/roles',
        isPublic: false,
        permission: 'flow:read',
        handler: async (ctx) => {
          const roles = ctx.core.getAvailableRoles();
          return { status: 200, body: { roles } };
        },
      },

      // ── UI Manifest ──

      {
        method: 'GET',
        path: '/rbac/ui-manifest',
        isPublic: true,
        handler: async (_ctx) => {
          return {
            status: 200,
            body: {
              id: 'rbac',
              ...ui,
            },
          };
        },
      },

      // ── Flow Access Management ──

      {
        method: 'GET',
        path: '/rbac/flows/:flowId/access',
        permission: 'flow:read',
        handler: async (ctx) => {
          const flowId = ctx.params.flowId;
          if (!flowId) {
            return { status: 400, body: { error: 'Missing flowId parameter' } };
          }

          if (!ctx.identity) {
            return {
              status: 401,
              body: { error: 'Unauthorized', message: 'Authentication required' },
            };
          }

          const isAdmin = ctx.core.getPermissions(ctx.identity).includes('admin:*');
          const callerPermission = isAdmin
            ? 'owner'
            : await getEffectiveFlowPermission(ctx.database, flowId, ctx.identity);

          if (!callerPermission) {
            return {
              status: 403,
              body: { error: 'Forbidden', message: 'No access to this flow' },
            };
          }

          const access = await listAllDirectFlowAccess(ctx.database, flowId);
          return { status: 200, body: { access } };
        },
      },

      {
        method: 'POST',
        path: '/rbac/flows/:flowId/access',
        permission: 'flow:read',
        handler: async (ctx) => {
          const flowId = ctx.params.flowId;
          if (!flowId) {
            return { status: 400, body: { error: 'Missing flowId parameter' } };
          }

          const { userId, teamId, permission, expiresAt } = ctx.body as {
            userId?: string;
            teamId?: string;
            permission?: string;
            expiresAt?: string;
          };

          if (!userId && !teamId) {
            return {
              status: 400,
              body: { error: 'Either userId or teamId must be provided' },
            };
          }

          if (!ctx.identity) {
            return {
              status: 401,
              body: { error: 'Unauthorized', message: 'Authentication required' },
            };
          }

          const isAdmin = ctx.core.getPermissions(ctx.identity).includes('admin:*');
          const callerPermission = isAdmin
            ? 'owner'
            : await getEffectiveFlowPermission(ctx.database, flowId, ctx.identity);

          if (callerPermission !== 'owner') {
            return {
              status: 403,
              body: { error: 'Forbidden', message: 'Owner access is required to manage sharing' },
            };
          }

          if (!permission || !['owner', 'editor', 'operator', 'viewer'].includes(permission)) {
            return {
              status: 400,
              body: { error: 'permission must be one of: owner, editor, operator, viewer' },
            };
          }

          const access = await grantDirectFlowAccess(ctx.database, {
            flowId,
            userId,
            teamId,
            permission: permission as FlowAccessPermission,
            grantedBy: ctx.identity?.id,
            expiresAt,
          });
          return { status: 201, body: access };
        },
      },

      {
        method: 'DELETE',
        path: '/rbac/flows/:flowId/access/:accessId',
        permission: 'flow:read',
        handler: async (ctx) => {
          const { flowId, accessId } = ctx.params;
          if (!flowId || !accessId) {
            return { status: 400, body: { error: 'Missing flowId or accessId parameter' } };
          }

          if (!ctx.identity) {
            return {
              status: 401,
              body: { error: 'Unauthorized', message: 'Authentication required' },
            };
          }

          const isAdmin = ctx.core.getPermissions(ctx.identity).includes('admin:*');
          const callerPermission = isAdmin
            ? 'owner'
            : await getEffectiveFlowPermission(ctx.database, flowId, ctx.identity);

          if (callerPermission !== 'owner') {
            return {
              status: 403,
              body: { error: 'Forbidden', message: 'Owner access is required to manage sharing' },
            };
          }

          await revokeDirectFlowAccess(ctx.database, accessId);
          return { status: 204, body: null };
        },
      },

      {
        method: 'GET',
        path: '/rbac/flows/accessible',
        isPublic: false,
        handler: async (ctx) => {
          const identity = ctx.identity;
          if (!identity) {
            return {
              status: 401,
              body: { error: 'Unauthorized', message: 'Authentication required' },
            };
          }

          // Admins see all flows with implicit owner permission
          const isAdmin = ctx.core.getPermissions(identity).includes('admin:*');
          if (isAdmin) {
            return {
              status: 200,
              body: { flowIds: [], permissions: {}, isAdmin: true },
            };
          }

          const { flowIds, permissions } = await getCurrentUserAccessibleFlows(
            ctx.database,
            identity,
          );

          return {
            status: 200,
            body: {
              flowIds,
              permissions,
              isAdmin: false,
            },
          };
        },
      },

      {
        method: 'GET',
        path: '/rbac/flows/:flowId/effective-access',
        permission: 'flow:read',
        handler: async (ctx) => {
          const flowId = ctx.params.flowId;
          if (!flowId) {
            return { status: 400, body: { error: 'Missing flowId parameter' } };
          }
          if (!ctx.identity) {
            return {
              status: 401,
              body: { error: 'Unauthorized', message: 'Authentication required' },
            };
          }

          const isAdmin = ctx.core.getPermissions(ctx.identity).includes('admin:*');
          const callerPermission = isAdmin
            ? 'owner'
            : await getEffectiveFlowPermission(ctx.database, flowId, ctx.identity);

          if (!callerPermission) {
            return {
              status: 403,
              body: { error: 'Forbidden', message: 'No access to this flow' },
            };
          }

          const records = await listAllEffectiveFlowAccessRecords(ctx.database, flowId);

          return {
            status: 200,
            body: {
              flowId,
              scopeId: await getFlowScopeId(ctx.database, flowId),
              records,
            },
          };
        },
      },

      {
        method: 'PUT',
        path: '/rbac/flows/:flowId/scope',
        permission: 'flow:update',
        handler: async (ctx) => {
          const flowId = ctx.params.flowId;
          const { scopeId } = ctx.body as { scopeId?: string | null };
          if (!flowId) {
            return { status: 400, body: { error: 'Missing flowId parameter' } };
          }
          if (!ctx.identity) {
            return {
              status: 401,
              body: { error: 'Unauthorized', message: 'Authentication required' },
            };
          }

          const isAdmin = ctx.core.getPermissions(ctx.identity).includes('admin:*');
          const callerPermission = isAdmin
            ? 'owner'
            : await getEffectiveFlowPermission(ctx.database, flowId, ctx.identity);
          if (callerPermission !== 'owner') {
            return {
              status: 403,
              body: { error: 'Forbidden', message: 'Owner access is required to move flows' },
            };
          }

          if (scopeId) {
            const scopeRows = await ctx.database
              .kysely<RbacDB>()
              .selectFrom('flowlib_rbac_teams')
              .where('id', '=', scopeId)
              .select('id')
              .execute();
            if (scopeRows.length === 0) {
              return { status: 404, body: { error: 'Scope not found' } };
            }

            // Caller must also be an owner of the *target* scope. Without this
            // check, any flow owner could move their flow into an unrelated
            // scope to graft permissions onto themselves via scope-cascade
            // rules, or to share a flow with a scope they otherwise can't
            // touch.
            const targetPermission = isAdmin
              ? 'owner'
              : await getEffectiveScopePermission(ctx.database, scopeId, ctx.identity);
            if (targetPermission !== 'owner') {
              return {
                status: 403,
                body: {
                  error: 'Forbidden',
                  message: 'Owner access on the target scope is required to move flows into it',
                },
              };
            }
          }

          await ctx.database.execute('UPDATE flowlib_flows SET scope_id = ? WHERE id = ?', [
            scopeId ?? null,
            flowId,
          ]);
          return { status: 200, body: { success: true, flowId, scopeId: scopeId ?? null } };
        },
      },

      // ── Teams Management ──

      ...(enableTeams
        ? [
            {
              method: 'GET' as const,
              path: '/rbac/scopes/tree',
              isPublic: false,
              handler: async (ctx: PluginEndpointContext) => {
                if (!ctx.identity) {
                  return { status: 401, body: { error: 'Unauthorized' } };
                }

                const k = ctx.database.kysely<RbacDB>();
                const [teamRows, flowRows, memberRows, accessRows, teamRoleRows] =
                  await Promise.all([
                    k
                      .selectFrom('flowlib_rbac_teams')
                      .select([
                        'id',
                        'name',
                        'description',
                        'parent_id',
                        'created_by',
                        'created_at',
                        'updated_at',
                      ])
                      .orderBy('name')
                      .execute(),
                    k
                      .selectFrom('flowlib_flows')
                      .select(['id', 'name', 'scope_id'])
                      .orderBy('name')
                      .execute(),
                    k
                      .selectFrom('flowlib_rbac_team_members')
                      .select((eb) => ['team_id', eb.fn.countAll<number>().as('member_count')])
                      .groupBy('team_id')
                      .execute(),
                    k
                      .selectFrom('flowlib_rbac_scope_access')
                      .select((eb) => ['scope_id', eb.fn.countAll<number>().as('access_count')])
                      .groupBy('scope_id')
                      .execute(),
                    k
                      .selectFrom('flowlib_rbac_scope_access')
                      // Self-grant: team_id == scope_id (the team's own role on its scope).
                      .whereRef('team_id', '=', 'scope_id')
                      .where('team_id', 'is not', null)
                      .select(['scope_id', 'permission'])
                      .execute(),
                  ]);

                const memberCounts = new Map(
                  memberRows.map((row) => [row.team_id, Number(row.member_count)]),
                );
                const accessCounts = new Map(
                  accessRows.map((row) => [row.scope_id, Number(row.access_count)]),
                );
                const teamPermissions = new Map(
                  teamRoleRows.map((row) => [row.scope_id, row.permission]),
                );

                const nodeMap = new Map<string, ScopeTreeNode>();
                for (const row of teamRows) {
                  nodeMap.set(row.id, {
                    ...normalizeTeamRow(row),
                    children: [],
                    flows: [],
                    directAccessCount: accessCounts.get(row.id) ?? 0,
                    memberCount: memberCounts.get(row.id) ?? 0,
                    teamPermission: teamPermissions.get(row.id) ?? null,
                  });
                }

                const roots: ScopeTreeNode[] = [];
                for (const node of nodeMap.values()) {
                  if (node.parentId && nodeMap.has(node.parentId)) {
                    nodeMap.get(node.parentId)?.children.push(node);
                  } else {
                    roots.push(node);
                  }
                }

                const unscopedFlows: Array<{ id: string; name: string; scopeId: string | null }> =
                  [];
                for (const flow of flowRows) {
                  const mapped = { id: flow.id, name: flow.name, scopeId: flow.scope_id };
                  if (flow.scope_id && nodeMap.has(flow.scope_id)) {
                    nodeMap.get(flow.scope_id)?.flows.push(mapped);
                  } else {
                    unscopedFlows.push(mapped);
                  }
                }

                return { status: 200, body: { scopes: roots, unscopedFlows } };
              },
            },

            {
              method: 'GET' as const,
              path: '/rbac/scopes/:scopeId/access',
              isPublic: false,
              handler: async (ctx: PluginEndpointContext) => {
                if (!ctx.identity) {
                  return { status: 401, body: { error: 'Unauthorized' } };
                }

                const rows = await ctx.database
                  .kysely<RbacDB>()
                  .selectFrom('flowlib_rbac_scope_access')
                  .where('scope_id', '=', ctx.params.scopeId)
                  .select([
                    'id',
                    'scope_id',
                    'user_id',
                    'team_id',
                    'permission',
                    'granted_by',
                    'granted_at',
                  ])
                  .execute();
                return {
                  status: 200,
                  body: {
                    access: rows.map((row) =>
                      normalizeScopeAccessRecord(row as Record<string, unknown>),
                    ),
                  },
                };
              },
            },

            {
              method: 'POST' as const,
              path: '/rbac/scopes/:scopeId/access',
              isPublic: false,
              handler: async (ctx: PluginEndpointContext) => {
                if (!ctx.identity) {
                  return { status: 401, body: { error: 'Unauthorized' } };
                }
                const isAdmin = ctx.core.getPermissions(ctx.identity).includes('admin:*');
                if (!isAdmin) {
                  return {
                    status: 403,
                    body: { error: 'Forbidden', message: 'Admin access required' },
                  };
                }

                const { scopeId } = ctx.params;
                const { userId, teamId, permission } = ctx.body as {
                  userId?: string;
                  teamId?: string;
                  permission?: string;
                };

                if (!scopeId) {
                  return { status: 400, body: { error: 'Missing scopeId parameter' } };
                }
                if (!userId && !teamId) {
                  return {
                    status: 400,
                    body: { error: 'Either userId or teamId must be provided' },
                  };
                }
                if (userId && teamId) {
                  return {
                    status: 400,
                    body: { error: 'Provide either userId or teamId, not both' },
                  };
                }
                if (teamId && teamId !== scopeId) {
                  return {
                    status: 400,
                    body: { error: 'Teams can only hold a role on their own scope' },
                  };
                }
                if (!isFlowAccessPermission(permission)) {
                  return {
                    status: 400,
                    body: { error: 'permission must be one of: owner, editor, operator, viewer' },
                  };
                }

                // Same Postgres bug as `grantDirectFlowAccess` — `IS ?` only
                // works on SQLite. Kysely's `'is' | '='` operator selection
                // produces the portable form across all three dialects.
                const userIdValue = userId ?? null;
                const teamIdValue = teamId ?? null;
                const existing = await ctx.database
                  .kysely<RbacDB>()
                  .selectFrom('flowlib_rbac_scope_access')
                  .where('scope_id', '=', scopeId)
                  .where('user_id', userIdValue === null ? 'is' : '=', userIdValue)
                  .where('team_id', teamIdValue === null ? 'is' : '=', teamIdValue)
                  .select('id')
                  .execute();

                const now = new Date().toISOString();
                if (existing[0]) {
                  await ctx.database.execute(
                    'UPDATE flowlib_rbac_scope_access SET permission = ?, granted_by = ?, granted_at = ? WHERE id = ?',
                    [permission, ctx.identity.id, now, existing[0].id],
                  );
                  return {
                    status: 200,
                    body: {
                      id: existing[0].id,
                      scopeId,
                      userId: userId ?? null,
                      teamId: teamId ?? null,
                      permission,
                      grantedBy: ctx.identity.id,
                      grantedAt: now,
                    },
                  };
                }

                const id = crypto.randomUUID();
                await ctx.database.execute(
                  'INSERT INTO flowlib_rbac_scope_access (id, scope_id, user_id, team_id, permission, granted_by, granted_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
                  [id, scopeId, userId ?? null, teamId ?? null, permission, ctx.identity.id, now],
                );

                return {
                  status: 201,
                  body: {
                    id,
                    scopeId,
                    userId: userId ?? null,
                    teamId: teamId ?? null,
                    permission,
                    grantedBy: ctx.identity.id,
                    grantedAt: now,
                  },
                };
              },
            },

            {
              method: 'DELETE' as const,
              path: '/rbac/scopes/:scopeId/access/:accessId',
              isPublic: false,
              handler: async (ctx: PluginEndpointContext) => {
                if (!ctx.identity) {
                  return { status: 401, body: { error: 'Unauthorized' } };
                }
                const isAdmin = ctx.core.getPermissions(ctx.identity).includes('admin:*');
                if (!isAdmin) {
                  return {
                    status: 403,
                    body: { error: 'Forbidden', message: 'Admin access required' },
                  };
                }

                await ctx.database.execute('DELETE FROM flowlib_rbac_scope_access WHERE id = ?', [
                  ctx.params.accessId,
                ]);
                return { status: 204, body: null };
              },
            },

            {
              method: 'POST' as const,
              path: '/rbac/preview-move',
              isPublic: false,
              handler: async (ctx: PluginEndpointContext) => {
                if (!ctx.identity) {
                  return { status: 401, body: { error: 'Unauthorized' } };
                }
                const isAdmin = ctx.core.getPermissions(ctx.identity).includes('admin:*');
                if (!isAdmin) {
                  return {
                    status: 403,
                    body: { error: 'Forbidden', message: 'Admin access required' },
                  };
                }

                const { type, id, targetScopeId } = ctx.body as {
                  type?: 'flow' | 'scope';
                  id?: string;
                  targetScopeId?: string | null;
                };

                if (!type || !id) {
                  return { status: 400, body: { error: 'type and id are required' } };
                }

                let affectedFlowIds: string[] = [];
                let itemName = id;
                const k = ctx.database.kysely<RbacDB>();
                if (type === 'flow') {
                  const rows = await k
                    .selectFrom('flowlib_flows')
                    .where('id', '=', id)
                    .select(['id', 'name'])
                    .execute();
                  if (!rows[0]) {
                    return { status: 404, body: { error: 'Flow not found' } };
                  }
                  itemName = rows[0].name;
                  affectedFlowIds = [id];
                } else {
                  const scopeRows = await k
                    .selectFrom('flowlib_rbac_teams')
                    .where('id', '=', id)
                    .select(['id', 'name'])
                    .execute();
                  if (!scopeRows[0]) {
                    return { status: 404, body: { error: 'Scope not found' } };
                  }
                  itemName = scopeRows[0].name;
                  const descendantScopeIds = await getDescendantScopeIds(ctx.database, id);
                  if (targetScopeId && descendantScopeIds.includes(targetScopeId)) {
                    return {
                      status: 400,
                      body: { error: 'Cannot move a scope into itself or its descendant' },
                    };
                  }
                  const flowRows = await k
                    .selectFrom('flowlib_flows')
                    .where('scope_id', 'in', descendantScopeIds)
                    .select('id')
                    .execute();
                  affectedFlowIds = flowRows.map((row) => row.id);
                }

                const targetPath = await getScopePath(ctx.database, targetScopeId ?? null);
                const targetAncestorIds = targetScopeId
                  ? await getAncestorScopeIds(ctx.database, targetScopeId)
                  : [];
                const targetScopeAccess = await listAllScopeAccessForScopeIds(
                  ctx.database,
                  targetAncestorIds,
                );

                const gainedEntries = new Map<
                  string,
                  {
                    userId?: string | null;
                    teamId?: string | null;
                    permission: FlowAccessPermission;
                    source: string;
                  }
                >();
                let unchanged = 0;

                for (const flowId of affectedFlowIds) {
                  const currentRecords = await listAllEffectiveFlowAccessForPreview(
                    ctx.database,
                    flowId,
                  );
                  const currentPermissions = new Map<string, FlowAccessPermission>();
                  for (const record of currentRecords) {
                    const permission = toFlowAccessPermission(record.permission);
                    if (!permission) {
                      continue;
                    }
                    const key = buildAccessKey(record);
                    currentPermissions.set(
                      key,
                      getHigherPermission(currentPermissions.get(key) ?? null, permission) ??
                        permission,
                    );
                  }

                  for (const record of targetScopeAccess) {
                    const key = buildAccessKey(record);
                    const existingPermission = currentPermissions.get(key) ?? null;
                    if (
                      existingPermission &&
                      FLOW_PERMISSION_LEVELS[existingPermission] >=
                        FLOW_PERMISSION_LEVELS[record.permission]
                    ) {
                      unchanged += 1;
                      continue;
                    }
                    gainedEntries.set(key, {
                      userId: record.userId,
                      teamId: record.teamId,
                      permission: record.permission,
                      source: `from ${targetPath.at(-1) ?? 'root'}`,
                    });
                  }
                }

                const gained = await resolveAccessChangeNames(
                  ctx.database,
                  Array.from(gainedEntries.values()),
                );

                return {
                  status: 200,
                  body: {
                    item: { id, name: itemName, type },
                    target: {
                      id: targetScopeId ?? null,
                      name: targetPath.at(-1) ?? 'Unscoped',
                      path: targetPath,
                    },
                    affectedFlows: affectedFlowIds.length,
                    accessChanges: {
                      gained,
                      unchanged,
                    },
                  },
                };
              },
            },

            // List all teams
            {
              method: 'GET' as const,
              path: '/rbac/teams',
              isPublic: false,
              handler: async (ctx: PluginEndpointContext) => {
                if (!ctx.identity) {
                  return { status: 401, body: { error: 'Unauthorized' } };
                }

                const rows = await ctx.database
                  .kysely<RbacDB>()
                  .selectFrom('flowlib_rbac_teams')
                  .select([
                    'id',
                    'name',
                    'description',
                    'parent_id',
                    'created_by',
                    'created_at',
                    'updated_at',
                  ])
                  .orderBy('name')
                  .execute();

                const teams = rows.map((r) => normalizeTeamRow(r));

                return { status: 200, body: { teams } };
              },
            },

            // Create a team (admin only)
            {
              method: 'POST' as const,
              path: '/rbac/teams',
              isPublic: false,
              handler: async (ctx: PluginEndpointContext) => {
                if (!ctx.identity) {
                  return { status: 401, body: { error: 'Unauthorized' } };
                }
                const isAdmin = ctx.core.getPermissions(ctx.identity).includes('admin:*');
                if (!isAdmin) {
                  return {
                    status: 403,
                    body: { error: 'Forbidden', message: 'Admin access required' },
                  };
                }

                const { name, description, parentId } = ctx.body as {
                  name?: string;
                  description?: string;
                  parentId?: string | null;
                };
                if (!name?.trim()) {
                  return { status: 400, body: { error: 'Team name is required' } };
                }

                if (parentId) {
                  const parentRows = await ctx.database
                    .kysely<RbacDB>()
                    .selectFrom('flowlib_rbac_teams')
                    .where('id', '=', parentId)
                    .select('id')
                    .execute();
                  if (parentRows.length === 0) {
                    return { status: 404, body: { error: 'Parent scope not found' } };
                  }
                }

                const id = crypto.randomUUID();
                const now = new Date().toISOString();
                await ctx.database.execute(
                  'INSERT INTO flowlib_rbac_teams (id, name, description, parent_id, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
                  [
                    id,
                    name.trim(),
                    description?.trim() || null,
                    parentId ?? null,
                    ctx.identity.id,
                    now,
                    now,
                  ],
                );

                return {
                  status: 201,
                  body: {
                    id,
                    name: name.trim(),
                    description: description?.trim() || null,
                    parentId: parentId ?? null,
                    createdBy: ctx.identity.id,
                    createdAt: now,
                    updatedAt: now,
                  },
                };
              },
            },

            // Update a team (admin only)
            {
              method: 'PUT' as const,
              path: '/rbac/teams/:teamId',
              isPublic: false,
              handler: async (ctx: PluginEndpointContext) => {
                if (!ctx.identity) {
                  return { status: 401, body: { error: 'Unauthorized' } };
                }
                const isAdmin = ctx.core.getPermissions(ctx.identity).includes('admin:*');
                if (!isAdmin) {
                  return {
                    status: 403,
                    body: { error: 'Forbidden', message: 'Admin access required' },
                  };
                }

                const { teamId } = ctx.params;
                const { name, description, parentId } = ctx.body as {
                  name?: string;
                  description?: string;
                  parentId?: string | null;
                };

                const existing = await ctx.database
                  .kysely<RbacDB>()
                  .selectFrom('flowlib_rbac_teams')
                  .where('id', '=', teamId)
                  .select('id')
                  .execute();
                if (existing.length === 0) {
                  return { status: 404, body: { error: 'Team not found' } };
                }

                if (parentId === teamId) {
                  return { status: 400, body: { error: 'A scope cannot be its own parent' } };
                }
                if (parentId) {
                  const parentRows = await ctx.database
                    .kysely<RbacDB>()
                    .selectFrom('flowlib_rbac_teams')
                    .where('id', '=', parentId)
                    .select('id')
                    .execute();
                  if (parentRows.length === 0) {
                    return { status: 404, body: { error: 'Parent scope not found' } };
                  }
                  const descendantScopeIds = await getDescendantScopeIds(ctx.database, teamId);
                  if (descendantScopeIds.includes(parentId)) {
                    return {
                      status: 400,
                      body: { error: 'Cannot move a scope into itself or its descendant' },
                    };
                  }
                }

                const updates: string[] = [];
                const values: unknown[] = [];
                if (name !== undefined) {
                  if (!name.trim()) {
                    return { status: 400, body: { error: 'Team name cannot be empty' } };
                  }
                  updates.push('name = ?');
                  values.push(name.trim());
                }
                if (description !== undefined) {
                  updates.push('description = ?');
                  values.push(description?.trim() || null);
                }
                if (parentId !== undefined) {
                  updates.push('parent_id = ?');
                  values.push(parentId ?? null);
                }
                if (updates.length === 0) {
                  return { status: 400, body: { error: 'No fields to update' } };
                }

                updates.push('updated_at = ?');
                values.push(new Date().toISOString());
                values.push(teamId);

                await ctx.database.execute(
                  `UPDATE flowlib_rbac_teams SET ${updates.join(', ')} WHERE id = ?`,
                  values,
                );

                return { status: 200, body: { success: true } };
              },
            },

            // Delete a team (admin only)
            {
              method: 'DELETE' as const,
              path: '/rbac/teams/:teamId',
              isPublic: false,
              handler: async (ctx: PluginEndpointContext) => {
                if (!ctx.identity) {
                  return { status: 401, body: { error: 'Unauthorized' } };
                }
                const isAdmin = ctx.core.getPermissions(ctx.identity).includes('admin:*');
                if (!isAdmin) {
                  return {
                    status: 403,
                    body: { error: 'Forbidden', message: 'Admin access required' },
                  };
                }

                const { teamId } = ctx.params;
                const teams = await ctx.database
                  .kysely<RbacDB>()
                  .selectFrom('flowlib_rbac_teams')
                  .where('id', '=', teamId)
                  .select(['id', 'parent_id'])
                  .execute();
                if (teams.length === 0) {
                  return { status: 404, body: { error: 'Team not found' } };
                }

                const parentId = teams[0].parent_id ?? null;
                await ctx.database.execute(
                  'UPDATE flowlib_flows SET scope_id = ? WHERE scope_id = ?',
                  [parentId, teamId],
                );

                // CASCADE on team_members handles cleanup
                await ctx.database.execute('DELETE FROM flowlib_rbac_teams WHERE id = ?', [teamId]);
                return { status: 204, body: null };
              },
            },

            // Get team with members
            {
              method: 'GET' as const,
              path: '/rbac/teams/:teamId',
              isPublic: false,
              handler: async (ctx: PluginEndpointContext) => {
                if (!ctx.identity) {
                  return { status: 401, body: { error: 'Unauthorized' } };
                }

                const { teamId } = ctx.params;
                const k = ctx.database.kysely<RbacDB>();
                const teams = await k
                  .selectFrom('flowlib_rbac_teams')
                  .where('id', '=', teamId)
                  .select([
                    'id',
                    'name',
                    'description',
                    'parent_id',
                    'created_by',
                    'created_at',
                    'updated_at',
                  ])
                  .execute();

                if (teams.length === 0) {
                  return { status: 404, body: { error: 'Team not found' } };
                }

                const members = await k
                  .selectFrom('flowlib_rbac_team_members')
                  .where('team_id', '=', teamId)
                  .select(['id', 'team_id', 'user_id', 'created_at'])
                  .execute();

                const team = teams[0];
                return {
                  status: 200,
                  body: {
                    ...normalizeTeamRow(team),
                    members: members.map((m) => ({
                      id: m.id,
                      teamId: m.team_id,
                      userId: m.user_id,
                      createdAt: m.created_at,
                    })),
                  },
                };
              },
            },

            // Add member to team (admin only)
            {
              method: 'POST' as const,
              path: '/rbac/teams/:teamId/members',
              isPublic: false,
              handler: async (ctx: PluginEndpointContext) => {
                if (!ctx.identity) {
                  return { status: 401, body: { error: 'Unauthorized' } };
                }
                const isAdmin = ctx.core.getPermissions(ctx.identity).includes('admin:*');
                if (!isAdmin) {
                  return {
                    status: 403,
                    body: { error: 'Forbidden', message: 'Admin access required' },
                  };
                }

                const { teamId } = ctx.params;
                const { userId } = ctx.body as { userId?: string };
                if (!userId?.trim()) {
                  return { status: 400, body: { error: 'userId is required' } };
                }

                // Check team exists
                const k = ctx.database.kysely<RbacDB>();
                const teams = await k
                  .selectFrom('flowlib_rbac_teams')
                  .where('id', '=', teamId)
                  .select('id')
                  .execute();
                if (teams.length === 0) {
                  return { status: 404, body: { error: 'Team not found' } };
                }

                // Check not already a member
                const existing = await k
                  .selectFrom('flowlib_rbac_team_members')
                  .where('team_id', '=', teamId)
                  .where('user_id', '=', userId.trim())
                  .select('id')
                  .execute();
                if (existing.length > 0) {
                  return { status: 409, body: { error: 'User is already a member of this team' } };
                }

                const id = crypto.randomUUID();
                const now = new Date().toISOString();
                await ctx.database.execute(
                  'INSERT INTO flowlib_rbac_team_members (id, team_id, user_id, created_at) VALUES (?, ?, ?, ?)',
                  [id, teamId, userId.trim(), now],
                );

                return {
                  status: 201,
                  body: { id, teamId, userId: userId.trim(), createdAt: now },
                };
              },
            },

            // Remove member from team (admin only)
            {
              method: 'DELETE' as const,
              path: '/rbac/teams/:teamId/members/:userId',
              isPublic: false,
              handler: async (ctx: PluginEndpointContext) => {
                if (!ctx.identity) {
                  return { status: 401, body: { error: 'Unauthorized' } };
                }
                const isAdmin = ctx.core.getPermissions(ctx.identity).includes('admin:*');
                if (!isAdmin) {
                  return {
                    status: 403,
                    body: { error: 'Forbidden', message: 'Admin access required' },
                  };
                }

                const { teamId, userId } = ctx.params;
                await ctx.database.execute(
                  'DELETE FROM flowlib_rbac_team_members WHERE team_id = ? AND user_id = ?',
                  [teamId, userId],
                );
                return { status: 204, body: null };
              },
            },

            // Get teams for current user (for identity resolution)
            {
              method: 'GET' as const,
              path: '/rbac/my-teams',
              isPublic: false,
              handler: async (ctx: PluginEndpointContext) => {
                if (!ctx.identity) {
                  return { status: 401, body: { error: 'Unauthorized' } };
                }

                const rows = await ctx.database
                  .kysely<RbacDB>()
                  .selectFrom('flowlib_rbac_teams as t')
                  .innerJoin('flowlib_rbac_team_members as tm', 'tm.team_id', 't.id')
                  .where('tm.user_id', '=', ctx.identity.id)
                  .select([
                    't.id',
                    't.name',
                    't.description',
                    't.parent_id',
                    't.created_by',
                    't.created_at',
                    't.updated_at',
                  ])
                  .orderBy('t.name')
                  .execute();

                const teams = rows.map((r) => normalizeTeamRow(r));

                return { status: 200, body: { teams } };
              },
            },
          ]
        : []),
    ],

    // ─── Lifecycle Hooks ──────────────────────────────────────

    hooks: {
      // Enrich identity with teamIds after auth plugin resolves the session.
      // This runs after the auth plugin's onRequest hook since RBAC is registered
      // after auth. We query rbac_team_members to get the user's team IDs.
      onRequest: enableTeams
        ? async (
            _request: Request,
            context: { path: string; method: string; identity: FlowlibIdentity | null },
          ) => {
            if (!context.identity || !capturedDbApi) {
              return;
            }
            // Skip if teamIds already populated (custom mapUser)
            if (context.identity.teamIds && context.identity.teamIds.length > 0) {
              return;
            }

            try {
              const rows = await capturedDbApi.query<{ team_id: string }>(
                'SELECT team_id FROM flowlib_rbac_team_members WHERE user_id = ?',
                [context.identity.id],
              );
              if (rows.length > 0) {
                context.identity = {
                  ...context.identity,
                  teamIds: rows.map((r) => r.team_id),
                };
              }
            } catch {
              // Silently ignore — table may not exist yet during initial setup
            }
          }
        : undefined,

      // Enforce flow-level ACLs on authorization checks
      onAuthorize: async (context) => {
        const { identity, resource, action } = context;

        // Only enforce for flow-related resources with specific IDs
        if (!identity || !resource?.id) {
          return;
        }

        if (!FLOW_RESOURCE_TYPES.has(resource.type)) {
          return;
        }

        if (identity.permissions?.includes('admin:*') || identity.role === 'admin') {
          return { allowed: true };
        }

        const database = context.database ?? capturedDbApi;
        if (!database) {
          return;
        }

        const effectivePermission = await getEffectiveFlowPermission(
          database,
          resource.id,
          identity,
        );
        if (!effectivePermission) {
          return { allowed: false };
        }

        const requiredPermission = mapActionToRequiredPermission(action);
        return {
          allowed:
            FLOW_PERMISSION_LEVELS[effectivePermission] >=
            FLOW_PERMISSION_LEVELS[requiredPermission],
        };
      },

      // Auto-grant owner access when a flow is created
      afterFlowRun: async (_context) => {
        // This hook is for flow *runs*, not flow creation.
      },
    },

    // ─── Error Codes ──────────────────────────────────────────

    $ERROR_CODES: {
      'rbac:no_access': {
        message: 'You do not have access to this flow.',
        status: 403,
      },
      'rbac:insufficient_permission': {
        message: 'Your access level is insufficient for this operation.',
        status: 403,
      },
      'rbac:auth_required': {
        message: 'Authentication is required. Please sign in.',
        status: 401,
      },
      'rbac:plugin_missing': {
        message: 'The RBAC plugin requires the @flowlib/user-auth plugin.',
        status: 500,
      },
    },
  };
}
