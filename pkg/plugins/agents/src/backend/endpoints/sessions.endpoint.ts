/**
 * REST endpoints for `agent_sessions` + `agent_messages`.
 *
 * A session is a self-contained chat — provider, model, MCPs, tools all
 * inline. There is no agent_definitions table to look up first; sensible
 * defaults are filled in here so `POST /sessions {}` is enough to start
 * chatting.
 *
 * Routes:
 *
 *   GET    /sessions
 *   POST   /sessions                                    — create + provider.createSession
 *   GET    /sessions/:id                                — includes `doAgentName`
 *   PATCH  /sessions/:id                                — model / MCPs / tools / system prompt
 *   DELETE /sessions/:id                                — provider.closeSession + archive row
 *   GET    /sessions/:id/messages?before=<seq>&limit=50
 *   POST   /sessions/:id/prompt                         — 501 (use WebSocket)
 *   POST   /sessions/:id/interrupt
 */

import type { FlowlibPluginEndpoint, PluginEndpointResponse } from '@flowlib/core';
import type { PluginContext } from '../plugin-context';
import type { AgentProvider } from '../providers/types';
import type {
  AgentProviderId,
  AgentSession,
  AgentSessionStatus,
  AgentVisibility,
  ToolOutputBudget,
} from '../../shared/types';
import { tenantScopedName } from '../cloudflare/tenant-scoped-id';
import { badRequest, notFound, notImplemented, safeHandler, type EndpointDeps } from './helpers';

interface CreateSessionBody {
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
}

interface UpdateSessionBody {
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
}

function withDoAgentName(
  session: AgentSession,
  orgId: string,
): AgentSession & { doAgentName: string } {
  return {
    ...session,
    doAgentName: tenantScopedName('chat', orgId, session.id),
  };
}

function getProvider(pluginCtx: PluginContext, providerId: string): AgentProvider | undefined {
  return pluginCtx.registries.providers.get(providerId);
}

async function listSessions(deps: EndpointDeps): Promise<PluginEndpointResponse> {
  const rows = await deps.repos.sessions.list({ orgId: deps.auth.orgId });
  return {
    body: { data: rows.map((r) => withDoAgentName(r, deps.auth.orgId)) },
  };
}

async function getSession(deps: EndpointDeps): Promise<PluginEndpointResponse> {
  const id = deps.endpointCtx.params.id;
  const row = await deps.repos.sessions.findById(id, deps.auth.orgId);
  if (!row) {
    return notFound('Session not found');
  }
  return { body: withDoAgentName(row, deps.auth.orgId) };
}

/**
 * Create a new chat session. Body is optional — every field has a
 * sensible default so `POST /sessions {}` is enough to start chatting.
 *
 * Defaults:
 *   - providerId: pluginCtx.options.defaultProviderId ('claude-code')
 *   - model:      pluginCtx.options.defaultModel ('claude-sonnet-4-5')
 *   - workspace:  auto-created via the configured workspace provider
 *                 if the chosen provider declares `workspaceRequired`
 */
