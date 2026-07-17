/**
 * MCP-server REST endpoints — CRUD, validation, tenant isolation.
 */
import { describe, it, expect } from 'vitest';
import { createMcpServersEndpoints } from '../mcp-servers.endpoint';
import {
  findEndpoint,
  jsonBody,
  makeEndpointCtx,
  makeFakePluginCtx,
  makeIdentity,
} from './test-helpers';

describe('mcp-servers endpoints', () => {
  it('POST creates an http server scoped to the caller’s org', async () => {
    const { ctx, db } = makeFakePluginCtx();
    const post = findEndpoint(createMcpServersEndpoints(ctx), 'POST', '/agents/mcp-servers');
    const res = await post.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('u1', 'org-a'),
        body: {
          name: 'github',
          transport: 'http',
          config: { url: 'https://mcp.example.com' },
        },
      }),
    );
    expect((res as { status?: number }).status).toBe(201);
    const created = jsonBody(res);
    expect(created.name).toBe('github');
    expect(created.transport).toBe('http');
    expect(created.orgId).toBe('org-a');
    expect(created.createdBy).toBe('u1');
  });

  it('POST validates name + transport', async () => {
    const { ctx, db } = makeFakePluginCtx();
    const post = findEndpoint(createMcpServersEndpoints(ctx), 'POST', '/agents/mcp-servers');

    const noName = await post.handler(
      makeEndpointCtx({ db, identity: makeIdentity('u1', 'org-a'), body: { transport: 'http' } }),
    );
    expect((noName as { status?: number }).status).toBe(400);

    const badTransport = await post.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('u1', 'org-a'),
        body: { name: 'x', transport: 'carrier-pigeon' },
      }),
    );
    expect((badTransport as { status?: number }).status).toBe(400);
  });

  it('GET lists only the org’s servers', async () => {
    const { ctx, db } = makeFakePluginCtx();
    const endpoints = createMcpServersEndpoints(ctx);
    const post = findEndpoint(endpoints, 'POST', '/agents/mcp-servers');
    const list = findEndpoint(endpoints, 'GET', '/agents/mcp-servers');

    await post.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('u1', 'org-a'),
        body: { name: 'a', transport: 'http', config: { url: 'https://a' } },
      }),
    );
    await post.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('u9', 'org-b'),
        body: { name: 'b', transport: 'http', config: { url: 'https://b' } },
      }),
    );

    const res = await list.handler(makeEndpointCtx({ db, identity: makeIdentity('u1', 'org-a') }));
    const data = jsonBody(res).data as Array<{ name: string }>;
    expect(data.map((s) => s.name)).toEqual(['a']);
  });

  it('cross-tenant GET/PATCH/DELETE return 404', async () => {
    const { ctx, db } = makeFakePluginCtx();
    const endpoints = createMcpServersEndpoints(ctx);
    const post = findEndpoint(endpoints, 'POST', '/agents/mcp-servers');
    const get = findEndpoint(endpoints, 'GET', '/agents/mcp-servers/:id');
    const patch = findEndpoint(endpoints, 'PATCH', '/agents/mcp-servers/:id');
    const del = findEndpoint(endpoints, 'DELETE', '/agents/mcp-servers/:id');

    const id = jsonBody(
      await post.handler(
        makeEndpointCtx({
          db,
          identity: makeIdentity('u1', 'org-a'),
          body: { name: 'srv', transport: 'http', config: { url: 'https://x' } },
        }),
      ),
    ).id as string;

    for (const ep of [get, patch, del]) {
      const res = await ep.handler(
        makeEndpointCtx({
          db,
          identity: makeIdentity('u1', 'org-b'),
          params: { id },
          body: { name: 'hacked' },
        }),
      );
      expect((res as { status?: number }).status).toBe(404);
    }

    // DELETE under the right org returns 204
    const ok = await del.handler(
      makeEndpointCtx({ db, identity: makeIdentity('u1', 'org-a'), params: { id } }),
    );
    expect((ok as { status?: number }).status).toBe(204);
  });
});
