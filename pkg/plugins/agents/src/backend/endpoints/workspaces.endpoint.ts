/**
 * REST endpoints for `agent_workspaces`.
 *
 * Routes:
 *
 *   GET    /workspaces
 *   POST   /workspaces       — calls `workspaceProvider.create()`
 *   GET    /workspaces/:id
 *   PATCH  /workspaces/:id
 *   DELETE /workspaces/:id   — calls `workspaceProvider.destroy()` then deletes the row
 *
 * Tenant-scoped on every read; cross-tenant access returns 404.
 */

import type { FlowlibPluginEndpoint, PluginEndpointResponse } from '@flowlib/core';
import type { PluginContext } from '../plugin-context';
import type { AgentVisibility, WorkspaceProviderId } from '../../shared/types';
import { badRequest, notFound, safeHandler, type EndpointDeps } from './helpers';

interface CreateWorkspaceBody {
  name?: string;
  workspaceProviderId?: string;
  rootPath?: string | null;
  gitRemote?: string | null;
  gitBranch?: string | null;
  sandboxConfig?: Record<string, unknown> | null;
  projectId?: string | null;
  visibility?: AgentVisibility;
  /** Optional pre-allocated id (mostly for tests). */
  id?: string;
}

interface UpdateWorkspaceBody extends Omit<CreateWorkspaceBody, 'id'> {}

async function listWorkspaces(deps: EndpointDeps): Promise<PluginEndpointResponse> {
  const rows = await deps.repos.workspaces.list({ orgId: deps.auth.orgId });
  return { body: { data: rows } };
}

async function getWorkspace(deps: EndpointDeps): Promise<PluginEndpointResponse> {
  const id = deps.endpointCtx.params.id;
  const row = await deps.repos.workspaces.findById(id, deps.auth.orgId);
  if (!row) {
    return notFound('Workspace not found');
  }
  return { body: row };
}

async function createWorkspace(deps: EndpointDeps): Promise<PluginEndpointResponse> {
  const body = (deps.endpointCtx.body ?? {}) as CreateWorkspaceBody;
  if (!body.name || typeof body.name !== 'string') {
    return badRequest('name is required');
  }

  const configured = deps.pluginCtx.options.workspaceProviders;
  // Default: the first configured provider when the caller doesn't
  // pick one explicitly. Hosts with multiple workspace providers can
  // route by passing `workspaceProviderId` on the request.
  const requestedId = body.workspaceProviderId ?? configured[0]?.id;

  if (!requestedId) {
    return badRequest('workspaceProviderId is required (no default configured)');
  }

  const provider = deps.pluginCtx.registries.workspaces.get(requestedId);
  if (!provider) {
    return badRequest('Unknown workspaceProviderId', {
      workspaceProviderId: requestedId,
      registered: Array.from(deps.pluginCtx.registries.workspaces.keys()),
    });
  }

  const id = body.id ?? crypto.randomUUID();

  // Provider-side create. Failure leaves no DB row behind.
  let providerOk = false;
  try {
    await provider.create({
      workspaceId: id,
      auth: deps.auth,
      name: body.name,
      rootPath: body.rootPath ?? undefined,
      gitRemote: body.gitRemote ?? undefined,
      gitBranch: body.gitBranch ?? undefined,
      sandboxConfig: body.sandboxConfig ?? undefined,
    });
    providerOk = true;
  } catch (err) {
    return badRequest('Workspace provider rejected the request', {
      message: err instanceof Error ? err.message : String(err),
    });
  }

  if (!providerOk) {
    return badRequest('Workspace provider did not return a handle');
  }

  const created = await deps.repos.workspaces.create({
    id,
    orgId: deps.auth.orgId,
    name: body.name,
    workspaceProviderId: provider.id as WorkspaceProviderId,
    rootPath: body.rootPath ?? null,
    gitRemote: body.gitRemote ?? null,
    gitBranch: body.gitBranch ?? null,
    sandboxConfig: body.sandboxConfig ?? null,
    projectId: body.projectId ?? null,
    createdBy: deps.auth.userId,
    visibility: body.visibility ?? 'private',
  });

  return { status: 201, body: created };
}

async function updateWorkspace(deps: EndpointDeps): Promise<PluginEndpointResponse> {
  const id = deps.endpointCtx.params.id;
  const existing = await deps.repos.workspaces.findById(id, deps.auth.orgId);
  if (!existing) {
    return notFound('Workspace not found');
  }

  const body = (deps.endpointCtx.body ?? {}) as UpdateWorkspaceBody;
  const updated = await deps.repos.workspaces.update(
    id,
    {
      name: body.name,
      workspaceProviderId: body.workspaceProviderId as WorkspaceProviderId | undefined,
      rootPath: body.rootPath,
      gitRemote: body.gitRemote,
      gitBranch: body.gitBranch,
      sandboxConfig: body.sandboxConfig,
      projectId: body.projectId,
      visibility: body.visibility,
    },
    deps.auth.orgId,
  );
  if (!updated) {
    return notFound('Workspace not found');
  }
  return { body: updated };
}

async function deleteWorkspace(deps: EndpointDeps): Promise<PluginEndpointResponse> {
  const id = deps.endpointCtx.params.id;
  const existing = await deps.repos.workspaces.findById(id, deps.auth.orgId);
  if (!existing) {
    return notFound('Workspace not found');
  }

  const provider = deps.pluginCtx.registries.workspaces.get(existing.workspaceProviderId);
  if (provider) {
    try {
      await provider.destroy(id, deps.auth);
    } catch (err) {
      deps.pluginCtx.logger.warn(
        '[agents] workspace provider destroy() failed; deleting row anyway',
        { id, error: err instanceof Error ? err.message : String(err) },
      );
    }
  }

  await deps.repos.workspaces.delete(id, deps.auth.orgId);
  return { body: { success: true } };
}

export function createWorkspacesEndpoints(ctx: PluginContext): FlowlibPluginEndpoint[] {
  return [
    {
      method: 'GET',
      path: '/agents/workspaces',
      handler: safeHandler(ctx, listWorkspaces),
    },
    {
      method: 'POST',
      path: '/agents/workspaces',
      handler: safeHandler(ctx, createWorkspace),
    },
    {
      method: 'GET',
      path: '/agents/workspaces/:id',
      handler: safeHandler(ctx, getWorkspace),
    },
    {
      method: 'PATCH',
      path: '/agents/workspaces/:id',
      handler: safeHandler(ctx, updateWorkspace),
    },
    {
      method: 'DELETE',
      path: '/agents/workspaces/:id',
      handler: safeHandler(ctx, deleteWorkspace),
    },
  ];
}