async function createSession(deps: EndpointDeps): Promise<PluginEndpointResponse> {
  const body = (deps.endpointCtx.body ?? {}) as CreateSessionBody;
  const opts = deps.pluginCtx.options;

  const providerId = body.providerId ?? (opts.defaultProviderId as AgentProviderId);
  const provider = getProvider(deps.pluginCtx, providerId);
  if (!provider) {
    return badRequest('Provider is not registered', { providerId });
  }

  // Auto-create or resolve a workspace if the provider requires one.
  let workspaceId = body.workspaceId ?? null;
  let workspace;
  if (provider.capabilities.workspaceRequired) {
    if (workspaceId) {
      const wsRow = await deps.repos.workspaces.findById(workspaceId, deps.auth.orgId);
      if (!wsRow) {
        return badRequest('Workspace not found', { workspaceId });
      }
      const wsProvider = opts.workspaceProvider;
      if (!wsProvider || wsProvider.id !== wsRow.workspaceProviderId) {
        return badRequest('Workspace provider not registered', {
          workspaceProviderId: wsRow.workspaceProviderId,
        });
      }
      try {
        workspace = await wsProvider.resolve(workspaceId, deps.auth);
      } catch (err) {
        return badRequest('Failed to resolve workspace', {
          message: err instanceof Error ? err.message : String(err),
        });
      }
    } else {
      const wsProvider = opts.workspaceProvider;
      if (!wsProvider) {
        return badRequest('Provider requires a workspace but no workspace provider is configured', {
          providerId,
        });
      }
      // Auto-provision a workspace row + resolve it.
      const ws = await deps.repos.workspaces.create({
        orgId: deps.auth.orgId,
        name: 'Chat workspace',
        workspaceProviderId: wsProvider.id,
        rootPath: null,
        gitRemote: null,
        gitBranch: null,
        sandboxConfig: null,
        projectId: null,
        createdBy: deps.auth.userId,
        visibility: 'private',
      });
      workspaceId = ws.id;
      try {
        workspace = await wsProvider.resolve(ws.id, deps.auth);
      } catch (err) {
        return badRequest('Failed to resolve auto-created workspace', {
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // Provider-side session create.
  let providerSessionId: string;
  try {
    const result = await provider.createSession({
      auth: deps.auth,
      config: body.providerConfig ?? {},
      workspace,
    });
    providerSessionId = result.providerSessionId;
  } catch (err) {
    return badRequest('Provider rejected session creation', {
      message: err instanceof Error ? err.message : String(err),
    });
  }

  const created = await deps.repos.sessions.create({
    orgId: deps.auth.orgId,
    providerSessionId,
    title: body.title ?? 'New chat',
    providerId,
    providerConfig: body.providerConfig ?? {},
    model: body.model ?? opts.defaultModel,
    permissionMode: body.permissionMode ?? null,
    systemPrompt: body.systemPrompt ?? null,
    workspaceId,
    enabledMcpServerIds: body.enabledMcpServerIds ?? [],
    enabledTools: body.enabledTools ?? null,
    denyList: body.denyList ?? null,
    exposeFlowlibActions: body.exposeFlowlibActions ?? opts.exposeFlowlibActions,
    toolOutputBudget: body.toolOutputBudget,
    createdBy: deps.auth.userId,
    visibility: body.visibility ?? 'private',
    status: 'active',
  });

  return { status: 201, body: withDoAgentName(created, deps.auth.orgId) };
}

async function updateSession(deps: EndpointDeps): Promise<PluginEndpointResponse> {
  const id = deps.endpointCtx.params.id;
  const existing = await deps.repos.sessions.findById(id, deps.auth.orgId);
  if (!existing) {
    return notFound('Session not found');
  }

  const body = (deps.endpointCtx.body ?? {}) as UpdateSessionBody;
  const updated = await deps.repos.sessions.update(
    id,
    {
      title: body.title,
      providerId: body.providerId,
      providerConfig: body.providerConfig,
      model: body.model,
      permissionMode: body.permissionMode,
      systemPrompt: body.systemPrompt,
      workspaceId: body.workspaceId,
      enabledMcpServerIds: body.enabledMcpServerIds,
      enabledTools: body.enabledTools,
      denyList: body.denyList,
      exposeFlowlibActions: body.exposeFlowlibActions,
      toolOutputBudget: body.toolOutputBudget,
      visibility: body.visibility,
      status: body.status,
    },
    deps.auth.orgId,
  );
  if (!updated) {
    return notFound('Session not found');
  }
  return { body: withDoAgentName(updated, deps.auth.orgId) };
}

async function deleteSession(deps: EndpointDeps): Promise<PluginEndpointResponse> {
  const id = deps.endpointCtx.params.id;
  const existing = await deps.repos.sessions.findById(id, deps.auth.orgId);
  if (!existing) {
    return notFound('Session not found');
  }

  // Best-effort: tear down the provider's side first; fall through to
  // archiving the row even if the provider call fails.
  const provider = getProvider(deps.pluginCtx, existing.providerId);
  if (provider?.closeSession) {
    try {
      await provider.closeSession(existing.providerSessionId);
    } catch (err) {
      deps.pluginCtx.logger.warn('[agents] provider.closeSession failed; archiving row anyway', {
        id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await deps.repos.sessions.update(id, { status: 'archived' }, deps.auth.orgId);
  return { body: { success: true, status: 'archived' } };
}

async function listMessages(deps: EndpointDeps): Promise<PluginEndpointResponse> {
  const id = deps.endpointCtx.params.id;
  const session = await deps.repos.sessions.findById(id, deps.auth.orgId);
  if (!session) {
    return notFound('Session not found');
  }

  const limitRaw = deps.endpointCtx.query.limit;
  const beforeRaw = deps.endpointCtx.query.before;
  const limit = limitRaw ? Math.max(1, Math.min(200, Number(limitRaw))) : 50;

  // The plan documents `before=<seq>` pagination, but the underlying
  // repository exposes `afterSequence` (sequence > N). For v1 the
  // simplest correct mapping is: list everything with sequence <
  // before, sort asc, take last `limit`. We do that with a wide
  // server-side fetch + JS slice, which is fine for v1 message
  // volumes; an indexed `<` query lands in a follow-up.
  const all = await deps.repos.messages.list({
    orgId: deps.auth.orgId,
    sessionId: id,
  });

  let scoped = all;
  if (beforeRaw && !Number.isNaN(Number(beforeRaw))) {
    const before = Number(beforeRaw);
    scoped = all.filter((m) => m.sequence < before);
  }
  const slice = scoped.slice(-limit);
  return {
    body: {
      data: slice,
      pagination: {
        before: beforeRaw ?? null,
        limit,
        nextBefore: slice[0]?.sequence ?? null,
      },
    },
  };
}

async function promptSession(deps: EndpointDeps): Promise<PluginEndpointResponse> {
  const id = deps.endpointCtx.params.id;
  const session = await deps.repos.sessions.findById(id, deps.auth.orgId);
  if (!session) {
    return notFound('Session not found');
  }

  return notImplemented(
    'HTTP prompt is not implemented in v1 — connect over WebSocket to the AgentChatDO instead',
    {
      transport: 'websocket',
      doAgentName: tenantScopedName('chat', deps.auth.orgId, session.id),
      doBinding: 'AgentChatDO',
    },
  );
}

async function interruptSession(deps: EndpointDeps): Promise<PluginEndpointResponse> {
  const id = deps.endpointCtx.params.id;
  const session = await deps.repos.sessions.findById(id, deps.auth.orgId);
  if (!session) {
    return notFound('Session not found');
  }

  const doClass = deps.pluginCtx.registries.cloudflareDoClass;
  if (!doClass) {
    return notImplemented(
      'Interrupt requires the Cloudflare DO runtime; not available in this deployment',
      {
        transport: 'websocket',
        doAgentName: tenantScopedName('chat', deps.auth.orgId, session.id),
      },
    );
  }

  return {
    body: {
      status: 'interrupt-requested',
      transport: 'websocket',
      doAgentName: tenantScopedName('chat', deps.auth.orgId, session.id),
      doBinding: 'AgentChatDO',
      message: { type: 'interrupt' },
    },
  };
}

export function createSessionsEndpoints(ctx: PluginContext): FlowlibPluginEndpoint[] {
  return [
    {
      method: 'GET',
      path: '/sessions',
      handler: safeHandler(ctx, listSessions),
    },
    {
      method: 'POST',
      path: '/sessions',
      handler: safeHandler(ctx, createSession),
    },
    {
      method: 'GET',
      path: '/sessions/:id',
      handler: safeHandler(ctx, getSession),
    },
    {
      method: 'PATCH',
      path: '/sessions/:id',
      handler: safeHandler(ctx, updateSession),
    },
    {
      method: 'DELETE',
      path: '/sessions/:id',
      handler: safeHandler(ctx, deleteSession),
    },
    {
      method: 'GET',
      path: '/sessions/:id/messages',
      handler: safeHandler(ctx, listMessages),
    },
    {
      method: 'POST',
      path: '/sessions/:id/prompt',
      handler: safeHandler(ctx, promptSession),
    },
    {
      method: 'POST',
      path: '/sessions/:id/interrupt',
      handler: safeHandler(ctx, interruptSession),
    },
  ];
}
