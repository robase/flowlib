import { describe, expect, it } from 'vitest';
import { createSessionsEndpoints } from '../sessions.endpoint';
import { createAgentsEndpoints } from '../agents.endpoint';
import {
  findEndpoint,
  jsonBody,
  makeEndpointCtx,
  makeFakePluginCtx,
  makeIdentity,
} from './test-helpers';
import type { AgentProvider } from '../../providers/types';

function provider(overrides: Partial<AgentProvider> = {}): AgentProvider {
  return {
    id: 'claude-code',
    name: 'Claude Code',
    capabilities: {
      streaming: true,
      toolUse: true,
      mcpServers: true,
      parallelToolCalls: true,
      fileEdits: true,
      resumableStream: true,
      workspaceRequired: false,
      permissionPrompts: true,
    },
    validateConfig: (cfg) =>
      cfg && typeof cfg === 'object' ? (cfg as Record<string, unknown>) : {},
    createSession: async () => ({ providerSessionId: 'ps-1' }),
    prompt: async function* () {},
    closeSession: async () => {},
    ...overrides,
  };
}

async function seedAgent(
  ctx: ReturnType<typeof makeFakePluginCtx>['ctx'],
  db: ReturnType<typeof makeFakePluginCtx>['db'],
  orgId: string,
  body: Record<string, unknown> = {},
): Promise<string> {
  const post = findEndpoint(createAgentsEndpoints(ctx), 'POST', '/agents');
  const res = await post.handler(
    makeEndpointCtx({
      db,
      identity: makeIdentity('u', orgId),
      body: {
        name: 'A',
        providerId: 'claude-code',
        ...body,
      },
    }),
  );
  return jsonBody(res).id as string;
}

