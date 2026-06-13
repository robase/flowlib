import { describe, expect, it } from 'vitest';
import { createWorkspacesEndpoints } from '../workspaces.endpoint';
import { createFilesEndpoints } from '../files.endpoint';
import {
  findEndpoint,
  jsonBody,
  makeEndpointCtx,
  makeFakePluginCtx,
  makeIdentity,
} from './test-helpers';
import type { WorkspaceHandle, WorkspaceProvider } from '../../workspaces/types';

interface ProviderCalls {
  create: number;
  destroy: number;
  resolve: number;
}

function fakeProvider(): {
  provider: WorkspaceProvider;
  calls: ProviderCalls;
  failNext?: 'create';
  setFailNext: (mode: 'create' | undefined) => void;
} {
  const calls: ProviderCalls = { create: 0, destroy: 0, resolve: 0 };
  let failNext: 'create' | undefined;
  const handle: WorkspaceHandle = {
    id: 'placeholder',
    exec: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
    readFile: async (path) => `contents of ${path}`,
    writeFile: async () => {},
    listFiles: async (glob) => [`${glob}/a.ts`, `${glob}/b.ts`],
    metadata: {},
  };
  const provider: WorkspaceProvider = {
    id: 'cloudflare-sandbox',
    name: 'Cloudflare Sandbox',
    create: async (input) => {
      calls.create++;
      if (failNext === 'create') {
        throw new Error('boom');
      }
      return { ...handle, id: input.workspaceId };
    },
    resolve: async (id) => {
      calls.resolve++;
      return { ...handle, id };
    },
    destroy: async () => {
      calls.destroy++;
    },
  };
  return {
    provider,
    calls,
    setFailNext: (m) => {
      failNext = m;
    },
  };
}

