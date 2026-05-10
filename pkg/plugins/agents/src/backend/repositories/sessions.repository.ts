/**
 * Persistence for `agent_sessions`.
 *
 * A session carries its own provider / model / MCP / tool config — no
 * separate agent_definitions table. `create()` callers fill in the
 * config they want; the endpoint layer applies defaults when the API
 * caller omits fields.
 */

import type { PluginDatabaseApi } from '@flowlib/core';
import type {
  AgentProviderId,
  AgentSession,
  AgentSessionStatus,
  AgentVisibility,
  ToolOutputBudget,
} from '../../shared/types';
import type { AgentsDB } from './db-types';
import { encodeJsonOrNull, generateId, nowFor, parseJsonOrNull, toIso, toIsoOrNull } from './util';

interface AgentSessionRow {
  id: string;
  org_id: string | null;
  provider_session_id: string;
  title: string;
  provider_id: string;
  provider_config: unknown;
  model: string | null;
  permission_mode: string | null;
  system_prompt: string | null;
  workspace_id: string | null;
  enabled_mcp_server_ids: unknown;
  enabled_tools: unknown;
  deny_list: unknown;
  expose_flowlib_actions: number | boolean;
  tool_output_budget: unknown;
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

const DEFAULT_TOOL_OUTPUT_BUDGET: ToolOutputBudget = { lines: 100, bytes: 4096 };

export interface CreateSessionInput {
  id?: string;
  orgId: string | null;
  providerSessionId: string;
  title?: string;
  providerId: AgentProviderId;
  providerConfig?: Record<string, unknown>;
  model?: string | null;
  permissionMode?: string | null;
  systemPrompt?: string | null;
  workspaceId?: string | null;
  enabledMcpServerIds?: string[];
  enabledTools?: string[] | null;
  denyList?: string[] | null;
  exposeFlowlibActions?: boolean;
  toolOutputBudget?: ToolOutputBudget;
  createdBy: string;
  visibility?: AgentVisibility;
  status?: AgentSessionStatus;
}

export interface UpdateSessionInput {
  title?: string;
  providerId?: AgentProviderId;
  providerConfig?: Record<string, unknown>;
  model?: string | null;
  permissionMode?: string | null;
  systemPrompt?: string | null;
  workspaceId?: string | null;
  enabledMcpServerIds?: string[];
  enabledTools?: string[] | null;
  denyList?: string[] | null;
  exposeFlowlibActions?: boolean;
  toolOutputBudget?: ToolOutputBudget;
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
    providerSessionId: row.provider_session_id,
    title: row.title,
    providerId: row.provider_id as AgentProviderId,
    providerConfig: parseJsonOrNull<Record<string, unknown>>(row.provider_config) ?? {},
    model: row.model,
    permissionMode: row.permission_mode,
    systemPrompt: row.system_prompt,
    workspaceId: row.workspace_id,
    enabledMcpServerIds: parseJsonOrNull<string[]>(row.enabled_mcp_server_ids) ?? [],
    enabledTools: parseJsonOrNull<string[]>(row.enabled_tools),
    denyList: parseJsonOrNull<string[]>(row.deny_list),
    exposeFlowlibActions: Boolean(row.expose_flowlib_actions),
    toolOutputBudget:
      parseJsonOrNull<ToolOutputBudget>(row.tool_output_budget) ?? DEFAULT_TOOL_OUTPUT_BUDGET,
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
      query =
        orgId === null ? query.where('org_id', 'is', null) : query.where('org_id', '=', orgId);
    }
    const row = await query.limit(1).executeTakeFirst();
    return row ? mapRow(row as unknown as AgentSessionRow) : null;
  }

  async list(filter: ListSessionsFilter = {}): Promise<AgentSession[]> {
    let query = this.database.kysely<AgentsDB>().selectFrom('agent_sessions').selectAll();
    if (filter.orgId !== undefined) {
      query =
        filter.orgId === null
          ? query.where('org_id', 'is', null)
          : query.where('org_id', '=', filter.orgId);
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
        provider_session_id: input.providerSessionId,
        title: input.title ?? 'New chat',
        provider_id: input.providerId,
        provider_config: encodeJsonOrNull(input.providerConfig ?? {}) ?? '{}',
        model: input.model ?? null,
        permission_mode: input.permissionMode ?? null,
        system_prompt: input.systemPrompt ?? null,
        workspace_id: input.workspaceId ?? null,
        enabled_mcp_server_ids: encodeJsonOrNull(input.enabledMcpServerIds ?? []) ?? '[]',
        enabled_tools: encodeJsonOrNull(input.enabledTools ?? null),
        deny_list: encodeJsonOrNull(input.denyList ?? null),
        expose_flowlib_actions: input.exposeFlowlibActions ?? false,
        tool_output_budget:
          encodeJsonOrNull(input.toolOutputBudget ?? DEFAULT_TOOL_OUTPUT_BUDGET) ??
          JSON.stringify(DEFAULT_TOOL_OUTPUT_BUDGET),
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
    if (patch.title !== undefined) {
      set.title = patch.title;
    }
    if (patch.providerId !== undefined) {
      set.provider_id = patch.providerId;
    }
    if (patch.providerConfig !== undefined) {
      set.provider_config = encodeJsonOrNull(patch.providerConfig) ?? '{}';
    }
    if (patch.model !== undefined) {
      set.model = patch.model;
    }
    if (patch.permissionMode !== undefined) {
      set.permission_mode = patch.permissionMode;
    }
    if (patch.systemPrompt !== undefined) {
      set.system_prompt = patch.systemPrompt;
    }
    if (patch.workspaceId !== undefined) {
      set.workspace_id = patch.workspaceId;
    }
    if (patch.enabledMcpServerIds !== undefined) {
      set.enabled_mcp_server_ids = encodeJsonOrNull(patch.enabledMcpServerIds) ?? '[]';
    }
    if (patch.enabledTools !== undefined) {
      set.enabled_tools = encodeJsonOrNull(patch.enabledTools);
    }
    if (patch.denyList !== undefined) {
      set.deny_list = encodeJsonOrNull(patch.denyList);
    }
    if (patch.exposeFlowlibActions !== undefined) {
      set.expose_flowlib_actions = patch.exposeFlowlibActions;
    }
    if (patch.toolOutputBudget !== undefined) {
      set.tool_output_budget = encodeJsonOrNull(patch.toolOutputBudget);
    }
    if (patch.visibility !== undefined) {
      set.visibility = patch.visibility;
    }
    if (patch.status !== undefined) {
      set.status = patch.status;
    }
    if (patch.lastMessageAt !== undefined) {
      set.last_message_at =
        patch.lastMessageAt === null
          ? null
          : patch.lastMessageAt instanceof Date
            ? this.database.type === 'sqlite'
              ? patch.lastMessageAt.toISOString()
              : patch.lastMessageAt
            : patch.lastMessageAt;
    }
    if (patch.messageCount !== undefined) {
      set.message_count = patch.messageCount;
    }
    if (patch.inputTokensTotal !== undefined) {
      set.input_tokens_total = patch.inputTokensTotal;
    }
    if (patch.outputTokensTotal !== undefined) {
      set.output_tokens_total = patch.outputTokensTotal;
    }
    if (patch.costUsd !== undefined) {
      set.cost_usd = patch.costUsd;
    }

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
      query =
        orgId === null ? query.where('org_id', 'is', null) : query.where('org_id', '=', orgId);
    }
    await query.execute();

    return this.findById(id, orgId);
  }

  async delete(id: string, orgId?: string | null): Promise<void> {
    let query = this.database.kysely<AgentsDB>().deleteFrom('agent_sessions').where('id', '=', id);
    if (orgId !== undefined) {
      query =
        orgId === null ? query.where('org_id', 'is', null) : query.where('org_id', '=', orgId);
    }
    await query.execute();
  }
}
