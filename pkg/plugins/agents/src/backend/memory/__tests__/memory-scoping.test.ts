/**
 * Regression tests for the memory scoping fixes.
 *
 * Two defects, both of which let a memory escape the scope it was
 * authored under:
 *
 *  1. `MemoryAdapter.get`/`delete` guarded on `orgId` alone while every
 *     other read path (`search`, `getAll`, `existsByHash`) used
 *     `scopeMatches` — so an org-mate could read or destroy another
 *     user's personal memory by id.
 *  2. `PATCH /memories/:id` passed `scope` through without touching
 *     `user_id`, so a `global` → `personal` flip produced a row matching
 *     neither branch of `listForScope` — invisible forever.
 *
 * NOTE (placement): the endpoint-level suite below would sit more
 * naturally next to `endpoints/__tests__/memories.endpoint.test.ts`. It
 * lives here because this fix's author owned only `memory/__tests__/`;
 * fold it into the endpoint suite when convenient.
 */

import { describe, expect, it } from 'vitest';

import { createInMemoryBackend } from '../in-memory-backend';
import { createMemoryAdapter } from '../create-memory-adapter';
import type { MemoryLlm } from '../types';
import { createMemoriesEndpoints } from '../../endpoints/memories.endpoint';
import {
  findEndpoint,
  jsonBody,
  makeEndpointCtx,
  makeFakePluginCtx,
  makeIdentity,
} from '../../endpoints/__tests__/test-helpers';

/** Vectors are irrelevant to scope filtering — a constant unit vector is enough. */
function fakeEmbed(texts: string[]): Promise<number[][]> {
  return Promise.resolve(texts.map(() => [1, 0, 0, 0]));
}

function queuedLlm(queue: unknown[]): MemoryLlm {
  return {
    json: async () => {
      if (queue.length === 0) {
        throw new Error('fake llm: queue exhausted (unexpected extra call)');
      }
      return queue.shift() as never;
    },
  };
}

function counterIds(): () => string {
  let n = 0;
  return () => `mem-${++n}`;
}

function makeAdapter(backend: ReturnType<typeof createInMemoryBackend>) {
  return createMemoryAdapter({
    backend,
    embed: fakeEmbed,
    llm: queuedLlm([]),
    now: () => 't',
    generateId: counterIds(),
  });
}

describe('MemoryAdapter.get/delete honour the full scope, not just orgId', () => {
  it('does not let another user in the same org read a personal memory by id', async () => {
    const backend = createInMemoryBackend();
    const adapter = makeAdapter(backend);
    const [mem] = await adapter.add({
      messages: 'u1 only',
      scope: { orgId: 'org-a', userId: 'u1' },
      infer: false,
    });

    // Same org, different user — the id is guessable, the memory is not.
    expect(await adapter.get(mem.id, { orgId: 'org-a', userId: 'u2' })).toBeNull();
    // An org-wide query with no userId must not see a user-owned memory either.
    expect(await adapter.get(mem.id, { orgId: 'org-a' })).toBeNull();
    // The owner still can.
    expect(await adapter.get(mem.id, { orgId: 'org-a', userId: 'u1' })).not.toBeNull();
  });

  it('does not let another user in the same org delete a personal memory by id', async () => {
    const backend = createInMemoryBackend();
    const adapter = makeAdapter(backend);
    const [mem] = await adapter.add({
      messages: 'u1 only',
      scope: { orgId: 'org-a', userId: 'u1' },
      infer: false,
    });

    await adapter.delete(mem.id, { orgId: 'org-a', userId: 'u2' });
    expect(backend._size()).toBe(1);
    expect(await adapter.get(mem.id, { orgId: 'org-a', userId: 'u1' })).not.toBeNull();

    // The owner's delete goes through.
    await adapter.delete(mem.id, { orgId: 'org-a', userId: 'u1' });
    expect(backend._size()).toBe(0);
  });

  it('scopes get/delete by projectId as well as userId', async () => {
    const backend = createInMemoryBackend();
    const adapter = makeAdapter(backend);
    const [mem] = await adapter.add({
      messages: 'project p1 note',
      scope: { orgId: 'org-a', projectId: 'p1' },
      infer: false,
    });

    expect(await adapter.get(mem.id, { orgId: 'org-a', projectId: 'p2' })).toBeNull();
    await adapter.delete(mem.id, { orgId: 'org-a', projectId: 'p2' });
    expect(backend._size()).toBe(1);

    expect(await adapter.get(mem.id, { orgId: 'org-a', projectId: 'p1' })).not.toBeNull();
  });

  it('still isolates across orgs', async () => {
    const backend = createInMemoryBackend();
    const adapter = makeAdapter(backend);
    const [mem] = await adapter.add({
      messages: 'secret',
      scope: { orgId: 'org-a', userId: 'u1' },
      infer: false,
    });

    expect(await adapter.get(mem.id, { orgId: 'org-b', userId: 'u1' })).toBeNull();
    await adapter.delete(mem.id, { orgId: 'org-b', userId: 'u1' });
    expect(backend._size()).toBe(1);
  });
});