describe('workspaces endpoints', () => {
  it('POST /workspaces creates and persists a workspace', async () => {
    const { provider, calls } = fakeProvider();
    const { ctx, db } = makeFakePluginCtx({ workspaceProvider: provider });
    const post = findEndpoint(createWorkspacesEndpoints(ctx), 'POST', '/agents/workspaces');

    const res = await post.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('u', 'acme'),
        body: { name: 'WS' },
      }),
    );
    expect((res as { status?: number }).status).toBe(201);
    const body = jsonBody(res);
    expect(body.name).toBe('WS');
    expect(body.workspaceProviderId).toBe('cloudflare-sandbox');
    expect(body.orgId).toBe('acme');
    expect(calls.create).toBe(1);
  });

  it('POST /workspaces 400s when provider create() throws', async () => {
    const { provider, setFailNext } = fakeProvider();
    setFailNext('create');
    const { ctx, db } = makeFakePluginCtx({ workspaceProvider: provider });
    const post = findEndpoint(createWorkspacesEndpoints(ctx), 'POST', '/agents/workspaces');

    const res = await post.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('u', 'acme'),
        body: { name: 'WS' },
      }),
    );
    expect((res as { status?: number }).status).toBe(400);
    expect(jsonBody(res).error).toMatch(/Workspace provider rejected/);
  });

  it('POST /workspaces 400s when no provider is configured', async () => {
    const { ctx, db } = makeFakePluginCtx();
    const post = findEndpoint(createWorkspacesEndpoints(ctx), 'POST', '/agents/workspaces');
    const res = await post.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('u', 'acme'),
        body: { name: 'WS' },
      }),
    );
    expect((res as { status?: number }).status).toBe(400);
  });

  it('GET /workspaces only returns the caller orgs rows', async () => {
    const { provider } = fakeProvider();
    const { ctx, db } = makeFakePluginCtx({ workspaceProvider: provider });
    const eps = createWorkspacesEndpoints(ctx);
    const post = findEndpoint(eps, 'POST', '/agents/workspaces');
    const list = findEndpoint(eps, 'GET', '/agents/workspaces');

    await post.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('u', 'acme'),
        body: { name: 'A' },
      }),
    );
    await post.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('u', 'other'),
        body: { name: 'B' },
      }),
    );

    const res = await list.handler(makeEndpointCtx({ db, identity: makeIdentity('u', 'acme') }));
    const data = jsonBody(res).data as Array<{ name: string; orgId: string }>;
    expect(data).toHaveLength(1);
    expect(data[0]!.name).toBe('A');
  });

  it('GET /workspaces/:id returns 404 cross-tenant', async () => {
    const { provider } = fakeProvider();
    const { ctx, db } = makeFakePluginCtx({ workspaceProvider: provider });
    const eps = createWorkspacesEndpoints(ctx);
    const post = findEndpoint(eps, 'POST', '/agents/workspaces');
    const get = findEndpoint(eps, 'GET', '/agents/workspaces/:id');

    const created = await post.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('u', 'acme'),
        body: { name: 'A' },
      }),
    );
    const id = jsonBody(created).id as string;

    const res = await get.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('u', 'other'),
        params: { id },
      }),
    );
    expect((res as { status?: number }).status).toBe(404);
  });

  it('DELETE /workspaces/:id calls provider.destroy and removes the row', async () => {
    const { provider, calls } = fakeProvider();
    const { ctx, db } = makeFakePluginCtx({ workspaceProvider: provider });
    const eps = createWorkspacesEndpoints(ctx);
    const post = findEndpoint(eps, 'POST', '/agents/workspaces');
    const del = findEndpoint(eps, 'DELETE', '/agents/workspaces/:id');
    const get = findEndpoint(eps, 'GET', '/agents/workspaces/:id');

    const created = await post.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('u', 'acme'),
        body: { name: 'A' },
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
    expect(jsonBody(res).success).toBe(true);
    expect(calls.destroy).toBe(1);

    const after = await get.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('u', 'acme'),
        params: { id },
      }),
    );
    expect((after as { status?: number }).status).toBe(404);
  });

  it('GET /workspaces/:id/files lists files via the workspace handle', async () => {
    const { provider, calls } = fakeProvider();
    const { ctx, db } = makeFakePluginCtx({ workspaceProvider: provider });
    const post = findEndpoint(createWorkspacesEndpoints(ctx), 'POST', '/agents/workspaces');
    const list = findEndpoint(createFilesEndpoints(ctx), 'GET', '/agents/workspaces/:id/files');

    const created = await post.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('u', 'acme'),
        body: { name: 'A' },
      }),
    );
    const id = jsonBody(created).id as string;

    const res = await list.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('u', 'acme'),
        params: { id },
        query: { q: '**/*.ts' },
      }),
    );
    const data = jsonBody(res).data as string[];
    expect(data).toContain('**/*.ts/a.ts');
    expect(calls.resolve).toBe(1);
  });

  it('GET /workspaces/:id/files/read returns file contents', async () => {
    const { provider } = fakeProvider();
    const { ctx, db } = makeFakePluginCtx({ workspaceProvider: provider });
    const post = findEndpoint(createWorkspacesEndpoints(ctx), 'POST', '/agents/workspaces');
    const read = findEndpoint(
      createFilesEndpoints(ctx),
      'GET',
      '/agents/workspaces/:id/files/read',
    );

    const created = await post.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('u', 'acme'),
        body: { name: 'A' },
      }),
    );
    const id = jsonBody(created).id as string;

    const res = await read.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('u', 'acme'),
        params: { id },
        query: { path: 'README.md' },
      }),
    );
    const body = jsonBody(res);
    expect(body.path).toBe('README.md');
    expect(body.content).toBe('contents of README.md');
  });

  it('GET /workspaces/:id/files 404s for cross-tenant access', async () => {
    const { provider } = fakeProvider();
    const { ctx, db } = makeFakePluginCtx({ workspaceProvider: provider });
    const post = findEndpoint(createWorkspacesEndpoints(ctx), 'POST', '/agents/workspaces');
    const list = findEndpoint(createFilesEndpoints(ctx), 'GET', '/agents/workspaces/:id/files');

    const created = await post.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('u', 'acme'),
        body: { name: 'A' },
      }),
    );
    const id = jsonBody(created).id as string;

    const res = await list.handler(
      makeEndpointCtx({
        db,
        identity: makeIdentity('u', 'other'),
        params: { id },
      }),
    );
    expect((res as { status?: number }).status).toBe(404);
  });
});
