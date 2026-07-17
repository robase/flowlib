/**
 * REST endpoints for `agent_memories`.
 *
 * Routes:
 *
 *   GET    /memories            — memories visible to the caller (org globals + own personal + project)
 *   GET    /memories?q=…        — keyword search across the visible set
 *   POST   /memories            — author a memory
 *   GET    /memories/:id
 *   PATCH  /memories/:id
 *   DELETE /memories/:id
 *
 * Tenant-scoped on every read; cross-tenant access returns 404. A
 * `personal` memory is only visible/manageable by its owner; `project`
 * memories by anyone who can see the project; `global` by any org member.
 */

import type { FlowlibPluginEndpoint, PluginEndpointResponse } from '@flowlib/core';
import type { PluginContext } from '../plugin-context';
import type { AgentMemory, MemoryScope } from '../repositories/memories.repository';
import { badRequest, notFound, safeHandler, type EndpointDeps } from './helpers';

interface CreateMemoryBody {
  content?: string;
  scope?: string;
  projectId?: string | null;
  tags?: string[];
}

interface UpdateMemoryBody extends CreateMemoryBody {}

const SCOPES: ReadonlySet<string> = new Set(['personal', 'project', 'global']);

function normaliseScope(scope: string | undefined): MemoryScope {
  return scope === 'global' || scope === 'project' ? scope : 'personal';
}

/** A memory is visible/manageable when it's global, owned by the caller, or project-scoped. */
function canAccess(memory: AgentMemory, userId: string): boolean {
  if (memory.scope === 'global' || memory.scope === 'project') {
    return true;
  }
  // personal — only the owner (createdBy / userId).
  return memory.userId === userId || memory.createdBy === userId;
}

async function listMemories(deps: EndpointDeps): Promise<PluginEndpointResponse> {
  const q = deps.endpointCtx.query?.q;
  const scope = {
    orgId: deps.auth.orgId,
    userId: deps.auth.userId,
    projectId: deps.endpointCtx.query?.projectId ?? null,
  };
  const rows =
    typeof q === 'string' && q.trim().length > 0
      ? await deps.repos.memories.search(q, scope)
      : await deps.repos.memories.listForScope(scope);
  return { body: { data: rows } };
}

async function getMemory(deps: EndpointDeps): Promise<PluginEndpointResponse> {
  const id = deps.endpointCtx.params.id;
  const row = await deps.repos.memories.findById(id, deps.auth.orgId);
  if (!row || !canAccess(row, deps.auth.userId)) {
    return notFound('Memory not found');
  }
  return { body: row };
}

async function createMemory(deps: EndpointDeps): Promise<PluginEndpointResponse> {
  const body = (deps.endpointCtx.body ?? {}) as CreateMemoryBody;
  if (!body.content || typeof body.content !== 'string') {
    return badRequest('content is required');
  }
  if (body.scope !== undefined && !SCOPES.has(body.scope)) {
    return badRequest('scope must be one of: personal, project, global');
  }
  const scope = normaliseScope(body.scope);
  if (scope === 'project' && !body.projectId) {
    return badRequest('projectId is required for project-scoped memories');
  }
  const created = await deps.repos.memories.create({
    orgId: deps.auth.orgId,
    scope,
    // Personal memories are keyed to the caller; project memories carry
    // the project id; global have neither.
    userId: scope === 'personal' ? deps.auth.userId : null,
    projectId: scope === 'project' ? (body.projectId ?? null) : null,
    content: body.content,
    tags: Array.isArray(body.tags) ? body.tags : undefined,
    createdBy: deps.auth.userId,
  });
  return { status: 201, body: created };
}

async function updateMemory(deps: EndpointDeps): Promise<PluginEndpointResponse> {
  const id = deps.endpointCtx.params.id;
  const existing = await deps.repos.memories.findById(id, deps.auth.orgId);
  if (!existing || !canAccess(existing, deps.auth.userId)) {
    return notFound('Memory not found');
  }
  const body = (deps.endpointCtx.body ?? {}) as UpdateMemoryBody;
  if (body.scope !== undefined && !SCOPES.has(body.scope)) {
    return badRequest('scope must be one of: personal, project, global');
  }

  // `scope` drives `userId`/`projectId` — exactly as in `createMemory`.
  // Updating `scope` alone used to leave the ownership columns untouched,
  // so a `global` → `personal` flip produced `scope='personal',
  // user_id=NULL`: a row that matches neither the global nor the personal
  // branch of `listForScope`, invisible to every list, search and prompt
  // context, with no API path back. Recompute both columns on every write.
  const nextScope = body.scope !== undefined ? normaliseScope(body.scope) : existing.scope;
  const nextProjectId = nextScope === 'project' ? (body.projectId ?? existing.projectId) : null;
  if (nextScope === 'project' && !nextProjectId) {
    return badRequest('projectId is required for project-scoped memories');
  }

  const updated = await deps.repos.memories.update(
    id,
    {
      content: body.content,
      tags: Array.isArray(body.tags) ? body.tags : undefined,
      scope: nextScope,
      // Keep an existing owner; adopt the caller when promoting a memory
      // that never had one (e.g. global → personal).
      userId: nextScope === 'personal' ? (existing.userId ?? deps.auth.userId) : null,
      projectId: nextProjectId,
    },
    deps.auth.orgId,
  );
  if (!updated) {
    return notFound('Memory not found');
  }
  return { body: updated };
}

async function deleteMemory(deps: EndpointDeps): Promise<PluginEndpointResponse> {
  const id = deps.endpointCtx.params.id;
  const existing = await deps.repos.memories.findById(id, deps.auth.orgId);
  if (!existing || !canAccess(existing, deps.auth.userId)) {
    return notFound('Memory not found');
  }
  await deps.repos.memories.delete(id, deps.auth.orgId);
  return { body: { success: true } };
}

export function createMemoriesEndpoints(ctx: PluginContext): FlowlibPluginEndpoint[] {
  return [
    { method: 'GET', path: '/agents/memories', handler: safeHandler(ctx, listMemories) },
    { method: 'POST', path: '/agents/memories', handler: safeHandler(ctx, createMemory) },
    { method: 'GET', path: '/agents/memories/:id', handler: safeHandler(ctx, getMemory) },
    { method: 'PATCH', path: '/agents/memories/:id', handler: safeHandler(ctx, updateMemory) },
    { method: 'DELETE', path: '/agents/memories/:id', handler: safeHandler(ctx, deleteMemory) },
  ];
}
