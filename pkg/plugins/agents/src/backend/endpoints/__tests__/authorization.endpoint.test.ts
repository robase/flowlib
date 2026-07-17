/**
 * Authorization regressions for the agents-plugin endpoints.
 *
 * Each block pins one previously-exploitable gap:
 *
 *  1. `POST /sessions/:id/control` performed no session lookup at all —
 *     a leaked session id let any caller abort another tenant's turn or
 *     answer its pending permission / ask_user gate.
 *  2. Session routes scoped only by `orgId`, ignoring `visibility` +
 *     `createdBy`, so any org member could read/mutate/delete another
 *     member's `private` session.
 *  3. `POST /workspaces` honoured a client-supplied `id`, which both
 *     sandbox providers use to derive container identity.
 *  4. `?limit=abc` produced `slice(-NaN)` → `slice(0)`, returning the
 *     whole message history and defeating the 200 cap.
 */
import { describe, expect, it } from 'vitest';
import { createSessionsEndpoints } from '../sessions.endpoint';
import { createChatStreamEndpoints } from '../chat-stream.endpoint';
import { createWorkspacesEndpoints } from '../workspaces.endpoint';
import { buildRepositories } from '../../repositories/register';
import {
  findEndpoint,
  jsonBody,
  makeEndpointCtx,
  makeFakePluginCtx,
  makeIdentity,
} from './test-helpers';
import type { AgentVisibility } from '../../../shared/types';
import type { WorkspaceHandle, WorkspaceProvider } from '../../workspaces/types';

type Db = ReturnType<typeof makeFakePluginCtx>['db'];

const status = (res: unknown): number | undefined => (res as { status?: number }).status;

/** Seed a session row directly — bypasses provider wiring we don't need. */
async function seedSession(
  db: Db,
  args: { orgId: string; createdBy: string; visibility?: AgentVisibility },
) {
  const repos = buildRepositories(db);
  const session = await repos.sessions.create({
    orgId: args.orgId,
    providerSessionId: `ps-${args.createdBy}`,
    providerId: 'ai-sdk',
    createdBy: args.createdBy,
    visibility: args.visibility ?? 'private',
  });
  return { sessionId: session.id, repos };
}

describe('POST /sessions/:id/control — authorization', () => {
  /** Every control frame type must be gated, not just interrupt. */
  const frames = [
    { type: 'flowlib.interrupt' },
    { type: 'flowlib.permission-response', id: 'perm-1', decision: 'allow' },
    { type: 'flowlib.hil-response', id: 'hil-1', response: 'yes' },
  ];

  it.each(frames)('404s cross-tenant for $type', async (body) => {
    const { ctx, db } = makeFakePluginCtx();
    const { sessionId } = await seedSession(db, { orgId: 'org-a', createdBy: 'u1' });
    const control = findEndpoint(
      createChatStreamEndpoints(ctx),
      'POST',
      '/agents/sessions/:id/control',
    );

    const res = await control.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('attacker', 'org-b'),
        params: { id: sessionId },
        body,
      }),
    );

    // 404 — not 409 ("no active turn"), which would confirm the session
    // exists and leak it across tenants.
    expect(status(res)).toBe(404);
    expect(jsonBody(res).error).toMatch(/not found/i);
  });

  it('404s for another members private session in the same org', async () => {
    const { ctx, db } = makeFakePluginCtx();
    const { sessionId } = await seedSession(db, { orgId: 'org-a', createdBy: 'owner' });
    const control = findEndpoint(
      createChatStreamEndpoints(ctx),
      'POST',
      '/agents/sessions/:id/control',
    );

    const res = await control.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('coworker', 'org-a'),
        params: { id: sessionId },
        body: { type: 'flowlib.interrupt' },
      }),
    );
    expect(status(res)).toBe(404);
  });

  it('404s for an unknown session id', async () => {
    const { ctx, db } = makeFakePluginCtx();
    const control = findEndpoint(
      createChatStreamEndpoints(ctx),
      'POST',
      '/agents/sessions/:id/control',
    );
    const res = await control.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('u1', 'org-a'),
        params: { id: 'nope' },
        body: { type: 'flowlib.interrupt' },
      }),
    );
    expect(status(res)).toBe(404);
  });

  it('lets the owner through to the turn registry (409, not 404)', async () => {
    // The owner passes authorization and reaches the activeTurns lookup,
    // which reports "no active turn". This is the discriminator proving
    // the new session lookup gates on identity rather than rejecting
    // everyone — the cross-tenant cases above 404 *before* this point.
    const { ctx, db } = makeFakePluginCtx();
    const { sessionId } = await seedSession(db, { orgId: 'org-a', createdBy: 'u1' });
    const control = findEndpoint(
      createChatStreamEndpoints(ctx),
      'POST',
      '/agents/sessions/:id/control',
    );

    const res = await control.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('u1', 'org-a'),
        params: { id: sessionId },
        body: { type: 'flowlib.interrupt' },
      }),
    );
    expect(status(res)).toBe(409);
    expect(jsonBody(res).error).toMatch(/no active turn/i);
  });
});

