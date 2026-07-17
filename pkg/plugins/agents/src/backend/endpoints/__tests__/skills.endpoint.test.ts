import { describe, expect, it } from 'vitest';

import { createSkillsEndpoints } from '../skills.endpoint';
import {
  findEndpoint,
  jsonBody,
  makeEndpointCtx,
  makeFakePluginCtx,
  makeIdentity,
} from './test-helpers';

function setup() {
  const { ctx, db } = makeFakePluginCtx();
  const endpoints = createSkillsEndpoints(ctx);
  return { ctx, db, endpoints };
}

describe('skills endpoints', () => {
  it('POST /skills creates a personal skill owned by the caller', async () => {
    const { db, endpoints } = setup();
    const post = findEndpoint(endpoints, 'POST', '/agents/skills');

    const res = await post.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('u1', 'org-a'),
        body: { name: 'pr-flow', description: 'open a PR', body: 'step 1' },
      }),
    );

    expect(res.status).toBe(201);
    const created = jsonBody(res);
    expect(created.name).toBe('pr-flow');
    expect(created.scope).toBe('personal');
    expect(created.ownerId).toBe('u1');
    expect(created.orgId).toBe('org-a');
  });

  it('POST /skills validates required fields', async () => {
    const { db, endpoints } = setup();
    const post = findEndpoint(endpoints, 'POST', '/agents/skills');
    const res = await post.handler(
      makeEndpointCtx({ db, identity: makeIdentity('u1', 'org-a'), body: { name: 'x' } }),
    );
    expect(res.status).toBe(400);
  });

  it('GET /skills returns the caller’s globals + own personal, not other users’ personal', async () => {
    const { db, endpoints } = setup();
    const post = findEndpoint(endpoints, 'POST', '/agents/skills');
    const get = findEndpoint(endpoints, 'GET', '/agents/skills');

    // u1 personal, a global, and u2's personal.
    await post.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('u1', 'org-a'),
        body: { name: 'mine', description: 'd', body: 'b' },
      }),
    );
    await post.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('u1', 'org-a'),
        body: { name: 'shared', description: 'd', body: 'b', scope: 'global' },
      }),
    );
    await post.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('u2', 'org-a'),
        body: { name: 'theirs', description: 'd', body: 'b' },
      }),
    );

    const res = await get.handler(makeEndpointCtx({ db, identity: makeIdentity('u1', 'org-a') }));
    const names = (jsonBody(res).data as Array<{ name: string }>).map((s) => s.name).sort();
    expect(names).toEqual(['mine', 'shared']); // u2's "theirs" excluded
  });

  it('GET /skills/:id 404s on another user’s personal skill (no leak)', async () => {
    const { db, endpoints } = setup();
    const post = findEndpoint(endpoints, 'POST', '/agents/skills');
    const getOne = findEndpoint(endpoints, 'GET', '/agents/skills/:id');

    const created = jsonBody(
      await post.handler(
        makeEndpointCtx({
          db,
          identity: makeIdentity('u2', 'org-a'),
          body: { name: 'theirs', description: 'd', body: 'b' },
        }),
      ),
    );

    const res = await getOne.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('u1', 'org-a'),
        params: { id: created.id as string },
      }),
    );
    expect(res.status).toBe(404);
  });

  it('PATCH and DELETE round-trip on an owned skill', async () => {
    const { db, endpoints } = setup();
    const post = findEndpoint(endpoints, 'POST', '/agents/skills');
    const patch = findEndpoint(endpoints, 'PATCH', '/agents/skills/:id');
    const del = findEndpoint(endpoints, 'DELETE', '/agents/skills/:id');
    const getOne = findEndpoint(endpoints, 'GET', '/agents/skills/:id');

    const id = jsonBody(
      await post.handler(
        makeEndpointCtx({
          db,
          identity: makeIdentity('u1', 'org-a'),
          body: { name: 'edit-me', description: 'd', body: 'old' },
        }),
      ),
    ).id as string;

    const patched = jsonBody(
      await patch.handler(
        makeEndpointCtx({
          db,
          identity: makeIdentity('u1', 'org-a'),
          params: { id },
          body: { body: 'new' },
        }),
      ),
    );
    expect(patched.body).toBe('new');

    const delRes = await del.handler(
      makeEndpointCtx({ db, identity: makeIdentity('u1', 'org-a'), params: { id } }),
    );
    expect(jsonBody(delRes).success).toBe(true);

    const after = await getOne.handler(
      makeEndpointCtx({ db, identity: makeIdentity('u1', 'org-a'), params: { id } }),
    );
    expect(after.status).toBe(404);
  });
});
