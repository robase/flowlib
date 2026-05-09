/**
 * Persistence for `agent_definitions`.
 *
 * Tenant scoped: every read filters by `orgId` when supplied; every write
 * sets the value on insert. v1 follows the webhooks repository as a
 * reference (`pkg/plugins/webhooks/src/backend/webhook-triggers.repository.ts`).
 */

import type { PluginDatabaseApi } from '@flowlib/core';
import type {
  AgentDefinition,
  AgentProviderId,
  AgentVisibility,
  ToolOutputBudget,
} from '../../shared/types';
import type { AgentsDB } from './db-types';
import {
  boolFor,
  encodeJson,
  encodeJsonOrNull,
  generateId,
  nowFor,
  parseJson,
  parseJsonOrNull,
  toBool,
  toIso,
} from './util';

const DEFAULT_TOOL_OUTPUT_BUDGET: ToolOutputBudget = { lines: 100, bytes: 4096 };

interface AgentDefinitionRow {
  id: string;
  org_id: string | null;
  name: string;
  description: string | null;
  provider_id: string;
  provider_config: unknown;
  workspace_id: string | null;
  persona_id: string | null;
  persona_text: string | null;
  default_model: string | null;
  mcp_servers: unknown;
  enabled_tools: unknown;
  deny_list: unknown;
  expose_flowlib_actions: 0 | 1 | boolean;
  tool_output_budget: unknown;
  created_by: string;
  visibility: string;
  created_at: string | Date;
  updated_at: string | Date;
}

export interface CreateAgentInput {
  /** Optional caller-supplied id; auto-generated when absent. */
  id?: string;
  orgId: string | null;
  name: string;
  description?: string | null;
  providerId: AgentProviderId;
  providerConfig?: Record<string, unknown>;
  workspaceId?: string | null;
  personaId?: string | null;
  personaText?: string | null;
  defaultModel?: string | null;
  mcpServers?: Record<string, unknown>;
  enabledTools?: string[] | null;
  denyList?: string[] | null;
  exposeFlowlibActions?: boolean;
  toolOutputBudget?: ToolOutputBudget;
  createdBy: string;
  visibility?: AgentVisibility;
}

export interface UpdateAgentInput {
  name?: string;
  description?: string | null;
  providerId?: AgentProviderId;
  providerConfig?: Record<string, unknown>;
  workspaceId?: string | null;
  personaId?: string | null;
  personaText?: string | null;
  defaultModel?: string | null;
  mcpServers?: Record<string, unknown>;
  enabledTools?: string[] | null;
  denyList?: string[] | null;
  exposeFlowlibActions?: boolean;
  toolOutputBudget?: ToolOutputBudget;
  visibility?: AgentVisibility;
}

export interface ListAgentsFilter {
  orgId?: string | null;
  providerId?: string;
  createdBy?: string;
  visibility?: AgentVisibility;
  workspaceId?: string;
  limit?: number;
  offset?: number;
}

