/**
 * Unit tests for `CloudflareSandboxHandle`.
 *
 * Mocks the `SandboxStub` directly — no `@cloudflare/sandbox` runtime,
 * no real Durable Object — so we can verify the handle's argument
 * marshalling, path normalisation, and metadata wiring in isolation.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  CloudflareSandboxHandle,
  SANDBOX_WORKSPACE_ROOT,
  type OpencodeBootOptions,
  type OpencodeBundle,
  type OpencodeLoader,
  type SandboxStub,
} from '../handle';

function makeStub(overrides: Partial<SandboxStub> = {}): SandboxStub {
  return {
    exec: vi.fn(async () => ({
      stdout: 'ok',
      stderr: '',
      exitCode: 0,
    })),
    readFile: vi.fn(async () => ({ content: 'hello' })),
    writeFile: vi.fn(async () => ({ success: true })),
    listFiles: vi.fn(async () => ({
      files: [
        {
          relativePath: 'foo.ts',
          absolutePath: '/workspace/foo.ts',
          type: 'file' as const,
        },
        {
          relativePath: 'sub',
          absolutePath: '/workspace/sub',
          type: 'directory' as const,
        },
        {
          relativePath: 'sub/bar.ts',
          absolutePath: '/workspace/sub/bar.ts',
          type: 'file' as const,
        },
      ],
    })),
    destroy: vi.fn(async () => {}),
    ...overrides,
  };
}

function buildHandle(stub: SandboxStub = makeStub()) {
  return new CloudflareSandboxHandle({
    workspaceId: 'ws-1',
    sandbox: stub,
    sandboxName: 'org:o1/ws:ws-1',
  });
}

describe('CloudflareSandboxHandle', () => {
  it('exposes the workspace id and sandbox metadata', () => {
    const stub = makeStub();
    const handle = buildHandle(stub);
    expect(handle.id).toBe('ws-1');
    expect(handle.rootPath).toBe(SANDBOX_WORKSPACE_ROOT);
    expect(handle.metadata.sandboxName).toBe('org:o1/ws:ws-1');
    expect(handle.metadata.sandbox).toBe(stub);
    expect(handle.metadata.opencode).toBe(null);
    expect(typeof handle.metadata.getOpencode).toBe('function');
    expect(handle.metadata.outboundAuth).toBeUndefined();
  });

  it('exposes outboundAuth bind/unbind helpers when configured', async () => {
    const stub = makeStub();
    const kvStore = new Map<string, string>();
    const kv = {
      get: vi.fn(async (k: string) => kvStore.get(k) ?? null),
      put: vi.fn(async (k: string, v: string) => {
        kvStore.set(k, v);
      }),
      delete: vi.fn(async (k: string) => {
        kvStore.delete(k);
      }),
    };
    const handle = new CloudflareSandboxHandle({
      workspaceId: 'ws-1',
      sandbox: stub,
      sandboxName: 'org:o1/ws:ws-1',
      outboundAuth: { kv },
    });
    expect(handle.metadata.outboundAuth).toBeDefined();
    await handle.metadata.outboundAuth!.bindCredential('sess-1', 'anthropic', 'sk-real');
    expect(kv.put).toHaveBeenCalledWith(
      'agents/cred/session/sess-1/anthropic',
      'sk-real',
      expect.objectContaining({ expirationTtl: expect.any(Number) }),
    );
    await handle.metadata.outboundAuth!.unbindCredential('sess-1', 'anthropic');
    expect(kv.delete).toHaveBeenCalledWith('agents/cred/session/sess-1/anthropic');
  });

  describe('exec', () => {
    it('defaults cwd to /workspace and forwards env/timeout', async () => {
      const stub = makeStub();
      const handle = buildHandle(stub);
      const result = await handle.exec('ls');
      expect(result).toEqual({ stdout: 'ok', stderr: '', exitCode: 0 });
      expect(stub.exec).toHaveBeenCalledWith('ls', expect.objectContaining({ cwd: '/workspace' }));
    });

    it('resolves cwd relative to the workspace root', async () => {
      const stub = makeStub();
      const handle = buildHandle(stub);
      await handle.exec('ls', { cwd: 'src/foo' });
      expect(stub.exec).toHaveBeenCalledWith(
        'ls',
        expect.objectContaining({ cwd: '/workspace/src/foo' }),
      );
    });

    it('passes env vars through verbatim', async () => {
      const stub = makeStub();
      const handle = buildHandle(stub);
      await handle.exec('node -v', { env: { FOO: 'bar' } });
      expect(stub.exec).toHaveBeenCalledWith(
        'node -v',
        expect.objectContaining({ env: { FOO: 'bar' } }),
      );
    });

    it('attaches an AbortSignal when timeoutMs is set', async () => {
      const stub = makeStub();
      const handle = buildHandle(stub);
      await handle.exec('sleep 5', { timeoutMs: 100 });
      const call = (stub.exec as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call?.[1]?.signal).toBeInstanceOf(AbortSignal);
    });
  });

  describe('readFile / writeFile', () => {
    it('readFile returns the content string', async () => {
      const stub = makeStub();
      const handle = buildHandle(stub);
      const content = await handle.readFile('foo.ts');
      expect(content).toBe('hello');
      expect(stub.readFile).toHaveBeenCalledWith('/workspace/foo.ts');
    });

    it('writeFile forwards the absolute path and content', async () => {
      const stub = makeStub();
      const handle = buildHandle(stub);
      await handle.writeFile('sub/bar.ts', 'export const x = 1');
      expect(stub.writeFile).toHaveBeenCalledWith('/workspace/sub/bar.ts', 'export const x = 1');
    });

    it('rejects path traversal in readFile', async () => {
      const handle = buildHandle();
      await expect(handle.readFile('../etc/passwd')).rejects.toThrow(/traversal/i);
    });

    it('rejects path traversal in writeFile', async () => {
      const handle = buildHandle();
      await expect(handle.writeFile('../escape', 'x')).rejects.toThrow(/traversal/i);
    });

    it('rejects null bytes', async () => {
      const handle = buildHandle();
      await expect(handle.readFile('foo\0bar')).rejects.toThrow(/null byte/);
    });

    it('rejects absolute paths outside /workspace', async () => {
      const handle = buildHandle();
      await expect(handle.readFile('/etc/passwd')).rejects.toThrow(/\/workspace/);
    });

    it('accepts absolute paths that live under /workspace', async () => {
      const stub = makeStub();
      const handle = buildHandle(stub);
      await handle.readFile('/workspace/foo.ts');
      expect(stub.readFile).toHaveBeenCalledWith('/workspace/foo.ts');
    });

    it('handles leading "./" gracefully', async () => {
      const stub = makeStub();
      const handle = buildHandle(stub);
      await handle.readFile('./foo.ts');
      expect(stub.readFile).toHaveBeenCalledWith('/workspace/foo.ts');
    });
  });

  describe('listFiles', () => {
    it('returns all file paths for "**"', async () => {
      const stub = makeStub();
      const handle = buildHandle(stub);
      const files = await handle.listFiles('**');
      expect(files).toEqual(['/workspace/foo.ts', '/workspace/sub/bar.ts']);
      expect(stub.listFiles).toHaveBeenCalledWith(
        '/workspace',
        expect.objectContaining({ recursive: true }),
      );
    });

    it('honours an empty glob (lists root)', async () => {
      const stub = makeStub();
      const handle = buildHandle(stub);
      const files = await handle.listFiles('');
      expect(files).toEqual(['/workspace/foo.ts', '/workspace/sub/bar.ts']);
    });

    it('passes a directory prefix through', async () => {
      const stub = makeStub();
      const handle = buildHandle(stub);
      await handle.listFiles('sub/**');
      expect(stub.listFiles).toHaveBeenCalledWith(
        '/workspace/sub',
        expect.objectContaining({ recursive: true }),
      );
    });

    it('post-filters by glob fragments when wildcards interleave', async () => {
      const stub = makeStub();
      const handle = buildHandle(stub);
      const files = await handle.listFiles('*.ts');
      expect(files).toContain('/workspace/foo.ts');
      expect(files).toContain('/workspace/sub/bar.ts');
    });
  });

  describe('metadata.getOpencode', () => {
    function makeBundle(url = 'http://localhost:4096') {
      return {
        client: { __fake: true },
        server: { port: 4096, url, close: vi.fn(async () => {}) },
      };
    }

    it('invokes the loader with the sandbox stub and merged options', async () => {
      const stub = makeStub();
      const bundle = makeBundle();
      const loader: OpencodeLoader = vi.fn(async () => bundle);
      const handle = new CloudflareSandboxHandle({
        workspaceId: 'ws-1',
        sandbox: stub,
        sandboxName: 'org:o1/ws:ws-1',
        defaultOpencodeOptions: {
          port: 4096,
          config: { provider: { anthropic: { options: { apiKey: 'sk-test' } } } },
          env: { ANTHROPIC_API_KEY: 'sk-test' },
        },
        opencodeLoader: loader,
      });

      const result = await handle.metadata.getOpencode({ env: { EXTRA: '1' } });
      expect(result).toBe(bundle);
      expect(loader).toHaveBeenCalledTimes(1);
      expect(loader).toHaveBeenCalledWith(
        stub,
        expect.objectContaining({
          port: 4096,
          directory: '/workspace',
          config: { provider: { anthropic: { options: { apiKey: 'sk-test' } } } },
          env: { ANTHROPIC_API_KEY: 'sk-test', EXTRA: '1' },
        }),
      );
    });

    it('caches the bundle across calls and exposes it on metadata.opencode', async () => {
      const stub = makeStub();
      const bundle = makeBundle();
      const loader: OpencodeLoader = vi.fn(async () => bundle);
      const handle = new CloudflareSandboxHandle({
        workspaceId: 'ws-1',
        sandbox: stub,
        sandboxName: 'org:o1/ws:ws-1',
        opencodeLoader: loader,
      });

      const first = await handle.metadata.getOpencode();
      const second = await handle.metadata.getOpencode();
      expect(first).toBe(second);
      expect(loader).toHaveBeenCalledTimes(1);
      expect(handle.metadata.opencode).toBe(bundle);
    });

    it('coalesces concurrent callers onto a single in-flight loader call', async () => {
      const stub = makeStub();
      let resolve: ((b: OpencodeBundle) => void) | undefined;
      const pending = new Promise<OpencodeBundle>((r) => {
        resolve = r;
      });
      const loader: OpencodeLoader = vi.fn(() => pending);
      const handle = new CloudflareSandboxHandle({
        workspaceId: 'ws-1',
        sandbox: stub,
        sandboxName: 'org:o1/ws:ws-1',
        opencodeLoader: loader,
      });

      const a = handle.metadata.getOpencode();
      const b = handle.metadata.getOpencode();
      const bundle = makeBundle();
      resolve?.(bundle);
      const [ra, rb] = await Promise.all([a, b]);
      expect(ra).toBe(bundle);
      expect(rb).toBe(bundle);
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it('allows retry after a failed loader call', async () => {
      const stub = makeStub();
      const loader = vi
        .fn<(s: SandboxStub, opts?: OpencodeBootOptions) => Promise<OpencodeBundle>>()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce(makeBundle('http://localhost:4096'));
      const handle = new CloudflareSandboxHandle({
        workspaceId: 'ws-1',
        sandbox: stub,
        sandboxName: 'org:o1/ws:ws-1',
        opencodeLoader: loader,
      });

      await expect(handle.metadata.getOpencode()).rejects.toThrow(/boom/);
      const second = await handle.metadata.getOpencode();
      expect(second.server.url).toBe('http://localhost:4096');
      expect(loader).toHaveBeenCalledTimes(2);
    });
  });
});
