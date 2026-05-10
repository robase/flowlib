/**
 * Persistence for `agent_mcp_servers` — org-scoped MCP server registry.
 *
 * MCP servers are configured once per org (like credentials) and toggled
 * per session via `agent_sessions.enabledMcpServerIds`.
 */

import type { PluginDatabaseApi } from '@flowlib/core';
import type { AgentMcpServer, McpTransport } from '../../shared/types';
import type { AgentsDB } from './db-types';
import { encodeJsonOrNull, generateId, nowFor, parseJsonOrNull, toIso } from './util';

interface AgentMcpServerRow {
  id: string;
  org_id: string | null;
  name: string;
  description: string | null;
  transport: string;
  config: unknown;
  created_by: string;
  created_at: string | Date;
  updated_at: string | Date;
}

export interface CreateMcpServerInput {
  id?: string;
  orgId: string | null;
  name: string;
  description?: string | null;
  transport: McpTransport;
  config: Record<string, unknown>;
  createdBy: string;
}

export interface UpdateMcpServerInput {
  name?: string;
  description?: string | null;
  transport?: McpTransport;
  config?: Record<string, unknown>;
}

export interface ListMcpServersFilter {
  orgId?: string | null;
}

function mapRow(row: AgentMcpServerRow): AgentMcpServer {
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    description: row.description,
    transport: row.transport as McpTransport,
    config: parseJsonOrNull<Record<string, unknown>>(row.config) ?? {},
    createdBy: row.created_by,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export class McpServersRepository {
  constructor(private readonly database: PluginDatabaseApi) {}

  async findById(id: string, orgId?: string | null): Promise<AgentMcpServer | null> {
    let query = this.database
      .kysely<AgentsDB>()
      .selectFrom('agent_mcp_servers')
      .selectAll()
      .where('id', '=', id);
    if (orgId !== undefined) {
      query =
        orgId === null ? query.where('org_id', 'is', null) : query.where('org_id', '=', orgId);
    }
    const row = await query.limit(1).executeTakeFirst();
    return row ? mapRow(row as unknown as AgentMcpServerRow) : null;
  }

  async list(filter: ListMcpServersFilter = {}): Promise<AgentMcpServer[]> {
    let query = this.database.kysely<AgentsDB>().selectFrom('agent_mcp_servers').selectAll();
    if (filter.orgId !== undefined) {
      query =
        filter.orgId === null
          ? query.where('org_id', 'is', null)
          : query.where('org_id', '=', filter.orgId);
    }
    const rows = await query.orderBy('created_at', 'desc').execute();
    return rows.map((row) => mapRow(row as unknown as AgentMcpServerRow));
  }

  async create(input: CreateMcpServerInput): Promise<AgentMcpServer> {
    const id = input.id ?? generateId();
    const now = nowFor(this.database);

    await this.database
      .kysely<AgentsDB>()
      .insertInto('agent_mcp_servers')
      .values({
        id,
        org_id: input.orgId,
        name: input.name,
        description: input.description ?? null,
        transport: input.transport,
        config: encodeJsonOrNull(input.config) ?? '{}',
        created_by: input.createdBy,
        created_at: now,
        updated_at: now,
      } as never)
      .execute();

    const created = await this.findById(id, input.orgId);
    if (!created) {
      throw new Error('Failed to load created MCP server');
    }
    return created;
  }

  async update(
    id: string,
    patch: UpdateMcpServerInput,
    orgId?: string | null,
  ): Promise<AgentMcpServer | null> {
    const set: Record<string, unknown> = {};
    if (patch.name !== undefined) {
      set.name = patch.name;
    }
    if (patch.description !== undefined) {
      set.description = patch.description;
    }
    if (patch.transport !== undefined) {
      set.transport = patch.transport;
    }
    if (patch.config !== undefined) {
      set.config = encodeJsonOrNull(patch.config) ?? '{}';
    }

    if (Object.keys(set).length === 0) {
      return this.findById(id, orgId);
    }
    set.updated_at = nowFor(this.database);

    let query = this.database
      .kysely<AgentsDB>()
      .updateTable('agent_mcp_servers')
      .set(set as never)
      .where('id', '=', id);
    if (orgId !== undefined) {
      query =
        orgId === null ? query.where('org_id', 'is', null) : query.where('org_id', '=', orgId);
    }
    await query.execute();

    return this.findById(id, orgId);
  }

  async delete(id: string, orgId?: string | null): Promise<void> {
    let query = this.database
      .kysely<AgentsDB>()
      .deleteFrom('agent_mcp_servers')
      .where('id', '=', id);
    if (orgId !== undefined) {
      query =
        orgId === null ? query.where('org_id', 'is', null) : query.where('org_id', '=', orgId);
    }
    await query.execute();
  }
}
