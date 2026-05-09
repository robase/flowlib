/**
 * REST endpoints for `agent_sessions` + `agent_messages`.
 *
 * Routes:
 *
 *   GET    /sessions
 *   POST   /sessions                                    — create + provider.createSession
 *   GET    /sessions/:id                                — includes `doAgentName`
 *   PATCH  /sessions/:id                                — rename, visibility, archive
 *   DELETE /sessions/:id                                — provider.closeSession + archive row
 *   GET    /sessions/:id/messages?before=<seq>&limit=50
 *   POST   /sessions/:id/prompt                         — 501 (use WebSocket)
 *   POST   /sessions/:id/interrupt
 *
 * v1 prompts go via WebSocket through the Cloudflare Durable Object;
 * the HTTP `prompt` endpoint exists as a placeholder so the surface
 * stays forward-compatible with the deferred Express SSE deployment.
 *
 * Session responses include `doAgentName` — the tenant-scoped DO name
 * the frontend hands to `useAgent({ agent: 'AgentChatDO', name })`.
 */

import type {
  FlowlibPluginEndpoint,
  PluginEndpointResponse,
} from '@flowlib/core';
import type { PluginContext } from '../plugin-context';
import type { AgentProvider } from '../providers/types';
import type {
  AgentSession,
  AgentSessionStatus,
  AgentVisibility,
} from '../../shared/types';
import { tenantScopedName } from '../cloudflare/tenant-scoped-id';
import {
  badRequest,
  notFound,
  notImplemented,
  safeHandler,
  type EndpointDeps,
} from './helpers';

interface CreateSessionBody {
  agentId?: string;
  title?: string;
  model?: string | null;
  permissionMode?: string | null;
  workspaceId?: string | null;
  enabledTools?: string[] | null;
  extraDenied?: string[] | null;
  visibility?: AgentVisibility;
}