describe('session visibility — isolation between members of one org', () => {
  const owner = () => makeIdentity('owner', 'org-a');
  const coworker = () => makeIdentity('coworker', 'org-a');

  it('GET /sessions hides another members private session but shows shared ones', async () => {
    const { ctx, db } = makeFakePluginCtx();
    await seedSession(db, { orgId: 'org-a', createdBy: 'owner', visibility: 'private' });
    await seedSession(db, { orgId: 'org-a', createdBy: 'owner2', visibility: 'shared' });
    const list = findEndpoint(createSessionsEndpoints(ctx), 'GET', '/agents/sessions');

    const asCoworker = jsonBody(await list.handler(makeEndpointCtx({ db, identity: coworker() })))
      .data as Array<{ createdBy: string; visibility: string }>;
    expect(asCoworker).toHaveLength(1);
    expect(asCoworker[0]!.visibility).toBe('shared');

    // The owner still sees their own private session plus the shared one.
    const asOwner = jsonBody(await list.handler(makeEndpointCtx({ db, identity: owner() })))
      .data as unknown[];
    expect(asOwner).toHaveLength(2);
  });

  it('GET/PATCH/DELETE /sessions/:id 404 for a non-owner private session', async () => {
    const { ctx, db } = makeFakePluginCtx();
    const { sessionId } = await seedSession(db, { orgId: 'org-a', createdBy: 'owner' });
    const eps = createSessionsEndpoints(ctx);

    const get = await findEndpoint(eps, 'GET', '/agents/sessions/:id').handler(
      makeEndpointCtx({ db, identity: coworker(), params: { id: sessionId } }),
    );
    expect(status(get)).toBe(404);

    const patch = await findEndpoint(eps, 'PATCH', '/agents/sessions/:id').handler(
      makeEndpointCtx({
        db,
        identity: coworker(),
        params: { id: sessionId },
        body: { title: 'pwned' },
      }),
    );
    expect(status(patch)).toBe(404);

    const del = await findEndpoint(eps, 'DELETE', '/agents/sessions/:id').handler(
      makeEndpointCtx({ db, identity: coworker(), params: { id: sessionId } }),
    );
    expect(status(del)).toBe(404);

    // The rejected PATCH/DELETE must not have mutated the row.
    const stillThere = await buildRepositories(db).sessions.findById(sessionId, 'org-a');
    expect(stillThere?.title).toBe('New chat');
    expect(stillThere?.status).toBe('active');
  });

  it('GET /sessions/:id/messages and /plan 404 for a non-owner private session', async () => {
    const { ctx, db } = makeFakePluginCtx();
    const { sessionId, repos } = await seedSession(db, { orgId: 'org-a', createdBy: 'owner' });
    await repos.messages.create({
      orgId: 'org-a',
      sessionId,
      sequence: 1,
      role: 'user',
      parts: [{ type: 'text', text: 'secret' }],
    });
    const eps = createSessionsEndpoints(ctx);

    const messages = await findEndpoint(eps, 'GET', '/agents/sessions/:id/messages').handler(
      makeEndpointCtx({ db, identity: coworker(), params: { id: sessionId } }),
    );
    expect(status(messages)).toBe(404);

    const plan = await findEndpoint(eps, 'GET', '/agents/sessions/:id/plan').handler(
      makeEndpointCtx({ db, identity: coworker(), params: { id: sessionId } }),
    );
    expect(status(plan)).toBe(404);
  });

  it('allows a co-worker to read a shared session', async () => {
    const { ctx, db } = makeFakePluginCtx();
    const { sessionId } = await seedSession(db, {
      orgId: 'org-a',
      createdBy: 'owner',
      visibility: 'shared',
    });
    const get = findEndpoint(createSessionsEndpoints(ctx), 'GET', '/agents/sessions/:id');
    const res = await get.handler(
      makeEndpointCtx({ db, identity: coworker(), params: { id: sessionId } }),
    );
    expect(jsonBody(res).id).toBe(sessionId);
  });

  it('allows the owner to read their own private session', async () => {
    const { ctx, db } = makeFakePluginCtx();
    const { sessionId } = await seedSession(db, { orgId: 'org-a', createdBy: 'owner' });
    const get = findEndpoint(createSessionsEndpoints(ctx), 'GET', '/agents/sessions/:id');
    const res = await get.handler(
      makeEndpointCtx({ db, identity: owner(), params: { id: sessionId } }),
    );
    expect(jsonBody(res).id).toBe(sessionId);
  });
});

