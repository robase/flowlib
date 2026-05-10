/**
 * REST endpoints for `agent_projects`.
 *
 * Routes:
 *
 *   GET    /projects
 *   POST   /projects
 *   GET    /projects/:id
 *   PATCH  /projects/:id
 *   DELETE /projects/:id
 *
 * Tenant-scoped on every read; cross-tenant access returns 404.
 */

import type { FlowlibPluginEndpoint, PluginEndpointResponse } from '@flowlib/core';
import type { PluginContext } from '../plugin-context';
import { badRequest, notFound, safeHandler, type EndpointDeps } from './helpers';

interface CreateProjectBody {
  name?: string;
  description?: string | null;
  gitRemote?: string | null;
}

interface UpdateProjectBody extends CreateProjectBody {}

async function listProjects(deps: EndpointDeps): Promise<PluginEndpointResponse> {
  const rows = await deps.repos.projects.list({ orgId: deps.auth.orgId });
  return { body: { data: rows } };
}

async function getProject(deps: EndpointDeps): Promise<PluginEndpointResponse> {
  const id = deps.endpointCtx.params.id;
  const row = await deps.repos.projects.findById(id, deps.auth.orgId);
  if (!row) {
    return notFound('Project not found');
  }
  return { body: row };
}

async function createProject(deps: EndpointDeps): Promise<PluginEndpointResponse> {
  const body = (deps.endpointCtx.body ?? {}) as CreateProjectBody;
  if (!body.name || typeof body.name !== 'string') {
    return badRequest('name is required');
  }
  const created = await deps.repos.projects.create({
    orgId: deps.auth.orgId,
    name: body.name,
    description: body.description ?? null,
    gitRemote: body.gitRemote ?? null,
    createdBy: deps.auth.userId,
  });
  return { status: 201, body: created };
}

async function updateProject(deps: EndpointDeps): Promise<PluginEndpointResponse> {
  const id = deps.endpointCtx.params.id;
  const existing = await deps.repos.projects.findById(id, deps.auth.orgId);
  if (!existing) {
    return notFound('Project not found');
  }
  const body = (deps.endpointCtx.body ?? {}) as UpdateProjectBody;
  const updated = await deps.repos.projects.update(
    id,
    {
      name: body.name,
      description: body.description,
      gitRemote: body.gitRemote,
    },
    deps.auth.orgId,
  );
  if (!updated) {
    return notFound('Project not found');
  }
  return { body: updated };
}

async function deleteProject(deps: EndpointDeps): Promise<PluginEndpointResponse> {
  const id = deps.endpointCtx.params.id;
  const existing = await deps.repos.projects.findById(id, deps.auth.orgId);
  if (!existing) {
    return notFound('Project not found');
  }
  await deps.repos.projects.delete(id, deps.auth.orgId);
  return { body: { success: true } };
}

export function createProjectsEndpoints(ctx: PluginContext): FlowlibPluginEndpoint[] {
  return [
    {
      method: 'GET',
      path: '/projects',
      handler: safeHandler(ctx, listProjects),
    },
    {
      method: 'POST',
      path: '/projects',
      handler: safeHandler(ctx, createProject),
    },
    {
      method: 'GET',
      path: '/projects/:id',
      handler: safeHandler(ctx, getProject),
    },
    {
      method: 'PATCH',
      path: '/projects/:id',
      handler: safeHandler(ctx, updateProject),
    },
    {
      method: 'DELETE',
      path: '/projects/:id',
      handler: safeHandler(ctx, deleteProject),
    },
  ];
}
