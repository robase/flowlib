/**
 * Unit tests for the `cloudflareSandbox()` `WorkspaceProvider` factory.
 *
 * The real `@cloudflare/sandbox` SDK requires a workerd runtime with
 * Container bindings configured. These tests inject the `sandboxLookup`
 * test seam to bypass the SDK entirely; the factory's lifecycle
 * methods then exercise our argument marshalling and identity logic
 * with a plain in-memory fake stub.
 */
import { describe, it, expect, vi } from 'vitest';
import { buildSandboxName, cloudflareSandbox, type CloudflareSandboxOptions } from '../provider';
import type { SandboxStub } from '../handle';
import type { AgentsAuthContext } from '../../../../shared/auth-context';

function makeAuth(over: Partial<AgentsAuthContext> = {}): AgentsAuthContext {
  return {
    userId: 'u-1',
    orgId: 'org-1',
    role: 'user',
    teamIds: [],
    ...over,
  };
}

function makeStub(over: Partial<SandboxStub> = {}): SandboxStub {
  return {
    exec: vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 })),
    readFile: vi.fn(async () => ({ content: '' })),
    writeFile: vi.fn(async () => ({ success: true })),
    listFiles: vi.fn(async () => ({ files: [] })),
    destroy: vi.fn(async () => {}),
    ...over,
  };
}

function makeProvider(options: Partial<CloudflareSandboxOptions> = {}) {
  const stub = makeStub();
  const lookup = vi.fn(() => stub);
  const provider = cloudflareSandbox({
    namespaceBinding: 'SANDBOX',
    sandboxLookup: lookup,
    ...options,
  });
  return { provider, stub, lookup };
}

describe('buildSandboxName', () => {
  it('embeds orgId and workspaceId', () => {
    expect(buildSandboxName({ orgId: 'org-1' }, 'ws-9')).toBe('oorg-1-ws-9');
  });

  it('throws when orgId is empty', () => {
    expect(() => buildSandboxName({ orgId: '' }, 'ws-1')).toThrow(/orgId/);
  });

  it('throws when workspaceId is empty', () => {
    expect(() => buildSandboxName({ orgId: 'org-1' }, '')).toThrow(/workspaceId/);
  });
});

describe('cloudflareSandbox factory', () => {
  it('returns a WorkspaceProvider with id="cloudflare-sandbox"', () => {
    const { provider } = makeProvider();
    expect(provider.id).toBe('cloudflare-sandbox');
    expect(provider.name).toBe('Cloudflare Sandbox');
    expect(typeof provider.create).toBe('function');
    expect(typeof provider.resolve).toBe('function');
    expect(typeof provider.destroy).toBe('function');
    expect(typeof provider.setEnv).toBe('function');
    expect(typeof provider.clearEnv).toBe('function');
  });

  it('throws if neither namespaceBinding nor sandboxLookup is set', () => {
    expect(() => cloudflareSandbox({ namespaceBinding: '' as unknown as string })).toThrow(
      /namespaceBinding/,
    );
  });
});

