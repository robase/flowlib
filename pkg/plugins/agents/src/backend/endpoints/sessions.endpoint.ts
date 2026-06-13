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
import type { OutboundVendor } from '../cloudflare/outbound-auth';
import { normaliseModelForCredential } from '../providers/model-normalise';
import { inferOpencodeProvider } from './credentials.endpoint';
import { badRequest, notFound, notImplemented, safeHandler, type EndpointDeps } from './helpers';

interface CreateSessionBody {
  title?: string;
  providerId?: AgentProviderId;
  providerConfig?: Record<string, unknown>;
  /** Flowlib credential id whose API key the LLM provider should use. */
  credentialId?: string | null;
  model?: string | null;
  permissionMode?: string | null;
  systemPrompt?: string | null;
  workspaceId?: string | null;
  /**
   * Optional workspace provider id for the auto-provisioned workspace
   * (only used when `workspaceId` is omitted). Defaults to the chosen
   * agent provider's `capabilities.preferredWorkspaceProviderId`, then
   * to the first registered workspace provider.
   */
  workspaceProviderId?: string | null;
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
  credentialId?: string | null;
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
  deps: EndpointDeps,
): AgentSession & { doAgentName: string } {
  // The chat transport is decided by whether a Cloudflare Durable Object
  // is wired into this deployment: present → the DO WebSocket transport;
  // absent (e.g. Express/Node) → the HTTP/SSE transport. `doAgentName` is
  // always computed (cheap, deterministic) so the frontend can use it
  // when the DO transport is selected.
  const transportMode: AgentSession['transportMode'] = deps.pluginCtx.registries.cloudflareDoClass
    ? 'durable-object'
    : 'http';
  return {
    ...session,
    doAgentName: tenantScopedName('chat', deps.auth.orgId, session.id),
    transportMode,
  };
}

function getProvider(pluginCtx: PluginContext, providerId: string): AgentProvider | undefined {
  return pluginCtx.registries.providers.get(providerId);
}

async function listSessions(deps: EndpointDeps): Promise<PluginEndpointResponse> {
  const rows = await deps.repos.sessions.list({ orgId: deps.auth.orgId });
  return {
    body: { data: rows.map((r) => withDoAgentName(r, deps)) },
  };
}