interface UpdateSessionBody {
  title?: string;
  model?: string | null;
  permissionMode?: string | null;
  workspaceId?: string | null;
  enabledTools?: string[] | null;
  extraDenied?: string[] | null;
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

function getProvider(
  pluginCtx: PluginContext,
  providerId: string,
): AgentProvider | undefined {
  return pluginCtx.registries.providers.get(providerId);
}

async function listSessions(
  deps: EndpointDeps,
): Promise<PluginEndpointResponse> {
  const rows = await deps.repos.sessions.list({ orgId: deps.auth.orgId });
  return {
    body: { data: rows.map((r) => withDoAgentName(r, deps.auth.orgId)) },
  };
}

async function getSession(
  deps: EndpointDeps,
): Promise<PluginEndpointResponse> {
  const id = deps.endpointCtx.params.id;
  const row = await deps.repos.sessions.findById(id, deps.auth.orgId);
  if (!row) return notFound('Session not found');
  return { body: withDoAgentName(row, deps.auth.orgId) };
}

async function createSession(
  deps: EndpointDeps,
): Promise<PluginEndpointResponse> {
  const body = (deps.endpointCtx.body ?? {}) as CreateSessionBody;
  if (!body.agentId || typeof body.agentId !== 'string') {
    return badRequest('agentId is required');
  }

  // Look up the agent (tenant-scoped — different-org agents 404).
  const agent = await deps.repos.agents.findById(body.agentId, deps.auth.orgId);
  if (!agent) return notFound('Agent not found');

  const provider = getProvider(deps.pluginCtx, agent.providerId);
  if (!provider) {
    return badRequest('Agent provider is not registered', {
      providerId: agent.providerId,
    });
  }

  // Provider workspace lookup (if required).
  let workspace;
  if (provider.capabilities.workspaceRequired) {
    if (!agent.workspaceId) {
      return badRequest('Agent requires a workspace but has none configured');
    }
    const wsRow = await deps.repos.workspaces.findById(
      agent.workspaceId,
      deps.auth.orgId,
    );
    if (!wsRow) {
      return badRequest('Agent workspace not found', {
        workspaceId: agent.workspaceId,
      });
    }
    const wsProvider = deps.pluginCtx.options.workspaceProvider;
    if (!wsProvider || wsProvider.id !== wsRow.workspaceProviderId) {
      return badRequest('Workspace provider not registered', {
        workspaceProviderId: wsRow.workspaceProviderId,
      });
    }
    try {
      workspace = await wsProvider.resolve(agent.workspaceId, deps.auth);
    } catch (err) {
      return badRequest('Failed to resolve workspace', {
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Provider-side session create.
  let providerSessionId: string;
  try {
    const result = await provider.createSession({
      auth: deps.auth,
      config: agent.providerConfig,
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
    agentId: agent.id,
    providerSessionId,
    title: body.title ?? 'New chat',
    model: body.model ?? agent.defaultModel,
    permissionMode: body.permissionMode ?? null,
    workspaceId: agent.workspaceId,
    enabledTools: body.enabledTools ?? null,
    extraDenied: body.extraDenied ?? null,
    createdBy: deps.auth.userId,
    visibility: body.visibility ?? 'private',
    status: 'active',
  });

  return { status: 201, body: withDoAgentName(created, deps.auth.orgId) };
}

async function updateSession(
  deps: EndpointDeps,
): Promise<PluginEndpointResponse> {
  const id = deps.endpointCtx.params.id;
  const existing = await deps.repos.sessions.findById(id, deps.auth.orgId);
  if (!existing) return notFound('Session not found');

  const body = (deps.endpointCtx.body ?? {}) as UpdateSessionBody;
  const updated = await deps.repos.sessions.update(
    id,
    {
      title: body.title,
      model: body.model,
      permissionMode: body.permissionMode,
      workspaceId: body.workspaceId,
      enabledTools: body.enabledTools,
      extraDenied: body.extraDenied,
      visibility: body.visibility,
      status: body.status,
    },
    deps.auth.orgId,
  );
  if (!updated) return notFound('Session not found');
  return { body: withDoAgentName(updated, deps.auth.orgId) };
}

async function deleteSession(
  deps: EndpointDeps,
): Promise<PluginEndpointResponse> {
  const id = deps.endpointCtx.params.id;
  const existing = await deps.repos.sessions.findById(id, deps.auth.orgId);
  if (!existing) return notFound('Session not found');

  // Best-effort: tear down the provider's side first; fall through to
  // archiving the row even if the provider call fails.
  const agent = await deps.repos.agents.findById(
    existing.agentId,
    deps.auth.orgId,
  );
  if (agent) {
    const provider = getProvider(deps.pluginCtx, agent.providerId);
    if (provider?.closeSession) {
      try {
        await provider.closeSession(existing.providerSessionId);
      } catch (err) {
        deps.pluginCtx.logger.warn(
          '[agents] provider.closeSession failed; archiving row anyway',
          { id, error: err instanceof Error ? err.message : String(err) },
        );
      }
    }
  }

  await deps.repos.sessions.update(
    id,
    { status: 'archived' },
    deps.auth.orgId,
  );
  return { body: { success: true, status: 'archived' } };
}

async function listMessages(
  deps: EndpointDeps,
): Promise<PluginEndpointResponse> {
  const id = deps.endpointCtx.params.id;
  const session = await deps.repos.sessions.findById(id, deps.auth.orgId);
  if (!session) return notFound('Session not found');

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
        nextBefore: slice.length > 0 ? slice[0]!.sequence : null,
      },
    },
  };
}

async function promptSession(
  deps: EndpointDeps,
): Promise<PluginEndpointResponse> {
  const id = deps.endpointCtx.params.id;
  const session = await deps.repos.sessions.findById(id, deps.auth.orgId);
  if (!session) return notFound('Session not found');

  return notImplemented(
    'HTTP prompt is not implemented in v1 — connect over WebSocket to the AgentChatDO instead',
    {
      transport: 'websocket',
      doAgentName: tenantScopedName('chat', deps.auth.orgId, session.id),
      doBinding: 'AgentChatDO',
    },
  );
}

async function interruptSession(
  deps: EndpointDeps,
): Promise<PluginEndpointResponse> {
  const id = deps.endpointCtx.params.id;
  const session = await deps.repos.sessions.findById(id, deps.auth.orgId);
  if (!session) return notFound('Session not found');

  // The DO singleton may not be populated outside of CF mode (e.g. in
  // a Node deployment that hasn't wired the runtime). In that case we
  // surface a 501 so callers can fall back to a transport-specific
  // interrupt path.
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

  // We don't have direct access to a DO stub from inside an endpoint
  // handler (the DO env is the consumer Worker's env, not ours). The
  // canonical way to interrupt is for the WebSocket client to send a
  // typed message — so we surface the DO name + the message payload
  // the client should send. Backends that want an HTTP interrupt path
  // can wrap this and forward through their own DO binding.
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

export function createSessionsEndpoints(
  ctx: PluginContext,
): FlowlibPluginEndpoint[] {
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
