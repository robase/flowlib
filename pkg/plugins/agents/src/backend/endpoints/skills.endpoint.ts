/**
 * REST endpoints for `agent_skills`.
 *
 * Routes:
 *
 *   GET    /skills           — skills visible to the caller (org globals + own personal)
 *   POST   /skills           — author a skill
 *   GET    /skills/:id
 *   PATCH  /skills/:id
 *   DELETE /skills/:id
 *
 * Tenant-scoped on every read; cross-tenant access returns 404. A
 * `personal` skill is only visible/manageable by its owner; `global`
 * skills are visible (and, for v1, manageable) by any org member —
 * owner-vs-admin RBAC on globals is deferred to the permissions work.
 */

import type { FlowlibPluginEndpoint, PluginEndpointResponse } from '@flowlib/core';
import type { PluginContext } from '../plugin-context';
import type { AgentSkill, SkillScope } from '../repositories/skills.repository';
import { badRequest, notFound, safeHandler, type EndpointDeps } from './helpers';

interface CreateSkillBody {
  name?: string;
  description?: string;
  body?: string;
  scope?: string;
  tags?: string[];
}

interface UpdateSkillBody extends CreateSkillBody {}

/** A skill is visible/manageable when it's global or owned by the caller. */
function canAccess(skill: AgentSkill, userId: string): boolean {
  return skill.scope === 'global' || skill.ownerId === userId;
}

function normaliseScope(scope: string | undefined): SkillScope {
  return scope === 'global' ? 'global' : 'personal';
}

async function listSkills(deps: EndpointDeps): Promise<PluginEndpointResponse> {
  const rows = await deps.repos.skills.listForScope({
    orgId: deps.auth.orgId,
    userId: deps.auth.userId,
  });
  return { body: { data: rows } };
}

async function getSkill(deps: EndpointDeps): Promise<PluginEndpointResponse> {
  const id = deps.endpointCtx.params.id;
  const row = await deps.repos.skills.findById(id, deps.auth.orgId);
  if (!row || !canAccess(row, deps.auth.userId)) {
    return notFound('Skill not found');
  }
  return { body: row };
}

async function createSkill(deps: EndpointDeps): Promise<PluginEndpointResponse> {
  const body = (deps.endpointCtx.body ?? {}) as CreateSkillBody;
  if (!body.name || typeof body.name !== 'string') {
    return badRequest('name is required');
  }
  if (!body.description || typeof body.description !== 'string') {
    return badRequest('description is required');
  }
  if (!body.body || typeof body.body !== 'string') {
    return badRequest('body is required');
  }
  const created = await deps.repos.skills.create({
    orgId: deps.auth.orgId,
    name: body.name,
    description: body.description,
    body: body.body,
    scope: normaliseScope(body.scope),
    // Record the creator as owner. For `global` skills this is purely
    // provenance — visibility ignores owner; for `personal` it's the
    // visibility key.
    ownerId: deps.auth.userId,
    tags: Array.isArray(body.tags) ? body.tags : undefined,
  });
  return { status: 201, body: created };
}

async function updateSkill(deps: EndpointDeps): Promise<PluginEndpointResponse> {
  const id = deps.endpointCtx.params.id;
  const existing = await deps.repos.skills.findById(id, deps.auth.orgId);
  if (!existing || !canAccess(existing, deps.auth.userId)) {
    return notFound('Skill not found');
  }
  const body = (deps.endpointCtx.body ?? {}) as UpdateSkillBody;
  const updated = await deps.repos.skills.update(
    id,
    {
      name: body.name,
      description: body.description,
      body: body.body,
      scope: body.scope !== undefined ? normaliseScope(body.scope) : undefined,
      tags: Array.isArray(body.tags) ? body.tags : undefined,
    },
    deps.auth.orgId,
  );
  if (!updated) {
    return notFound('Skill not found');
  }
  return { body: updated };
}

async function deleteSkill(deps: EndpointDeps): Promise<PluginEndpointResponse> {
  const id = deps.endpointCtx.params.id;
  const existing = await deps.repos.skills.findById(id, deps.auth.orgId);
  if (!existing || !canAccess(existing, deps.auth.userId)) {
    return notFound('Skill not found');
  }
  await deps.repos.skills.delete(id, deps.auth.orgId);
  return { body: { success: true } };
}

export function createSkillsEndpoints(ctx: PluginContext): FlowlibPluginEndpoint[] {
  return [
    { method: 'GET', path: '/skills', handler: safeHandler(ctx, listSkills) },
    { method: 'POST', path: '/skills', handler: safeHandler(ctx, createSkill) },
    { method: 'GET', path: '/skills/:id', handler: safeHandler(ctx, getSkill) },
    { method: 'PATCH', path: '/skills/:id', handler: safeHandler(ctx, updateSkill) },
    { method: 'DELETE', path: '/skills/:id', handler: safeHandler(ctx, deleteSkill) },
  ];
}