describe('create', () => {
  it('builds the sandbox name from auth.orgId + workspaceId', async () => {
    const { provider, lookup } = makeProvider();
    await provider.create({
      workspaceId: 'ws-7',
      auth: makeAuth({ orgId: 'org-7' }),
      name: 'my workspace',
    });
    expect(lookup).toHaveBeenCalledWith('oorg-7-ws-7');
  });

  it('returns a WorkspaceHandle whose id matches the workspaceId', async () => {
    const { provider } = makeProvider();
    const handle = await provider.create({
      workspaceId: 'ws-7',
      auth: makeAuth(),
      name: 'my workspace',
    });
    expect(handle.id).toBe('ws-7');
    expect(handle.rootPath).toBe('/workspace');
    expect((handle.metadata as { sandboxName: string }).sandboxName).toBe('oorg-1-ws-7');
  });

  it('rejects empty orgId', async () => {
    const { provider } = makeProvider();
    await expect(
      provider.create({
        workspaceId: 'ws-7',
        auth: makeAuth({ orgId: '' }),
        name: 'my workspace',
      }),
    ).rejects.toThrow(/orgId/);
  });

  it('attempts to mount the persistent bucket when configured', async () => {
    const stub = makeStub();
    const mountBucket = vi.fn(async () => {});
    Object.assign(stub, { mountBucket });
    const lookup = vi.fn(() => stub);
    const provider = cloudflareSandbox({
      namespaceBinding: 'SANDBOX',
      sandboxLookup: lookup,
      persistentBucketBinding: 'PERSISTENT',
      envAccessor: () => ({ PERSISTENT: { fake: 'r2' } }),
    });
    await provider.create({
      workspaceId: 'ws-1',
      auth: makeAuth(),
      name: 'ws',
    });
    expect(mountBucket).toHaveBeenCalledWith(
      'PERSISTENT',
      '/workspace/persistent',
      expect.objectContaining({ prefix: '/org/org-1' }),
    );
  });

  it('does not throw if mountBucket is missing on the stub', async () => {
    const provider = cloudflareSandbox({
      namespaceBinding: 'SANDBOX',
      sandboxLookup: () => makeStub(),
      persistentBucketBinding: 'PERSISTENT',
      envAccessor: () => ({ PERSISTENT: {} }),
    });
    const handle = await provider.create({
      workspaceId: 'ws-1',
      auth: makeAuth(),
      name: 'ws',
    });
    expect(handle.id).toBe('ws-1');
  });
});

describe('resolve', () => {
  it('returns a fresh handle backed by the same sandbox name', async () => {
    const { provider, lookup } = makeProvider();
    const handle = await provider.resolve('ws-3', makeAuth({ orgId: 'org-2' }));
    expect(handle.id).toBe('ws-3');
    expect(lookup).toHaveBeenCalledWith('oorg-2-ws-3');
  });

  it('rejects empty orgId', async () => {
    const { provider } = makeProvider();
    await expect(provider.resolve('ws-3', makeAuth({ orgId: '' }))).rejects.toThrow(/orgId/);
  });
});

describe('destroy', () => {
  it('calls sandbox.destroy() with the right identity', async () => {
    const { provider, stub, lookup } = makeProvider();
    await provider.destroy('ws-3', makeAuth({ orgId: 'org-2' }));
    expect(lookup).toHaveBeenCalledWith('oorg-2-ws-3');
    expect(stub.destroy).toHaveBeenCalled();
  });

  it('rejects empty orgId', async () => {
    const { provider } = makeProvider();
    await expect(provider.destroy('ws-3', makeAuth({ orgId: '' }))).rejects.toThrow(/orgId/);
  });
});

describe('env wiring', () => {
  it('throws when no env is set and no envAccessor is supplied', async () => {
    // Build a provider that doesn't use the test seam — so it would
    // fall through to the env path.
    const provider = cloudflareSandbox({
      namespaceBinding: 'SANDBOX',
      // No sandboxLookup, no envAccessor.
    });
    await expect(
      provider.create({
        workspaceId: 'ws-1',
        auth: makeAuth(),
        name: 'ws',
      }),
    ).rejects.toThrow(/no Worker env set/);
  });

  it('uses envAccessor when no per-request env has been set', async () => {
    const seenIds: string[] = [];
    const provider = cloudflareSandbox({
      namespaceBinding: 'SANDBOX',
      sandboxLookup: (id) => {
        seenIds.push(id);
        return makeStub();
      },
      envAccessor: () => ({ SANDBOX: { fake: 'do-namespace' } }),
    });
    await provider.create({
      workspaceId: 'ws-9',
      auth: makeAuth({ orgId: 'org-99' }),
      name: 'ws',
    });
    expect(seenIds).toEqual(['oorg-99-ws-9']);
  });

  it('setEnv overrides envAccessor for the next call', async () => {
    const provider = cloudflareSandbox({
      namespaceBinding: 'SANDBOX',
      sandboxLookup: () => makeStub(),
    });
    provider.setEnv({ SANDBOX: { fake: 'binding' } });
    const handle = await provider.create({
      workspaceId: 'ws-1',
      auth: makeAuth(),
      name: 'ws',
    });
    expect(handle.id).toBe('ws-1');
    provider.clearEnv();
  });
});
