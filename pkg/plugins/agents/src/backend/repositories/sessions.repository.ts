/**
 * Persistence for `agent_sessions`.
 *
 * Tenant scoped. v1 follows the webhooks repository pattern.
 */

import type { PluginDatabaseApi } from '@flowlib/core';
import type { AgentSession, AgentSessionStatus, AgentVisibility } from '../../shared/types';
import type { AgentsDB } from './db-types';
import {
  encodeJsonOrNull,
  generateId,
  nowFor,
  parseJsonOrNull,
  toIso,
  toIsoOrNull,
} from './util';

interface AgentSessionRow {
  id: string;
  org_id: string | null;
  agent_id: string;
  provider_session_id: string;
  title: string;
  model: string | null;
  permission_mode: string | null;
  workspace_id: string | null;
  enabled_tools: unknown;
  extra_denied: unknown;
  created_by: string;
  visibility: string;
  status: string;
  last_message_at: string | Date | null;
  message_count: number;
  input_tokens_total: number;
  output_tokens_total: number;
  cost_usd: string;
  created_at: string | Date;
  updated_at: string | Date;
}

export interface CreateSessionInput {
  id?: string;
  orgId: string | null;
  agentId: string;
  providerSessionId: string;
  title?: string;
  model?: string | null;
  permissionMode?: string | null;
  workspaceId?: string | null;
  enabledTools?: string[] | null;
  extraDenied?: string[] | null;
  createdBy: string;
  visibility?: AgentVisibility;
  status?: AgentSessionStatus;
}

export interface UpdateSessionInput {
  title?: string;
  model?: string | null;
  permissionMode?: string | null;
  workspaceId?: string | null;
  enabledTools?: string[] | null;
  extraDenied?: string[] | null;
  visibility?: AgentVisibility;
  status?: AgentSessionStatus;
  /** Bumped when a new message is appended. */
  lastMessageAt?: string | Date | null;
  messageCount?: number;
  inputTokensTotal?: number;
  outputTokensTotal?: number;
  costUsd?: string;
}

export interface ListSessionsFilter {
  orgId?: string | null;
  agentId?: string;
  createdBy?: string;
  status?: AgentSessionStatus;
  workspaceId?: string;
  limit?: number;
  offset?: number;
}