describe('sessions endpoints', () => {
  it('POST /sessions creates a session and returns doAgentName', async () => {
    const { ctx, db } = makeFakePluginCtx({ providers: [provider()] });
    const agentId = await seedAgent(ctx, db, 'acme');
    const eps = createSessionsEndpoints(ctx);
    const post = findEndpoint(eps, 'POST', '/sessions');

    const res = await post.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('user-1', 'acme'),
        body: { agentId },
      }),
    );
    expect((res as { status?: number }).status).toBe(201);
    const body = jsonBody(res);
    expect(body.agentId).toBe(agentId);
    expect(body.providerSessionId).toBe('ps-1');
    expect(body.doAgentName).toBeTruthy();
    expect(body.doAgentName).toMatch(/^org:acme\/kind:chat\//);
  });

  it('POST /sessions 404 if agent belongs to a different org', async () => {
    const { ctx, db } = makeFakePluginCtx({ providers: [provider()] });
    const agentId = await seedAgent(ctx, db, 'acme');
    const post = findEndpoint(
      createSessionsEndpoints(ctx),
      'POST',
      '/sessions',
    );
    const res = await post.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('user-1', 'other'),
        body: { agentId },
      }),
    );
    expect((res as { status?: number }).status).toBe(404);
  });

  it('POST /sessions surfaces provider createSession failures as 400', async () => {
    const { ctx, db } = makeFakePluginCtx({
      providers: [
        provider({
          createSession: async () => {
            throw new Error('upstream down');
          },
        }),
      ],
    });
    const agentId = await seedAgent(ctx, db, 'acme');
    const post = findEndpoint(
      createSessionsEndpoints(ctx),
      'POST',
      '/sessions',
    );
    const res = await post.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('u', 'acme'),
        body: { agentId },
      }),
    );
    expect((res as { status?: number }).status).toBe(400);
    expect(jsonBody(res).error).toMatch(/Provider rejected/);
  });

  it('GET /sessions/:id includes doAgentName', async () => {
    const { ctx, db } = makeFakePluginCtx({ providers: [provider()] });
    const agentId = await seedAgent(ctx, db, 'acme');
    const eps = createSessionsEndpoints(ctx);
    const post = findEndpoint(eps, 'POST', '/sessions');
    const get = findEndpoint(eps, 'GET', '/sessions/:id');

    const created = await post.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('u', 'acme'),
        body: { agentId },
      }),
    );
    const id = jsonBody(created).id as string;

    const res = await get.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('u', 'acme'),
        params: { id },
      }),
    );
    const body = jsonBody(res);
    expect(body.id).toBe(id);
    expect(body.doAgentName).toMatch(/^org:acme\/kind:chat\//);
  });

  it('GET /sessions returns only the caller orgs sessions', async () => {
    const { ctx, db } = makeFakePluginCtx({ providers: [provider()] });
    const agentId = await seedAgent(ctx, db, 'acme');
    const otherAgentId = await seedAgent(ctx, db, 'other');
    const eps = createSessionsEndpoints(ctx);
    const post = findEndpoint(eps, 'POST', '/sessions');
    const list = findEndpoint(eps, 'GET', '/sessions');

    await post.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('u', 'acme'),
        body: { agentId },
      }),
    );
    await post.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('u', 'other'),
        body: { agentId: otherAgentId },
      }),
    );

    const res = await list.handler(
      makeEndpointCtx({ db, identity: makeIdentity('u', 'acme') }),
    );
    const data = jsonBody(res).data as Array<{ orgId: string }>;
    expect(data).toHaveLength(1);
    expect(data[0]!.orgId).toBe('acme');
  });

  it('PATCH /sessions/:id updates title and visibility', async () => {
    const { ctx, db } = makeFakePluginCtx({ providers: [provider()] });
    const agentId = await seedAgent(ctx, db, 'acme');
    const eps = createSessionsEndpoints(ctx);
    const post = findEndpoint(eps, 'POST', '/sessions');
    const patch = findEndpoint(eps, 'PATCH', '/sessions/:id');

    const created = await post.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('u', 'acme'),
        body: { agentId },
      }),
    );
    const id = jsonBody(created).id as string;

    const res = await patch.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('u', 'acme'),
        params: { id },
        body: { title: 'renamed', visibility: 'shared' },
      }),
    );
    const body = jsonBody(res);
    expect(body.title).toBe('renamed');
    expect(body.visibility).toBe('shared');
    expect(body.doAgentName).toBeTruthy();
  });

  it('DELETE /sessions/:id archives row and calls provider.closeSession', async () => {
    const calls: string[] = [];
    const { ctx, db } = makeFakePluginCtx({
      providers: [
        provider({
          closeSession: async (id) => {
            calls.push(id);
          },
        }),
      ],
    });
    const agentId = await seedAgent(ctx, db, 'acme');
    const eps = createSessionsEndpoints(ctx);
    const post = findEndpoint(eps, 'POST', '/sessions');
    const del = findEndpoint(eps, 'DELETE', '/sessions/:id');
    const get = findEndpoint(eps, 'GET', '/sessions/:id');

    const created = await post.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('u', 'acme'),
        body: { agentId },
      }),
    );
    const id = jsonBody(created).id as string;

    const res = await del.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('u', 'acme'),
        params: { id },
      }),
    );
    expect(jsonBody(res).status).toBe('archived');
    expect(calls).toEqual(['ps-1']);

    const after = await get.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('u', 'acme'),
        params: { id },
      }),
    );
    expect(jsonBody(after).status).toBe('archived');
  });

  it('POST /sessions/:id/prompt returns 501 with WebSocket hint', async () => {
    const { ctx, db } = makeFakePluginCtx({ providers: [provider()] });
    const agentId = await seedAgent(ctx, db, 'acme');
    const eps = createSessionsEndpoints(ctx);
    const post = findEndpoint(eps, 'POST', '/sessions');
    const prompt = findEndpoint(eps, 'POST', '/sessions/:id/prompt');

    const created = await post.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('u', 'acme'),
        body: { agentId },
      }),
    );
    const id = jsonBody(created).id as string;

    const res = await prompt.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('u', 'acme'),
        params: { id },
      }),
    );
    expect((res as { status?: number }).status).toBe(501);
    const body = jsonBody(res);
    expect(body.error).toMatch(/HTTP prompt is not implemented/);
    expect((body.hint as Record<string, unknown>).transport).toBe('websocket');
    expect((body.hint as Record<string, unknown>).doAgentName).toMatch(
      /^org:acme\/kind:chat\//,
    );
  });

  it('POST /sessions/:id/interrupt returns 501 when DO runtime is not registered', async () => {
    const { ctx, db } = makeFakePluginCtx({ providers: [provider()] });
    const agentId = await seedAgent(ctx, db, 'acme');
    const eps = createSessionsEndpoints(ctx);
    const post = findEndpoint(eps, 'POST', '/sessions');
    const interrupt = findEndpoint(eps, 'POST', '/sessions/:id/interrupt');

    const created = await post.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('u', 'acme'),
        body: { agentId },
      }),
    );
    const id = jsonBody(created).id as string;

    const res = await interrupt.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('u', 'acme'),
        params: { id },
      }),
    );
    expect((res as { status?: number }).status).toBe(501);
    expect(jsonBody(res).hint).toBeTruthy();
  });

  it('POST /sessions/:id/interrupt returns instructions when DO runtime is registered', async () => {
    const { ctx, db } = makeFakePluginCtx({ providers: [provider()] });
    ctx.registries.cloudflareDoClass = class {} as unknown;
    const agentId = await seedAgent(ctx, db, 'acme');
    const eps = createSessionsEndpoints(ctx);
    const post = findEndpoint(eps, 'POST', '/sessions');
    const interrupt = findEndpoint(eps, 'POST', '/sessions/:id/interrupt');

    const created = await post.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('u', 'acme'),
        body: { agentId },
      }),
    );
    const id = jsonBody(created).id as string;

    const res = await interrupt.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('u', 'acme'),
        params: { id },
      }),
    );
    expect((res as { status?: number }).status).toBeUndefined();
    const body = jsonBody(res);
    expect(body.status).toBe('interrupt-requested');
    expect(body.doAgentName).toMatch(/^org:acme\/kind:chat\//);
    expect((body.message as Record<string, unknown>).type).toBe('interrupt');
  });

  it('GET /sessions/:id/messages paginates by sequence', async () => {
    const { ctx, db } = makeFakePluginCtx({ providers: [provider()] });
    const agentId = await seedAgent(ctx, db, 'acme');
    const eps = createSessionsEndpoints(ctx);
    const post = findEndpoint(eps, 'POST', '/sessions');
    const list = findEndpoint(eps, 'GET', '/sessions/:id/messages');

    const created = await post.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('u', 'acme'),
        body: { agentId },
      }),
    );
    const id = jsonBody(created).id as string;

    // Insert messages directly via the repositories factory.
    const factory = ctx.registries.repositories as (
      d: typeof db,
    ) => { messages: { create: (input: unknown) => Promise<unknown> } };
    const repos = factory(db);
    for (let i = 1; i <= 5; i++) {
      await repos.messages.create({
        orgId: 'acme',
        sessionId: id,
        sequence: i,
        role: 'user',
        parts: [{ type: 'text', text: `m${i}` }],
      } as unknown as never);
    }

    const all = await list.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('u', 'acme'),
        params: { id },
      }),
    );
    const data = jsonBody(all).data as Array<{ sequence: number }>;
    expect(data).toHaveLength(5);

    const before3 = await list.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('u', 'acme'),
        params: { id },
        query: { before: '3' },
      }),
    );
    const sliced = jsonBody(before3).data as Array<{ sequence: number }>;
    expect(sliced.map((m) => m.sequence)).toEqual([1, 2]);
  });
});