describe('PATCH /memories/:id keeps userId consistent with scope', () => {
  /** Author a memory as `userId` and return its id. */
  async function create(
    ctx: ReturnType<typeof makeFakePluginCtx>['ctx'],
    db: ReturnType<typeof makeFakePluginCtx>['db'],
    userId: string,
    body: Record<string, unknown>,
  ): Promise<string> {
    const post = findEndpoint(createMemoriesEndpoints(ctx), 'POST', '/agents/memories');
    const res = await post.handler(
      makeEndpointCtx({ db, identity: makeIdentity(userId, 'org-a'), body }),
    );
    return jsonBody(res).id as string;
  }

  it('global → personal adopts the caller as owner and stays listable', async () => {
    const { ctx, db } = makeFakePluginCtx();
    const endpoints = createMemoriesEndpoints(ctx);
    const patch = findEndpoint(endpoints, 'PATCH', '/agents/memories/:id');
    const list = findEndpoint(endpoints, 'GET', '/agents/memories');

    const id = await create(ctx, db, 'u1', { content: 'note', scope: 'global' });

    const patched = jsonBody(
      await patch.handler(
        makeEndpointCtx({
          db,
          identity: makeIdentity('u1', 'org-a'),
          params: { id },
          body: { scope: 'personal' },
        }),
      ),
    );
    expect(patched.scope).toBe('personal');
    // The bug: this stayed null, orphaning the row.
    expect(patched.userId).toBe('u1');

    // It must still come back from the list the agent's prompt is built from.
    const listed = jsonBody(
      await list.handler(makeEndpointCtx({ db, identity: makeIdentity('u1', 'org-a') })),
    ).data as Array<{ id: string }>;
    expect(listed.map((m) => m.id)).toContain(id);
  });

  it('personal → global clears the owner and becomes visible org-wide', async () => {
    const { ctx, db } = makeFakePluginCtx();
    const endpoints = createMemoriesEndpoints(ctx);
    const patch = findEndpoint(endpoints, 'PATCH', '/agents/memories/:id');
    const list = findEndpoint(endpoints, 'GET', '/agents/memories');

    const id = await create(ctx, db, 'u1', { content: 'note', scope: 'personal' });

    const patched = jsonBody(
      await patch.handler(
        makeEndpointCtx({
          db,
          identity: makeIdentity('u1', 'org-a'),
          params: { id },
          body: { scope: 'global' },
        }),
      ),
    );
    expect(patched.scope).toBe('global');
    expect(patched.userId).toBeNull();

    // A different user in the org now sees it.
    const listed = jsonBody(
      await list.handler(makeEndpointCtx({ db, identity: makeIdentity('u2', 'org-a') })),
    ).data as Array<{ id: string }>;
    expect(listed.map((m) => m.id)).toContain(id);
  });

  it('personal → project moves ownership to the project and stays listable', async () => {
    const { ctx, db } = makeFakePluginCtx();
    const endpoints = createMemoriesEndpoints(ctx);
    const patch = findEndpoint(endpoints, 'PATCH', '/agents/memories/:id');
    const list = findEndpoint(endpoints, 'GET', '/agents/memories');

    const id = await create(ctx, db, 'u1', { content: 'note', scope: 'personal' });

    const patched = jsonBody(
      await patch.handler(
        makeEndpointCtx({
          db,
          identity: makeIdentity('u1', 'org-a'),
          params: { id },
          body: { scope: 'project', projectId: 'p1' },
        }),
      ),
    );
    expect(patched.scope).toBe('project');
    expect(patched.projectId).toBe('p1');
    expect(patched.userId).toBeNull();

    const listed = jsonBody(
      await list.handler(
        makeEndpointCtx({ db, identity: makeIdentity('u1', 'org-a'), query: { projectId: 'p1' } }),
      ),
    ).data as Array<{ id: string }>;
    expect(listed.map((m) => m.id)).toContain(id);
  });

  it('rejects a flip to project scope with no projectId rather than orphaning the row', async () => {
    const { ctx, db } = makeFakePluginCtx();
    const endpoints = createMemoriesEndpoints(ctx);
    const patch = findEndpoint(endpoints, 'PATCH', '/agents/memories/:id');

    const id = await create(ctx, db, 'u1', { content: 'note', scope: 'personal' });

    const res = await patch.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('u1', 'org-a'),
        params: { id },
        body: { scope: 'project' },
      }),
    );
    expect((res as { status?: number }).status).toBe(400);
  });

  it('a content-only PATCH leaves scope and owner untouched', async () => {
    const { ctx, db } = makeFakePluginCtx();
    const endpoints = createMemoriesEndpoints(ctx);
    const patch = findEndpoint(endpoints, 'PATCH', '/agents/memories/:id');

    const id = await create(ctx, db, 'u1', { content: 'before', scope: 'personal' });

    const patched = jsonBody(
      await patch.handler(
        makeEndpointCtx({
          db,
          identity: makeIdentity('u1', 'org-a'),
          params: { id },
          body: { content: 'after' },
        }),
      ),
    );
    expect(patched.content).toBe('after');
    expect(patched.scope).toBe('personal');
    expect(patched.userId).toBe('u1');
  });
});