function mapRow(row: AgentSessionRow): AgentSession {
  return {
    id: row.id,
    orgId: row.org_id,
    agentId: row.agent_id,
    providerSessionId: row.provider_session_id,
    title: row.title,
    model: row.model,
    permissionMode: row.permission_mode,
    workspaceId: row.workspace_id,
    enabledTools: parseJsonOrNull<string[]>(row.enabled_tools),
    extraDenied: parseJsonOrNull<string[]>(row.extra_denied),
    createdBy: row.created_by,
    visibility: row.visibility as AgentVisibility,
    status: row.status as AgentSessionStatus,
    lastMessageAt: toIsoOrNull(row.last_message_at),
    messageCount: row.message_count,
    inputTokensTotal: row.input_tokens_total,
    outputTokensTotal: row.output_tokens_total,
    costUsd: row.cost_usd,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export class SessionsRepository {
  constructor(private readonly database: PluginDatabaseApi) {}

  async findById(id: string, orgId?: string | null): Promise<AgentSession | null> {
    let query = this.database
      .kysely<AgentsDB>()
      .selectFrom('agent_sessions')
      .selectAll()
      .where('id', '=', id);
    if (orgId !== undefined) {
      query = orgId === null
        ? query.where('org_id', 'is', null)
        : query.where('org_id', '=', orgId);
    }
    const row = await query.limit(1).executeTakeFirst();
    return row ? mapRow(row as unknown as AgentSessionRow) : null;
  }

  async list(filter: ListSessionsFilter = {}): Promise<AgentSession[]> {
    let query = this.database.kysely<AgentsDB>().selectFrom('agent_sessions').selectAll();
    if (filter.orgId !== undefined) {
      query = filter.orgId === null
        ? query.where('org_id', 'is', null)
        : query.where('org_id', '=', filter.orgId);
    }
    if (filter.agentId !== undefined) {
      query = query.where('agent_id', '=', filter.agentId);
    }
    if (filter.createdBy !== undefined) {
      query = query.where('created_by', '=', filter.createdBy);
    }
    if (filter.status !== undefined) {
      query = query.where('status', '=', filter.status);
    }
    if (filter.workspaceId !== undefined) {
      query = query.where('workspace_id', '=', filter.workspaceId);
    }
    query = query.orderBy('updated_at', 'desc');
    if (filter.limit !== undefined) {
      query = query.limit(filter.limit);
    }
    if (filter.offset !== undefined) {
      query = query.offset(filter.offset);
    }
    const rows = await query.execute();
    return rows.map((row) => mapRow(row as unknown as AgentSessionRow));
  }

  async create(input: CreateSessionInput): Promise<AgentSession> {
    const id = input.id ?? generateId();
    const now = nowFor(this.database);

    await this.database
      .kysely<AgentsDB>()
      .insertInto('agent_sessions')
      .values({
        id,
        org_id: input.orgId,
        agent_id: input.agentId,
        provider_session_id: input.providerSessionId,
        title: input.title ?? 'New chat',
        model: input.model ?? null,
        permission_mode: input.permissionMode ?? null,
        workspace_id: input.workspaceId ?? null,
        enabled_tools: encodeJsonOrNull(input.enabledTools ?? null),
        extra_denied: encodeJsonOrNull(input.extraDenied ?? null),
        created_by: input.createdBy,
        visibility: input.visibility ?? 'private',
        status: input.status ?? 'active',
        last_message_at: null,
        message_count: 0,
        input_tokens_total: 0,
        output_tokens_total: 0,
        cost_usd: '0',
        created_at: now,
        updated_at: now,
      } as never)
      .execute();

    const created = await this.findById(id, input.orgId);
    if (!created) {
      throw new Error('Failed to load created agent session');
    }
    return created;
  }

  async update(
    id: string,
    patch: UpdateSessionInput,
    orgId?: string | null,
  ): Promise<AgentSession | null> {
    const set: Record<string, unknown> = {};
    if (patch.title !== undefined) set.title = patch.title;
    if (patch.model !== undefined) set.model = patch.model;
    if (patch.permissionMode !== undefined) set.permission_mode = patch.permissionMode;
    if (patch.workspaceId !== undefined) set.workspace_id = patch.workspaceId;
    if (patch.enabledTools !== undefined) {
      set.enabled_tools = encodeJsonOrNull(patch.enabledTools);
    }
    if (patch.extraDenied !== undefined) {
      set.extra_denied = encodeJsonOrNull(patch.extraDenied);
    }
    if (patch.visibility !== undefined) set.visibility = patch.visibility;
    if (patch.status !== undefined) set.status = patch.status;
    if (patch.lastMessageAt !== undefined) {
      set.last_message_at = patch.lastMessageAt === null
        ? null
        : patch.lastMessageAt instanceof Date
          ? (this.database.type === 'sqlite' ? patch.lastMessageAt.toISOString() : patch.lastMessageAt)
          : patch.lastMessageAt;
    }
    if (patch.messageCount !== undefined) set.message_count = patch.messageCount;
    if (patch.inputTokensTotal !== undefined) set.input_tokens_total = patch.inputTokensTotal;
    if (patch.outputTokensTotal !== undefined) set.output_tokens_total = patch.outputTokensTotal;
    if (patch.costUsd !== undefined) set.cost_usd = patch.costUsd;

    if (Object.keys(set).length === 0) {
      return this.findById(id, orgId);
    }
    set.updated_at = nowFor(this.database);

    let query = this.database
      .kysely<AgentsDB>()
      .updateTable('agent_sessions')
      .set(set as never)
      .where('id', '=', id);
    if (orgId !== undefined) {
      query = orgId === null
        ? query.where('org_id', 'is', null)
        : query.where('org_id', '=', orgId);
    }
    await query.execute();

    return this.findById(id, orgId);
  }

  async delete(id: string, orgId?: string | null): Promise<void> {
    let query = this.database
      .kysely<AgentsDB>()
      .deleteFrom('agent_sessions')
      .where('id', '=', id);
    if (orgId !== undefined) {
      query = orgId === null
        ? query.where('org_id', 'is', null)
        : query.where('org_id', '=', orgId);
    }
    await query.execute();
  }
}
