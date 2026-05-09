/**
 * REST endpoints for `agent_definitions`.
 *
 * Routes (under the agents plugin's mount path):
 *
 *   GET    /agents
 *   POST   /agents
 *   GET    /agents/:id
 *   PATCH  /agents/:id
 *   DELETE /agents/:id
 *
 * Tenant-scoped: every read filters by `orgId`; cross-tenant access
 * returns 404 (not 403). On `POST` the provider id is validated
 * against `ctx.registries.providers` and the provider's
 * `validateConfig()` is invoked before persisting.
 */

import type {
  FlowlibPluginEndpoint,
  PluginEndpointResponse,
} from '@flowlib/core';
import type { PluginContext } from '../plugin-context';
import type { AgentProvider } from '../providers/types';
import type {
  AgentDefinition,
  AgentProviderId,
  AgentVisibility,
  ToolOutputBudget,
} from '../../shared/types';
import {
  badRequest,
  notFound,
  safeHandler,
  type EndpointDeps,
} from './helpers';

interface CreateAgentBody {
  name?: string;
  description?: string | null;
  providerId?: string;
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

interface UpdateAgentBody extends Omit<CreateAgentBody, 'providerId'> {
  providerId?: string;
}

function lookupProvider(
  pluginCtx: PluginContext,
  providerId: string,
): AgentProvider | undefined {
  return pluginCtx.registries.providers.get(providerId);
}

async function listAgents(deps: EndpointDeps): Promise<PluginEndpointResponse> {
  const rows = await deps.repos.agents.list({ orgId: deps.auth.orgId });
  return { body: { data: rows } };
}

async function getAgent(deps: EndpointDeps): Promise<PluginEndpointResponse> {
  const id = deps.endpointCtx.params.id;
  const row = await deps.repos.agents.findById(id, deps.auth.orgId);
  if (!row) return notFound('Agent not found');
  return { body: row };
}

async function createAgent(
  deps: EndpointDeps,
): Promise<PluginEndpointResponse> {
  const body = (deps.endpointCtx.body ?? {}) as CreateAgentBody;
  if (!body.name || typeof body.name !== 'string') {
    return badRequest('name is required');
  }
  if (!body.providerId || typeof body.providerId !== 'string') {
    return badRequest('providerId is required');
  }

  const provider = lookupProvider(deps.pluginCtx, body.providerId);
  if (!provider) {
    return badRequest('Unknown providerId', {
      providerId: body.providerId,
      available: Array.from(deps.pluginCtx.registries.providers.keys()),
    });
  }

  let validatedConfig: Record<string, unknown>;
  try {
    validatedConfig = provider.validateConfig(body.providerConfig ?? {});
  } catch (err) {
    return badRequest('Invalid providerConfig', {
      message: err instanceof Error ? err.message : String(err),
    });
  }

  const created = await deps.repos.agents.create({
    orgId: deps.auth.orgId,
    name: body.name,
    description: body.description ?? null,
    providerId: body.providerId as AgentProviderId,
    providerConfig: validatedConfig,
    workspaceId: body.workspaceId ?? null,
    personaId: body.personaId ?? null,
    personaText: body.personaText ?? null,
    defaultModel: body.defaultModel ?? null,
    mcpServers: body.mcpServers ?? {},
    enabledTools: body.enabledTools ?? null,
    denyList: body.denyList ?? null,
    exposeFlowlibActions:
      body.exposeFlowlibActions ?? deps.pluginCtx.options.exposeFlowlibActions,
    toolOutputBudget: body.toolOutputBudget,
    createdBy: deps.auth.userId,
    visibility: body.visibility ?? 'private',
  });

  return { status: 201, body: created };
}

async function updateAgent(
  deps: EndpointDeps,
): Promise<PluginEndpointResponse> {
  const id = deps.endpointCtx.params.id;
  const existing = await deps.repos.agents.findById(id, deps.auth.orgId);
  if (!existing) return notFound('Agent not found');

  const body = (deps.endpointCtx.body ?? {}) as UpdateAgentBody;

  let validatedConfig: Record<string, unknown> | undefined;
  if (body.providerConfig !== undefined || body.providerId !== undefined) {
    const providerId = (body.providerId ?? existing.providerId) as string;
    const provider = lookupProvider(deps.pluginCtx, providerId);
    if (!provider) {
      return badRequest('Unknown providerId', { providerId });
    }
    if (body.providerConfig !== undefined) {
      try {
        validatedConfig = provider.validateConfig(body.providerConfig);
      } catch (err) {
        return badRequest('Invalid providerConfig', {
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  const updated = await deps.repos.agents.update(
    id,
    {
      name: body.name,
      description: body.description,
      providerId: body.providerId as AgentProviderId | undefined,
      providerConfig: validatedConfig,
      workspaceId: body.workspaceId,
      personaId: body.personaId,
      personaText: body.personaText,
      defaultModel: body.defaultModel,
      mcpServers: body.mcpServers,
      enabledTools: body.enabledTools,
      denyList: body.denyList,
      exposeFlowlibActions: body.exposeFlowlibActions,
      toolOutputBudget: body.toolOutputBudget,
      visibility: body.visibility,
    },
    deps.auth.orgId,
  );

  if (!updated) return notFound('Agent not found');
  return { body: updated as AgentDefinition };
}

async function deleteAgent(
  deps: EndpointDeps,
): Promise<PluginEndpointResponse> {
  const id = deps.endpointCtx.params.id;
  const existing = await deps.repos.agents.findById(id, deps.auth.orgId);
  if (!existing) return notFound('Agent not found');
  await deps.repos.agents.delete(id, deps.auth.orgId);
  return { body: { success: true } };
}

export function createAgentsEndpoints(
  ctx: PluginContext,
): FlowlibPluginEndpoint[] {
  return [
    {
      method: 'GET',
      path: '/agents',
      handler: safeHandler(ctx, listAgents),
    },
    {
      method: 'POST',
      path: '/agents',
      handler: safeHandler(ctx, createAgent),
    },
    {
      method: 'GET',
      path: '/agents/:id',
      handler: safeHandler(ctx, getAgent),
    },
    {
      method: 'PATCH',
      path: '/agents/:id',
      handler: safeHandler(ctx, updateAgent),
    },
    {
      method: 'DELETE',
      path: '/agents/:id',
      handler: safeHandler(ctx, deleteAgent),
    },
  ];
}
