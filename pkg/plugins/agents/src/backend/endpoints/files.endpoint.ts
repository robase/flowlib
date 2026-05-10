/**
 * REST endpoints for workspace file operations:
 *
 *   GET /workspaces/:id/files?q=<glob>
 *   GET /workspaces/:id/files/read?path=<rel>
 *
 * Both routes resolve the workspace through the configured
 * `WorkspaceProvider` and dispatch to the returned `WorkspaceHandle`.
 * Tenant scoping happens twice — once when looking up the workspace
 * row (cross-tenant returns 404), once inside the provider's `resolve()`
 * (which embeds `auth.orgId` in any sandbox naming scheme).
 */

import type { FlowlibPluginEndpoint, PluginEndpointResponse } from '@flowlib/core';
import type { PluginContext } from '../plugin-context';
import { badRequest, notFound, safeHandler, type EndpointDeps } from './helpers';

async function listFiles(deps: EndpointDeps): Promise<PluginEndpointResponse> {
  const id = deps.endpointCtx.params.id;
  const ws = await deps.repos.workspaces.findById(id, deps.auth.orgId);
  if (!ws) {
    return notFound('Workspace not found');
  }

  const provider = deps.pluginCtx.options.workspaceProvider;
  if (!provider || provider.id !== ws.workspaceProviderId) {
    return badRequest('Workspace provider not registered', {
      workspaceProviderId: ws.workspaceProviderId,
    });
  }

  const q = deps.endpointCtx.query.q ?? '**/*';
  try {
    const handle = await provider.resolve(id, deps.auth);
    const files = await handle.listFiles(q);
    return { body: { data: files } };
  } catch (err) {
    return {
      status: 500,
      body: {
        error: 'Failed to list workspace files',
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

async function readFile(deps: EndpointDeps): Promise<PluginEndpointResponse> {
  const id = deps.endpointCtx.params.id;
  const ws = await deps.repos.workspaces.findById(id, deps.auth.orgId);
  if (!ws) {
    return notFound('Workspace not found');
  }

  const path = deps.endpointCtx.query.path;
  if (!path || typeof path !== 'string') {
    return badRequest('path query parameter is required');
  }

  const provider = deps.pluginCtx.options.workspaceProvider;
  if (!provider || provider.id !== ws.workspaceProviderId) {
    return badRequest('Workspace provider not registered', {
      workspaceProviderId: ws.workspaceProviderId,
    });
  }

  try {
    const handle = await provider.resolve(id, deps.auth);
    const content = await handle.readFile(path);
    return { body: { path, content } };
  } catch (err) {
    return {
      status: 404,
      body: {
        error: 'Failed to read file',
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

export function createFilesEndpoints(ctx: PluginContext): FlowlibPluginEndpoint[] {
  return [
    {
      method: 'GET',
      path: '/workspaces/:id/files',
      handler: safeHandler(ctx, listFiles),
    },
    {
      method: 'GET',
      path: '/workspaces/:id/files/read',
      handler: safeHandler(ctx, readFile),
    },
  ];
}
