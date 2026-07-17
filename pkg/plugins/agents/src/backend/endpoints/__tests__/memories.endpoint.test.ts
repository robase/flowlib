/**
 * Memories REST endpoints — CRUD, validation, keyword search via `?q`,
 * and cross-tenant 404s. Exercises the production handler path
 * (safeHandler → resolveDeps → real repository) over the fake DB.
 */
import { describe, it, expect } from 'vitest';
import { createMemoriesEndpoints } from '../memories.endpoint';
import {
  findEndpoint,
  jsonBody,
  makeEndpointCtx,
  makeFakePluginCtx,
  makeIdentity,
} from './test-helpers';

describe('memories endpoints', () => {
  it('POST /memories creates a personal memory owned by the caller', async () => {
    const { ctx, db } = makeFakePluginCtx();
    const post = findEndpoint(createMemoriesEndpoints(ctx), 'POST', '/agents/memories');

    const res = await post.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('u1', 'org-a'),
        body: { content: 'User prefers TypeScript', tags: ['pref'] },
      }),
    );

    expect((res as { status?: number }).status).toBe(201);
    const created = jsonBody(res);
    expect(created.content).toBe('User prefers TypeScript');
    expect(created.scope).toBe('personal');
    expect(created.userId).toBe('u1');
    expect(created.createdBy).toBe('u1');
    expect(created.orgId).toBe('org-a');
  });

  it('POST /memories rejects missing content and bad scope', async () => {
    const { ctx, db } = makeFakePluginCtx();
    const post = findEndpoint(createMemoriesEndpoints(ctx), 'POST', '/agents/memories');

    const noContent = await post.handler(
      makeEndpointCtx({ db, identity: makeIdentity('u1', 'org-a'), body: {} }),
    );
    expect((noContent as { status?: number }).status).toBe(400);

    const badScope = await post.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('u1', 'org-a'),
        body: { content: 'x', scope: 'nonsense' },
      }),
    );
    expect((badScope as { status?: number }).status).toBe(400);

    const projectNoId = await post.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('u1', 'org-a'),
        body: { content: 'x', scope: 'project' },
      }),
    );
    expect((projectNoId as { status?: number }).status).toBe(400);
  });

  it('GET /memories lists the caller’s visible memories', async () => {
    const { ctx, db } = makeFakePluginCtx();
    const endpoints = createMemoriesEndpoints(ctx);
    const post = findEndpoint(endpoints, 'POST', '/agents/memories');
    const list = findEndpoint(endpoints, 'GET', '/agents/memories');

    await post.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('u1', 'org-a'),
        body: { content: 'mine', scope: 'personal' },
      }),
    );
    await post.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('u1', 'org-a'),
        body: { content: 'shared', scope: 'global' },
      }),
    );

    const res = await list.handler(makeEndpointCtx({ db, identity: makeIdentity('u1', 'org-a') }));
    const data = jsonBody(res).data as Array<{ content: string }>;
    expect(data.map((m) => m.content).sort()).toEqual(['mine', 'shared']);
  });

  it('GET /memories?q=… keyword-searches the visible set', async () => {
    const { ctx, db } = makeFakePluginCtx();
    const endpoints = createMemoriesEndpoints(ctx);
    const post = findEndpoint(endpoints, 'POST', '/agents/memories');
    const list = findEndpoint(endpoints, 'GET', '/agents/memories');

    for (const content of ['Production DB is Postgres on Neon', 'User likes concise answers']) {
      await post.handler(
        makeEndpointCtx({
          db,
          identity: makeIdentity('u1', 'org-a'),
          body: { content, scope: 'global' },
        }),
      );
    }

    const res = await list.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('u1', 'org-a'),
        query: { q: 'which database in production' },
      }),
    );
    const data = jsonBody(res).data as Array<{ content: string }>;
    expect(data[0]?.content).toContain('Postgres on Neon');
  });

  it('a personal memory is invisible to another user (404) and another org (404)', async () => {
    const { ctx, db } = makeFakePluginCtx();
    const endpoints = createMemoriesEndpoints(ctx);
    const post = findEndpoint(endpoints, 'POST', '/agents/memories');
    const get = findEndpoint(endpoints, 'GET', '/agents/memories/:id');

    const created = jsonBody(
      await post.handler(
        makeEndpointCtx({
          db,
          identity: makeIdentity('u1', 'org-a'),
          body: { content: 'u1 only', scope: 'personal' },
        }),
      ),
    );
    const id = created.id as string;

    // Same org, different user → 404 (personal scope hides it)
    const otherUser = await get.handler(
      makeEndpointCtx({ db, identity: makeIdentity('u2', 'org-a'), params: { id } }),
    );
    expect((otherUser as { status?: number }).status).toBe(404);

    // Different org → 404 (tenant isolation)
    const otherOrg = await get.handler(
      makeEndpointCtx({ db, identity: makeIdentity('u1', 'org-b'), params: { id } }),
    );
    expect((otherOrg as { status?: number }).status).toBe(404);

    // Owner can read it
    const owner = await get.handler(
      makeEndpointCtx({ db, identity: makeIdentity('u1', 'org-a'), params: { id } }),
    );
    expect(jsonBody(owner).content).toBe('u1 only');
  });

  it('PATCH updates and DELETE removes; cross-tenant is 404', async () => {
    const { ctx, db } = makeFakePluginCtx();
    const endpoints = createMemoriesEndpoints(ctx);
    const post = findEndpoint(endpoints, 'POST', '/agents/memories');
    const patch = findEndpoint(endpoints, 'PATCH', '/agents/memories/:id');
    const del = findEndpoint(endpoints, 'DELETE', '/agents/memories/:id');
    const get = findEndpoint(endpoints, 'GET', '/agents/memories/:id');

    const id = jsonBody(
      await post.handler(
        makeEndpointCtx({
          db,
          identity: makeIdentity('u1', 'org-a'),
          body: { content: 'before', scope: 'global' },
        }),
      ),
    ).id as string;

    // Cross-tenant patch → 404
    const crossPatch = await patch.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('u1', 'org-b'),
        params: { id },
        body: { content: 'hacked' },
      }),
    );
    expect((crossPatch as { status?: number }).status).toBe(404);

    const patched = await patch.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('u1', 'org-a'),
        params: { id },
        body: { content: 'after' },
      }),
    );
    expect(jsonBody(patched).content).toBe('after');

    await del.handler(
      makeEndpointCtx({ db, identity: makeIdentity('u1', 'org-a'), params: { id } }),
    );
    const gone = await get.handler(
      makeEndpointCtx({ db, identity: makeIdentity('u1', 'org-a'), params: { id } }),
    );
    expect((gone as { status?: number }).status).toBe(404);
  });
});
