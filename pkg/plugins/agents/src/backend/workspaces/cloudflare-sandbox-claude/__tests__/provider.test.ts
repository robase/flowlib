/**
 * Unit tests for the `cloudflareSandboxClaude()` factory.
 *
 * The default in-container loader (which talks to the live sandbox SDK)
 * is replaced via the `claudeServerLoader` test seam so tests don't
 * require a workerd runtime.
 */
import { describe, it, expect, vi } from 'vitest';
import { cloudflareSandboxClaude, type CloudflareSandboxClaudeOptions } from '../provider';
import type { ClaudeServerBundle, ClaudeServerLoader } from '../handle';
import type { SandboxStub } from '../../cloudflare-sandbox/handle';
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

function makeBundle(): ClaudeServerBundle {
  return {
    client: {
      baseUrl: 'http://localhost:4097',
      fetch: vi.fn(async () => ({
        status: 200,
        headers: new Headers(),
        body: null,
        async text() {
          return '{"ok":true}';
        },
      })),
    },
    server: {
      port: 4097,
      url: 'http://localhost:4097',
      close: vi.fn(async () => {}),
    },
  };
}

function makeProvider(options: Partial<CloudflareSandboxClaudeOptions> = {}) {
  const stub = makeStub();
  const bundle = makeBundle();
  const loader: ClaudeServerLoader = vi.fn(async () => bundle);
  const provider = cloudflareSandboxClaude({
    namespaceBinding: 'SANDBOX_CLAUDE',
    sandboxLookup: () => stub,
    claudeServerLoader: loader,
    ...options,
  });
  return { provider, stub, bundle, loader };
}

describe('cloudflareSandboxClaude factory', () => {
  it('returns a WorkspaceProvider with id="cloudflare-sandbox-claude"', () => {
    const { provider } = makeProvider();
    expect(provider.id).toBe('cloudflare-sandbox-claude');
    expect(provider.name).toBe('Cloudflare Sandbox (Claude Code)');
    expect(typeof provider.create).toBe('function');
    expect(typeof provider.resolve).toBe('function');
    expect(typeof provider.destroy).toBe('function');
  });

  it('throws if neither namespaceBinding nor sandboxLookup is set', () => {
    expect(() => cloudflareSandboxClaude({ namespaceBinding: '' as unknown as string })).toThrow(
      /namespaceBinding/,
    );
  });

  it('create() returns a handle whose metadata exposes getClaudeCode', async () => {
    const { provider, loader } = makeProvider();
    const handle = (await provider.create({
      workspaceId: 'ws-1',
      auth: makeAuth(),
      name: 'demo',
    })) as unknown as { metadata: { getClaudeCode?: () => Promise<unknown> } };

    expect(typeof handle.metadata.getClaudeCode).toBe('function');
    // Loader is lazy — only fires when getClaudeCode is invoked.
    expect(loader).not.toHaveBeenCalled();

    const bundle = await handle.metadata.getClaudeCode!();
    expect(loader).toHaveBeenCalledTimes(1);
    expect(bundle).toBeDefined();
  });

  it('getClaudeCode caches the bundle across calls', async () => {
    const { provider, loader } = makeProvider();
    const handle = (await provider.create({
      workspaceId: 'ws-1',
      auth: makeAuth(),
      name: 'demo',
    })) as unknown as { metadata: { getClaudeCode: () => Promise<unknown> } };

    const a = await handle.metadata.getClaudeCode();
    const b = await handle.metadata.getClaudeCode();
    expect(a).toBe(b);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('destroy() forwards to the underlying sandbox stub', async () => {
    const { provider, stub } = makeProvider();
    await provider.destroy('ws-1', makeAuth());
    expect(stub.destroy).toHaveBeenCalledTimes(1);
  });
});
