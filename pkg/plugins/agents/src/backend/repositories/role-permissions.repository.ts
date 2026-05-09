/**
 * Persistence for `agent_role_permissions`.
 *
 * Unlike the other tables, this one has **no `orgId` column** — role names
 * are platform-defined globals. Org-scoped roles are namespaced into the
 * `roleId` itself (e.g. `org:acme:reviewer`). Composite primary key is
 * `(roleId, toolName)`.
 *
 * v1 follows the placeholder shape declared in the abstract schema.
 */

import type { PluginDatabaseApi } from '@flowlib/core';
import type { AgentsDB } from './db-types';
import { boolFor, nowFor, toBool, toIso } from './util';

export interface AgentRolePermission {
  roleId: string;
  toolName: string;
  enabled: boolean;
  reason: string | null;
  updatedAt: string;
}

interface AgentRolePermissionRow {
  role_id: string;
  tool_name: string;
  enabled: 0 | 1 | boolean;
  reason: string | null;
  updated_at: string | Date;
}

export interface UpsertRolePermissionInput {
  roleId: string;
  toolName: string;
  enabled: boolean;
  reason?: string | null;
}

export interface ListRolePermissionsFilter {
  roleId?: string;
  toolName?: string;
  enabled?: boolean;
  limit?: number;
  offset?: number;
}

function mapRow(row: AgentRolePermissionRow): AgentRolePermission {
  return {
    roleId: row.role_id,
    toolName: row.tool_name,
    enabled: toBool(row.enabled),
    reason: row.reason,
    updatedAt: toIso(row.updated_at),
  };
}

export class RolePermissionsRepository {
  constructor(private readonly database: PluginDatabaseApi) {}

  async findById(roleId: string, toolName: string): Promise<AgentRolePermission | null> {
    const row = await this.database
      .kysely<AgentsDB>()
      .selectFrom('agent_role_permissions')
      .selectAll()
      .where('role_id', '=', roleId)
      .where('tool_name', '=', toolName)
      .limit(1)
      .executeTakeFirst();
    return row ? mapRow(row as unknown as AgentRolePermissionRow) : null;
  }

  async list(filter: ListRolePermissionsFilter = {}): Promise<AgentRolePermission[]> {
    let query = this.database
      .kysely<AgentsDB>()
      .selectFrom('agent_role_permissions')
      .selectAll();
    if (filter.roleId !== undefined) query = query.where('role_id', '=', filter.roleId);
    if (filter.toolName !== undefined) query = query.where('tool_name', '=', filter.toolName);
    if (filter.enabled !== undefined) {
      query = query.where('enabled', '=', boolFor(this.database, filter.enabled));
    }
    query = query.orderBy('role_id', 'asc').orderBy('tool_name', 'asc');
    if (filter.limit !== undefined) query = query.limit(filter.limit);
    if (filter.offset !== undefined) query = query.offset(filter.offset);
    const rows = await query.execute();
    return rows.map((row) => mapRow(row as unknown as AgentRolePermissionRow));
  }

  /**
   * Insert a new permission row. Throws if `(roleId, toolName)` already
   * exists; callers wanting upsert semantics should use {@link upsert}.
   */
  async create(input: UpsertRolePermissionInput): Promise<AgentRolePermission> {
    const now = nowFor(this.database);
    await this.database
      .kysely<AgentsDB>()
      .insertInto('agent_role_permissions')
      .values({
        role_id: input.roleId,
        tool_name: input.toolName,
        enabled: boolFor(this.database, input.enabled),
        reason: input.reason ?? null,
        updated_at: now,
      } as never)
      .execute();
    const created = await this.findById(input.roleId, input.toolName);
    if (!created) throw new Error('Failed to load created role permission');
    return created;
  }

  /** Update an existing row. Returns null when no row exists. */
  async update(
    roleId: string,
    toolName: string,
    patch: Partial<Omit<UpsertRolePermissionInput, 'roleId' | 'toolName'>>,
  ): Promise<AgentRolePermission | null> {
    const set: Record<string, unknown> = {};
    if (patch.enabled !== undefined) set.enabled = boolFor(this.database, patch.enabled);
    if (patch.reason !== undefined) set.reason = patch.reason;

    if (Object.keys(set).length === 0) return this.findById(roleId, toolName);
    set.updated_at = nowFor(this.database);

    await this.database
      .kysely<AgentsDB>()
      .updateTable('agent_role_permissions')
      .set(set as never)
      .where('role_id', '=', roleId)
      .where('tool_name', '=', toolName)
      .execute();

    return this.findById(roleId, toolName);
  }

  /**
   * Convenience: insert-or-update by composite key. Implemented as
   * "find then create or update" rather than dialect-specific
   * `INSERT … ON CONFLICT`, keeping the SQL portable across SQLite,
   * Postgres, and MySQL via Kysely's expression builder.
   */
  async upsert(input: UpsertRolePermissionInput): Promise<AgentRolePermission> {
    const existing = await this.findById(input.roleId, input.toolName);
    if (existing) {
      const updated = await this.update(input.roleId, input.toolName, {
        enabled: input.enabled,
        reason: input.reason ?? null,
      });
      if (!updated) throw new Error('Failed to upsert role permission');
      return updated;
    }
    return this.create(input);
  }

  async delete(roleId: string, toolName: string): Promise<void> {
    await this.database
      .kysely<AgentsDB>()
      .deleteFrom('agent_role_permissions')
      .where('role_id', '=', roleId)
      .where('tool_name', '=', toolName)
      .execute();
  }
}