async function getSession(deps: EndpointDeps): Promise<PluginEndpointResponse> {
  const id = deps.endpointCtx.params.id;
  const row = await deps.repos.sessions.findById(id, deps.auth.orgId);
  if (!row) {
    return notFound('Session not found');
  }
  return { body: withDoAgentName(row, deps) };
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
      const wsProvider = deps.pluginCtx.registries.workspaces.get(wsRow.workspaceProviderId);
      if (!wsProvider) {
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
      // Pick which workspace provider to auto-provision against.
      // Order: explicit body field > agent provider's preferred id >
      // first registered.
      const requestedWsProviderId =
        body.workspaceProviderId ??
        provider.capabilities.preferredWorkspaceProviderId ??
        opts.workspaceProviders[0]?.id;
      if (!requestedWsProviderId) {
        return badRequest('Provider requires a workspace but no workspace provider is configured', {
          providerId,
        });
      }
      const wsProvider = deps.pluginCtx.registries.workspaces.get(requestedWsProviderId);
      if (!wsProvider) {
        return badRequest('Workspace provider not registered', {
          workspaceProviderId: requestedWsProviderId,
          registered: Array.from(deps.pluginCtx.registries.workspaces.keys()),
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

  // Validate the credential (if any). We only check that it exists and is
  // active; the provider resolves the decrypted secret lazily at boot time.
  const credentialId = body.credentialId ?? null;
  if (credentialId) {
    const credentialError = await assertCredentialUsable(deps, credentialId);
    if (credentialError) {
      return credentialError;
    }
  }

  // Provider-side session create.
  let providerSessionId: string;
  try {
    const result = await provider.createSession({
      auth: deps.auth,
      config: body.providerConfig ?? {},
      workspace,
      credentialId: credentialId ?? undefined,
    });
    providerSessionId = result.providerSessionId;
  } catch (err) {
    return badRequest('Provider rejected session creation', {
      message: err instanceof Error ? err.message : String(err),
    });
  }

  // Outbound-Workers credential binding (Phase 2). When the workspace
  // exposes `metadata.outboundAuth` AND the user picked a credential,
  // pre-decrypt the API key now and write it to KV under the
  // providerSessionId. The opencode provider boots OpenCode with a
  // matching `X-Flowlib-Session-Id` header; the consumer Worker's
  // outbound handler reads the same KV key and injects the real
  // header at egress so the API key never enters the container.
  if (credentialId) {
    const bindError = await maybeBindOutboundCredential(
      deps,
      workspace,
      providerSessionId,
      credentialId,
    );
    if (bindError) {
      return bindError;
    }
  }

  // Coerce the model id when the picked credential is a multi-tier
  // router (openrouter, cloudflare-ai-gateway). Users routinely create
  // a session with model "anthropic/claude-..." and an openrouter
  // credential — without the rewrite opencode would try to call
  // api.anthropic.com directly, the outbound handler would not find
  // an `anthropic` binding for the session (only an `openrouter` one),
  // and the call would fail 401. The normaliser turns
  // "anthropic/claude-..." into "openrouter/anthropic/claude-..." so
  // opencode dispatches via openrouter's provider config.
  const requestedModel = body.model ?? opts.defaultModel ?? null;
  let resolvedModel: string | null = requestedModel ?? null;
  if (requestedModel && credentialId) {
    try {
      const credForVendor = await flowlibCreds(deps).getDecryptedWithRefresh(credentialId);
      const credentialVendor = inferOpencodeProvider({
        name: credForVendor.name,
        authType: credForVendor.authType,
        config: (credForVendor.config as Record<string, unknown>) ?? null,
        metadata: credForVendor.metadata ?? null,
      });
      const result = normaliseModelForCredential({
        model: requestedModel,
        credentialVendor,
      });
      resolvedModel = result.model;
      if (result.rewritten) {
        // eslint-disable-next-line no-console
        console.warn('[agents/sessions] rewrote session.model to match credential vendor', {
          requestedModel,
          resolvedModel,
          credentialVendor,
          credentialId,
          reason: result.reason,
        });
      }
    } catch {
      // Leave the model untouched on lookup failure — the assert
      // above will already have rejected unusable credentials.
    }
  }

  const created = await deps.repos.sessions.create({
    orgId: deps.auth.orgId,
    providerSessionId,
    title: body.title ?? 'New chat',
    providerId,
    providerConfig: body.providerConfig ?? {},
    credentialId,
    model: resolvedModel,
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

  return { status: 201, body: withDoAgentName(created, deps) };
}

/**
 * Confirm the credential exists and is active. Returns a `badRequest`
 * response on failure, or `null` to continue. Tenant scoping mirrors
 * what `flowlib.credentials` enforces — we just surface the failure as
 * a 400 instead of letting the provider call fail later with a less
 * actionable message.
 */
async function assertCredentialUsable(
  deps: EndpointDeps,
  credentialId: string,
): Promise<PluginEndpointResponse | null> {
  try {
    const flowlib = deps.pluginCtx.flowlib.getFlowlib();
    const sanitized = await flowlib.credentials.getSanitized(credentialId);
    if (!sanitized.isActive) {
      return badRequest('Credential is not active', { credentialId });
    }
    return null;
  } catch (err) {
    return badRequest('Credential not found or not accessible', {
      credentialId,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Workspace handle shape we care about for outbound auth — kept loose
 * so we don't pull `WorkspaceHandle` (and its dependency tree) into
 * the endpoint module just for a type guard.
 */
interface OutboundAuthSurface {
  bindCredential: (sessionId: string, vendor: OutboundVendor, apiKey: string) => Promise<void>;
  unbindCredential: (sessionId: string, vendor: OutboundVendor) => Promise<void>;
}

type WorkspaceWithOutbound = {
  metadata?: { outboundAuth?: OutboundAuthSurface };
};

function getOutboundAuth(
  workspace: WorkspaceWithOutbound | undefined,
): OutboundAuthSurface | undefined {
  return workspace?.metadata?.outboundAuth;
}

/**
 * If the workspace exposes outbound-Workers auth and the credential
 * maps to a vendor we support, pre-decrypt the API key and write it
 * to KV under `providerSessionId`. The opencode provider's outbound
 * mode boots OpenCode with a matching `X-Flowlib-Session-Id` header.
 *
 * Returns `null` on success / no-op, or a `badRequest` response on
 * failure (decrypt error, unsupported vendor for outbound mode).
 */
async function maybeBindOutboundCredential(
  deps: EndpointDeps,
  workspace: WorkspaceWithOutbound | undefined,
  providerSessionId: string,
  credentialId: string,
): Promise<PluginEndpointResponse | null> {
  const outboundAuth = getOutboundAuth(workspace);
  // eslint-disable-next-line no-console
  console.log('[agents/sessions] maybeBindOutboundCredential enter', {
    providerSessionId,
    credentialId,
    hasWorkspace: Boolean(workspace),
    workspaceMetadataKeys: workspace?.metadata ? Object.keys(workspace.metadata as object) : [],
    hasOutboundAuth: Boolean(outboundAuth),
  });
  if (!outboundAuth) {
    // eslint-disable-next-line no-console
    console.warn(
      '[agents/sessions] no outboundAuth on workspace — KV will not be populated, opencode outbound calls will 401',
      {
        providerSessionId,
        credentialId,
      },
    );
    return null;
  }
  let cred: Awaited<ReturnType<ReturnType<typeof flowlibCreds>['getDecryptedWithRefresh']>>;
  try {
    cred = await flowlibCreds(deps).getDecryptedWithRefresh(credentialId);
  } catch (err) {
    return badRequest('Failed to resolve credential for outbound binding', {
      credentialId,
      message: err instanceof Error ? err.message : String(err),
    });
  }
  const vendorSlug = inferOpencodeProvider({
    name: cred.name,
    authType: cred.authType,
    config: (cred.config as Record<string, unknown>) ?? null,
    metadata: cred.metadata ?? null,
  });
  const vendor = isOutboundVendor(vendorSlug) ? vendorSlug : null;
  if (!vendor) {
    return badRequest('Credential vendor not supported for outbound auth', {
      credentialId,
      vendor: vendorSlug,
    });
  }
  const apiKey = (cred.config as { apiKey?: unknown })?.apiKey;
  if (typeof apiKey !== 'string' || apiKey.length === 0) {
    return badRequest('Credential is missing apiKey — cannot bind for outbound auth', {
      credentialId,
    });
  }
  try {
    await outboundAuth.bindCredential(providerSessionId, vendor, apiKey);
    // eslint-disable-next-line no-console
    console.log('[agents/sessions] outbound credential bound to KV', {
      providerSessionId,
      credentialId,
      vendor,
      kvKey: `agents/cred/session/${providerSessionId}/${vendor}`,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[agents/sessions] outboundAuth.bindCredential threw', {
      providerSessionId,
      credentialId,
      vendor,
      message: err instanceof Error ? err.message : String(err),
    });
    return badRequest('Failed to write credential binding to KV', {
      message: err instanceof Error ? err.message : String(err),
    });
  }
  return null;
}

/**
 * Type-narrow a string slug to {@link OutboundVendor}.
 */
function isOutboundVendor(slug: string): slug is OutboundVendor {
  return (
    slug === 'anthropic' ||
    slug === 'openai' ||
    slug === 'openrouter' ||
    slug === 'google' ||
    slug === 'cloudflare-ai-gateway'
  );
}

/** Convenience accessor — flowlib.credentials with a stable type signature. */
function flowlibCreds(deps: EndpointDeps) {
  return deps.pluginCtx.flowlib.getFlowlib().credentials;
}

async function updateSession(deps: EndpointDeps): Promise<PluginEndpointResponse> {
  const id = deps.endpointCtx.params.id;
  const existing = await deps.repos.sessions.findById(id, deps.auth.orgId);
  if (!existing) {
    return notFound('Session not found');
  }

  const body = (deps.endpointCtx.body ?? {}) as UpdateSessionBody;
  if (body.credentialId !== undefined && body.credentialId !== null) {
    const credentialError = await assertCredentialUsable(deps, body.credentialId);
    if (credentialError) {
      return credentialError;
    }
  }
  const updated = await deps.repos.sessions.update(
    id,
    {
      title: body.title,
      providerId: body.providerId,
      providerConfig: body.providerConfig,
      credentialId: body.credentialId,
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

  // If the credential changed AND the session's workspace exposes
  // outbound auth, rewrite the KV binding so the next outbound LLM
  // request from the container picks up the new key. We re-resolve
  // the workspace handle here because session updates may happen
  // outside the original create's request scope.
  if (body.credentialId !== undefined && body.credentialId !== existing.credentialId) {
    const rebindError = await maybeRebindOutboundOnPatch(
      deps,
      updated.workspaceId,
      updated.providerSessionId,
      body.credentialId,
      existing.credentialId,
    );
    if (rebindError) {
      return rebindError;
    }
  }

  return { body: withDoAgentName(updated, deps) };
}

/**
 * Resolve the workspace and rebind / unbind the credential on KV when
 * the session's credentialId changes via PATCH. Best-effort — the row
 * is already updated; we fail soft on KV errors (return null) and let
 * the existing binding stay in place.
 */
async function maybeRebindOutboundOnPatch(
  deps: EndpointDeps,
  workspaceId: string | null,
  providerSessionId: string,
  newCredentialId: string | null,
  oldCredentialId: string | null,
): Promise<PluginEndpointResponse | null> {
  if (!workspaceId) {
    return null;
  }
  const wsRow = await deps.repos.workspaces.findById(workspaceId, deps.auth.orgId);
  if (!wsRow) {
    return null;
  }
  const wsProvider = deps.pluginCtx.registries.workspaces.get(wsRow.workspaceProviderId);
  if (!wsProvider) {
    return null;
  }
  let workspace: WorkspaceWithOutbound | undefined;
  try {
    workspace = (await wsProvider.resolve(workspaceId, deps.auth)) as WorkspaceWithOutbound;
  } catch {
    return null;
  }
  const outboundAuth = getOutboundAuth(workspace);
  if (!outboundAuth) {
    return null;
  }

  // Best-effort unbind of the old credential's vendor — we don't know
  // the vendor without re-reading the old credential, so unbind every
  // supported vendor for this session. KV deletes for keys that don't
  // exist are no-ops.
  await Promise.all(
    (['anthropic', 'openai', 'openrouter', 'google', 'cloudflare-ai-gateway'] as const).map((v) =>
      outboundAuth.unbindCredential(providerSessionId, v).catch(() => {
        /* swallow */
      }),
    ),
  );
  void oldCredentialId; // covered by the bulk unbind above

  if (newCredentialId) {
    return maybeBindOutboundCredential(deps, workspace, providerSessionId, newCredentialId);
  }
  return null;
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

  // Unbind any outbound-Workers credential bindings. Best-effort: the
  // KV TTL covers leaks, but eager cleanup keeps the binding count
  // tight and stops the next sandbox boot of this session id from
  // accidentally inheriting a stale key.
  await unbindOutboundCredentials(deps, existing.workspaceId, existing.providerSessionId);

  await deps.repos.sessions.update(id, { status: 'archived' }, deps.auth.orgId);
  return { body: { success: true, status: 'archived' } };
}

/**
 * Best-effort unbind of every vendor's KV credential binding for a
 * session. Called from DELETE; never throws.
 */
async function unbindOutboundCredentials(
  deps: EndpointDeps,
  workspaceId: string | null,
  providerSessionId: string,
): Promise<void> {
  if (!workspaceId) {
    return;
  }
  let wsRow;
  try {
    wsRow = await deps.repos.workspaces.findById(workspaceId, deps.auth.orgId);
  } catch {
    return;
  }
  if (!wsRow) {
    return;
  }
  const wsProvider = deps.pluginCtx.registries.workspaces.get(wsRow.workspaceProviderId);
  if (!wsProvider) {
    return;
  }
  let workspace: WorkspaceWithOutbound | undefined;
  try {
    workspace = (await wsProvider.resolve(workspaceId, deps.auth)) as WorkspaceWithOutbound;
  } catch {
    return;
  }
  const outboundAuth = getOutboundAuth(workspace);
  if (!outboundAuth) {
    return;
  }
  await Promise.all(
    (['anthropic', 'openai', 'openrouter', 'google', 'cloudflare-ai-gateway'] as const).map((v) =>
      outboundAuth.unbindCredential(providerSessionId, v).catch((err) => {
        deps.pluginCtx.logger.warn('[agents] outbound unbind failed', {
          providerSessionId,
          vendor: v,
          error: err instanceof Error ? err.message : String(err),
        });
      }),
    ),
  );
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
      path: '/agents/sessions',
      handler: safeHandler(ctx, listSessions),
    },
    {
      method: 'POST',
      path: '/agents/sessions',
      handler: safeHandler(ctx, createSession),
    },
    {
      method: 'GET',
      path: '/agents/sessions/:id',
      handler: safeHandler(ctx, getSession),
    },
    {
      method: 'PATCH',
      path: '/agents/sessions/:id',
      handler: safeHandler(ctx, updateSession),
    },
    {
      method: 'DELETE',
      path: '/agents/sessions/:id',
      handler: safeHandler(ctx, deleteSession),
    },
    {
      method: 'GET',
      path: '/agents/sessions/:id/messages',
      handler: safeHandler(ctx, listMessages),
    },
    {
      method: 'POST',
      path: '/agents/sessions/:id/prompt',
      handler: safeHandler(ctx, promptSession),
    },
    {
      method: 'POST',
      path: '/agents/sessions/:id/interrupt',
      handler: safeHandler(ctx, interruptSession),
    },
  ];
}