describe('POST /workspaces — client-supplied id', () => {
  function fakeProvider(): { provider: WorkspaceProvider; created: string[] } {
    const created: string[] = [];
    const handle: WorkspaceHandle = {
      id: 'placeholder',
      exec: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
      readFile: async () => '',
      writeFile: async () => {},
      listFiles: async () => [],
      metadata: {},
    };
    return {
      created,
      provider: {
        id: 'cloudflare-sandbox',
        name: 'Cloudflare Sandbox',
        create: async (input) => {
          created.push(input.workspaceId);
          return { ...handle, id: input.workspaceId };
        },
        resolve: async (id) => ({ ...handle, id }),
        destroy: async () => {},
      },
    };
  }

  it('rejects a body-supplied id and never reaches the sandbox provider', async () => {
    const { provider, created } = fakeProvider();
    const { ctx, db } = makeFakePluginCtx({ workspaceProvider: provider });
    const post = findEndpoint(createWorkspacesEndpoints(ctx), 'POST', '/agents/workspaces');

    // The attack: a victim's workspace id, whose container the cloudflare
    // provider addresses by that very id.
    const victimId = '11111111-2222-3333-4444-555555555555';
    const res = await post.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('attacker', 'org-b'),
        body: { name: 'WS', id: victimId },
      }),
    );

    expect(status(res)).toBe(400);
    expect(jsonBody(res).error).toMatch(/server-generated/i);
    // Provider.create() must not have been called with the chosen id —
    // otherwise the container is attached before the row is written.
    expect(created).toEqual([]);
  });

  it('server-generates a UUID id on a normal create', async () => {
    const { provider, created } = fakeProvider();
    const { ctx, db } = makeFakePluginCtx({ workspaceProvider: provider });
    const post = findEndpoint(createWorkspacesEndpoints(ctx), 'POST', '/agents/workspaces');

    const res = await post.handler(
      makeEndpointCtx({ db, identity: makeIdentity('u', 'acme'), body: { name: 'WS' } }),
    );
    expect(status(res)).toBe(201);
    const id = jsonBody(res).id as string;
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(created).toEqual([id]);
  });
});

describe('GET /sessions/:id/messages — ?limit= clamping', () => {
  async function seedMessages(db: Db, sessionId: string, count: number) {
    const repos = buildRepositories(db);
    for (let i = 1; i <= count; i++) {
      await repos.messages.create({
        orgId: 'org-a',
        sessionId,
        sequence: i,
        role: 'user',
        parts: [{ type: 'text', text: `m${i}` }],
      });
    }
  }

  async function fetchWithLimit(limit: string | undefined) {
    const { ctx, db } = makeFakePluginCtx();
    const { sessionId } = await seedSession(db, { orgId: 'org-a', createdBy: 'u1' });
    await seedMessages(db, sessionId, 250);
    const get = findEndpoint(createSessionsEndpoints(ctx), 'GET', '/agents/sessions/:id/messages');
    const res = await get.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('u1', 'org-a'),
        params: { id: sessionId },
        query: limit === undefined ? {} : { limit },
      }),
    );
    return jsonBody(res);
  }

  it('falls back to the default of 50 for non-numeric input', async () => {
    // Before the fix: Number('abc') → NaN, the Math.min/max clamp was a
    // no-op, and slice(-NaN) → slice(0) returned all 250 messages.
    const body = await fetchWithLimit('abc');
    expect((body.data as unknown[]).length).toBe(50);
    expect((body.pagination as { limit: number }).limit).toBe(50);
  });

  it.each(['Infinity', '-Infinity', 'NaN', ''])('rejects %s back to the default', async (raw) => {
    const body = await fetchWithLimit(raw);
    expect((body.data as unknown[]).length).toBe(50);
  });

  it('caps an over-large limit at 200', async () => {
    const body = await fetchWithLimit('5000');
    expect((body.data as unknown[]).length).toBe(200);
    expect((body.pagination as { limit: number }).limit).toBe(200);
  });

  it('floors a limit below 1 at 1', async () => {
    const body = await fetchWithLimit('0');
    expect((body.data as unknown[]).length).toBe(1);
  });

  it('honours a valid in-range limit', async () => {
    const body = await fetchWithLimit('5');
    expect((body.data as unknown[]).length).toBe(5);
  });

  it('defaults to 50 when no limit is supplied', async () => {
    const body = await fetchWithLimit(undefined);
    expect((body.data as unknown[]).length).toBe(50);
  });
});
