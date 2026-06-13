/**
 * GET /agents/sessions/:id/plan — returns the agent's working task list
 * for the UI; 404 for unknown / cross-tenant sessions.
 */
import { describe, it, expect } from 'vitest';
import { createSessionsEndpoints } from '../sessions.endpoint';
import { buildRepositories } from '../../repositories/register';
import {
  findEndpoint,
  jsonBody,
  makeEndpointCtx,
  makeFakePluginCtx,
  makeIdentity,
} from './test-helpers';

async function seedSession(db: ReturnType<typeof makeFakePluginCtx>['db'], orgId: string) {
  const repos = buildRepositories(db);
  const s = await repos.sessions.create({
    orgId,
    providerSessionId: 'ps-1',
    providerId: 'ai-sdk',
    createdBy: 'u1',
  });
  return { sessionId: s.id, repos };
}

describe('GET /sessions/:id/plan', () => {
  it('returns the session plan checkpoints', async () => {
    const { ctx, db } = makeFakePluginCtx();
    const { sessionId, repos } = await seedSession(db, 'org-a');
    await repos.sessionPlans.upsert(sessionId, 'org-a', [
      { label: 'step one', status: 'done' },
      { label: 'step two', status: 'doing' },
    ]);

    const get = findEndpoint(createSessionsEndpoints(ctx), 'GET', '/agents/sessions/:id/plan');
    const res = await get.handler(
      makeEndpointCtx({ db, identity: makeIdentity('u1', 'org-a'), params: { id: sessionId } }),
    );
    const checkpoints = jsonBody(res).checkpoints as Array<{ label: string; status: string }>;
    expect(checkpoints.map((c) => c.label)).toEqual(['step one', 'step two']);
    expect(checkpoints[1].status).toBe('doing');
  });

  it('returns an empty plan when none has been set', async () => {
    const { ctx, db } = makeFakePluginCtx();
    const { sessionId } = await seedSession(db, 'org-a');
    const get = findEndpoint(createSessionsEndpoints(ctx), 'GET', '/agents/sessions/:id/plan');
    const res = await get.handler(
      makeEndpointCtx({ db, identity: makeIdentity('u1', 'org-a'), params: { id: sessionId } }),
    );
    expect(jsonBody(res).checkpoints).toEqual([]);
  });

  it('404s for an unknown session and across tenants', async () => {
    const { ctx, db } = makeFakePluginCtx();
    const { sessionId } = await seedSession(db, 'org-a');
    const get = findEndpoint(createSessionsEndpoints(ctx), 'GET', '/agents/sessions/:id/plan');

    const unknown = await get.handler(
      makeEndpointCtx({ db, identity: makeIdentity('u1', 'org-a'), params: { id: 'nope' } }),
    );
    expect((unknown as { status?: number }).status).toBe(404);

    const crossTenant = await get.handler(
      makeEndpointCtx({ db, identity: makeIdentity('u1', 'org-b'), params: { id: sessionId } }),
    );
    expect((crossTenant as { status?: number }).status).toBe(404);
  });
});
