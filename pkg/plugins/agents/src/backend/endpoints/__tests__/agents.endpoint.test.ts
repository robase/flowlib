import { describe, expect, it } from 'vitest';
import { createAgentsEndpoints } from '../agents.endpoint';
import {
  findEndpoint,
  jsonBody,
  makeEndpointCtx,
  makeFakePluginCtx,
  makeIdentity,
} from './test-helpers';
import type { AgentProvider } from '../../providers/types';

function makeProvider(overrides: Partial<AgentProvider> = {}): AgentProvider {
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
    ...overrides,
  };
}

describe('agents endpoints', () => {
  it('POST /agents creates an agent and returns 201', async () => {
    const provider = makeProvider();
    const { ctx, db } = makeFakePluginCtx({ providers: [provider] });
    const eps = createAgentsEndpoints(ctx);
    const post = findEndpoint(eps, 'POST', '/agents');

    const res = await post.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('user-1', 'acme'),
        body: {
          name: 'My Agent',
          providerId: 'claude-code',
          providerConfig: { foo: 'bar' },
        },
      }),
    );

    expect((res as { status?: number }).status).toBe(201);
    const body = jsonBody(res);
    expect(body.id).toBeTruthy();
    expect(body.name).toBe('My Agent');
    expect(body.orgId).toBe('acme');
    expect(body.providerId).toBe('claude-code');
    expect(body.createdBy).toBe('user-1');
  });

  it('POST /agents rejects unknown providerId with 400', async () => {
    const { ctx, db } = makeFakePluginCtx({ providers: [makeProvider()] });
    const post = findEndpoint(createAgentsEndpoints(ctx), 'POST', '/agents');
    const res = await post.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('u', 'acme'),
        body: { name: 'X', providerId: 'made-up' },
      }),
    );
    expect((res as { status?: number }).status).toBe(400);
    expect(jsonBody(res).error).toMatch(/Unknown providerId/);
  });

  it('POST /agents rejects when providerConfig validation throws', async () => {
    const provider = makeProvider({
      validateConfig: () => {
        throw new Error('config bad');
      },
    });
    const { ctx, db } = makeFakePluginCtx({ providers: [provider] });
    const post = findEndpoint(createAgentsEndpoints(ctx), 'POST', '/agents');
    const res = await post.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('u', 'acme'),
        body: { name: 'X', providerId: 'claude-code', providerConfig: {} },
      }),
    );
    expect((res as { status?: number }).status).toBe(400);
    expect(jsonBody(res).error).toMatch(/Invalid providerConfig/);
  });

  it('GET /agents lists only the caller orgs rows', async () => {
    const { ctx, db } = makeFakePluginCtx({ providers: [makeProvider()] });
    const eps = createAgentsEndpoints(ctx);
    const post = findEndpoint(eps, 'POST', '/agents');
    const list = findEndpoint(eps, 'GET', '/agents');

    await post.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('u', 'acme'),
        body: { name: 'A', providerId: 'claude-code' },
      }),
    );
    await post.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('u', 'other'),
        body: { name: 'B', providerId: 'claude-code' },
      }),
    );

    const res = await list.handler(
      makeEndpointCtx({ db, identity: makeIdentity('u', 'acme') }),
    );
    const data = (jsonBody(res).data as Array<{ name: string; orgId: string }>);
    expect(data).toHaveLength(1);
    expect(data[0]!.name).toBe('A');
    expect(data[0]!.orgId).toBe('acme');
  });

  it('GET /agents/:id returns 404 for cross-tenant access', async () => {
    const { ctx, db } = makeFakePluginCtx({ providers: [makeProvider()] });
    const eps = createAgentsEndpoints(ctx);
    const post = findEndpoint(eps, 'POST', '/agents');
    const get = findEndpoint(eps, 'GET', '/agents/:id');

    const created = await post.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('u', 'acme'),
        body: { name: 'A', providerId: 'claude-code' },
      }),
    );
    const id = (jsonBody(created).id as string);

    // Same org → finds it.
    const okRes = await get.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('u', 'acme'),
        params: { id },
      }),
    );
    expect((okRes as { status?: number }).status).toBeUndefined();

    // Different org → 404 (not 403).
    const otherRes = await get.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('u', 'other-org'),
        params: { id },
      }),
    );
    expect((otherRes as { status?: number }).status).toBe(404);
    expect(jsonBody(otherRes).error).toMatch(/not found/i);
  });

  it('PATCH /agents/:id updates fields and re-validates providerConfig', async () => {
    const provider = makeProvider({
      validateConfig: (cfg) => {
        const c = cfg as Record<string, unknown>;
        if (c.bad) throw new Error('nope');
        return c;
      },
    });
    const { ctx, db } = makeFakePluginCtx({ providers: [provider] });
    const eps = createAgentsEndpoints(ctx);
    const post = findEndpoint(eps, 'POST', '/agents');
    const patch = findEndpoint(eps, 'PATCH', '/agents/:id');

    const created = await post.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('u', 'acme'),
        body: { name: 'A', providerId: 'claude-code', providerConfig: {} },
      }),
    );
    const id = jsonBody(created).id as string;

    const ok = await patch.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('u', 'acme'),
        params: { id },
        body: { name: 'B', providerConfig: { ok: true } },
      }),
    );
    expect(jsonBody(ok).name).toBe('B');

    const fail = await patch.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('u', 'acme'),
        params: { id },
        body: { providerConfig: { bad: true } },
      }),
    );
    expect((fail as { status?: number }).status).toBe(400);
  });

  it('DELETE /agents/:id 404s cross-tenant', async () => {
    const { ctx, db } = makeFakePluginCtx({ providers: [makeProvider()] });
    const eps = createAgentsEndpoints(ctx);
    const post = findEndpoint(eps, 'POST', '/agents');
    const del = findEndpoint(eps, 'DELETE', '/agents/:id');

    const created = await post.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('u', 'acme'),
        body: { name: 'A', providerId: 'claude-code' },
      }),
    );
    const id = jsonBody(created).id as string;

    const cross = await del.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('u', 'other'),
        params: { id },
      }),
    );
    expect((cross as { status?: number }).status).toBe(404);

    const ok = await del.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('u', 'acme'),
        params: { id },
      }),
    );
    expect(jsonBody(ok).success).toBe(true);
  });
});