function mapRow(row: AgentDefinitionRow): AgentDefinition {
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    description: row.description,
    providerId: row.provider_id as AgentProviderId,
    providerConfig: parseJson<Record<string, unknown>>(row.provider_config, {}),
    workspaceId: row.workspace_id,
    personaId: row.persona_id,
    personaText: row.persona_text,
    defaultModel: row.default_model,
    mcpServers: parseJson<Record<string, unknown>>(row.mcp_servers, {}),
    enabledTools: parseJsonOrNull<string[]>(row.enabled_tools),
    denyList: parseJsonOrNull<string[]>(row.deny_list),
    exposeFlowlibActions: toBool(row.expose_flowlib_actions),
    toolOutputBudget: parseJson<ToolOutputBudget>(
      row.tool_output_budget,
      DEFAULT_TOOL_OUTPUT_BUDGET,
    ),
    createdBy: row.created_by,
    visibility: row.visibility as AgentVisibility,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export class AgentsRepository {
  constructor(private readonly database: PluginDatabaseApi) {}

  async findById(id: string, orgId?: string | null): Promise<AgentDefinition | null> {
    let query = this.database
      .kysely<AgentsDB>()
      .selectFrom('agent_definitions')
      .selectAll()
      .where('id', '=', id);
    if (orgId !== undefined) {
      query = orgId === null
        ? query.where('org_id', 'is', null)
        : query.where('org_id', '=', orgId);
    }
    const row = await query.limit(1).executeTakeFirst();
    return row ? mapRow(row as unknown as AgentDefinitionRow) : null;
  }

  async list(filter: ListAgentsFilter = {}): Promise<AgentDefinition[]> {
    let query = this.database.kysely<AgentsDB>().selectFrom('agent_definitions').selectAll();
    if (filter.orgId !== undefined) {
      query = filter.orgId === null
        ? query.where('org_id', 'is', null)
        : query.where('org_id', '=', filter.orgId);
    }
    if (filter.providerId !== undefined) {
      query = query.where('provider_id', '=', filter.providerId);
    }
    if (filter.createdBy !== undefined) {
      query = query.where('created_by', '=', filter.createdBy);
    }
    if (filter.visibility !== undefined) {
      query = query.where('visibility', '=', filter.visibility);
    }
    if (filter.workspaceId !== undefined) {
      query = query.where('workspace_id', '=', filter.workspaceId);
    }
    query = query.orderBy('created_at', 'desc');
    if (filter.limit !== undefined) {
      query = query.limit(filter.limit);
    }
    if (filter.offset !== undefined) {
      query = query.offset(filter.offset);
    }
    const rows = await query.execute();
    return rows.map((row) => mapRow(row as unknown as AgentDefinitionRow));
  }

  async create(input: CreateAgentInput): Promise<AgentDefinition> {
    const id = input.id ?? generateId();
    const now = nowFor(this.database);

    await this.database
      .kysely<AgentsDB>()
      .insertInto('agent_definitions')
      .values({
        id,
        org_id: input.orgId,
        name: input.name,
        description: input.description ?? null,
        provider_id: input.providerId,
        provider_config: encodeJson(input.providerConfig ?? {}),
        workspace_id: input.workspaceId ?? null,
        persona_id: input.personaId ?? null,
        persona_text: input.personaText ?? null,
        default_model: input.defaultModel ?? null,
        mcp_servers: encodeJson(input.mcpServers ?? {}),
        enabled_tools: encodeJsonOrNull(input.enabledTools ?? null),
        deny_list: encodeJsonOrNull(input.denyList ?? null),
        expose_flowlib_actions: boolFor(this.database, input.exposeFlowlibActions ?? false),
        tool_output_budget: encodeJson(input.toolOutputBudget ?? DEFAULT_TOOL_OUTPUT_BUDGET),
        created_by: input.createdBy,
        visibility: input.visibility ?? 'private',
        created_at: now,
        updated_at: now,
      } as never)
      .execute();

    const created = await this.findById(id, input.orgId);
    if (!created) {
      throw new Error('Failed to load created agent definition');
    }
    return created;
  }

  async update(
    id: string,
    patch: UpdateAgentInput,
    orgId?: string | null,
  ): Promise<AgentDefinition | null> {
    const set: Record<string, unknown> = {};
    if (patch.name !== undefined) {set.name = patch.name;}
    if (patch.description !== undefined) {set.description = patch.description;}
    if (patch.providerId !== undefined) {set.provider_id = patch.providerId;}
    if (patch.providerConfig !== undefined) {
      set.provider_config = encodeJson(patch.providerConfig);
    }
    if (patch.workspaceId !== undefined) {set.workspace_id = patch.workspaceId;}
    if (patch.personaId !== undefined) {set.persona_id = patch.personaId;}
    if (patch.personaText !== undefined) {set.persona_text = patch.personaText;}
    if (patch.defaultModel !== undefined) {set.default_model = patch.defaultModel;}
    if (patch.mcpServers !== undefined) {set.mcp_servers = encodeJson(patch.mcpServers);}
    if (patch.enabledTools !== undefined) {
      set.enabled_tools = encodeJsonOrNull(patch.enabledTools);
    }
    if (patch.denyList !== undefined) {
      set.deny_list = encodeJsonOrNull(patch.denyList);
    }
    if (patch.exposeFlowlibActions !== undefined) {
      set.expose_flowlib_actions = boolFor(this.database, patch.exposeFlowlibActions);
    }
    if (patch.toolOutputBudget !== undefined) {
      set.tool_output_budget = encodeJson(patch.toolOutputBudget);
    }
    if (patch.visibility !== undefined) {set.visibility = patch.visibility;}

    if (Object.keys(set).length === 0) {
      return this.findById(id, orgId);
    }
    set.updated_at = nowFor(this.database);

    let query = this.database
      .kysely<AgentsDB>()
      .updateTable('agent_definitions')
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
      .deleteFrom('agent_definitions')
      .where('id', '=', id);
    if (orgId !== undefined) {
      query = orgId === null
        ? query.where('org_id', 'is', null)
        : query.where('org_id', '=', orgId);
    }
    await query.execute();
  }
}
