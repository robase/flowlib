/**
 * Unit tests for `CloudflareSandboxHandle`.
 *
 * Mocks the `SandboxStub` directly — no `@cloudflare/sandbox` runtime,
 * no real Durable Object — so we can verify the handle's argument
 * marshalling, path normalisation, and metadata wiring in isolation.
 */
import { describe, it, expect, vi } from 'vitest';
import { CloudflareSandboxHandle, SANDBOX_WORKSPACE_ROOT, type SandboxStub } from '../handle';

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
    startProcess: vi.fn(async () => ({ id: 'p1' })),
    exposePort: vi.fn(async () => ({
      url: 'https://4096-sandbox.example.com',
      port: 4096,
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
    expect(handle.metadata.opencodeBaseUrl).toBe(null);
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

  describe('metadata.startOpencode', () => {
    it('returns the cached URL on subsequent calls', async () => {
      const stub = makeStub();
      const handle = new CloudflareSandboxHandle({
        workspaceId: 'ws-1',
        sandbox: stub,
        sandboxName: 'org:o1/ws:ws-1',
        exposeHostname: 'sandbox.example.com',
      });
      const url = await handle.metadata.startOpencode();
      expect(url).toBe('https://4096-sandbox.example.com');
      expect(stub.startProcess).toHaveBeenCalledTimes(1);
      expect(stub.exposePort).toHaveBeenCalledTimes(1);
      // Second call hits the cache.
      const url2 = await handle.metadata.startOpencode();
      expect(url2).toBe('https://4096-sandbox.example.com');
      expect(stub.startProcess).toHaveBeenCalledTimes(1);
    });

    it('returns the not-configured sentinel without hostname or starter', async () => {
      const stub = makeStub();
      const handle = new CloudflareSandboxHandle({
        workspaceId: 'ws-1',
        sandbox: stub,
        sandboxName: 'org:o1/ws:ws-1',
      });
      const url = await handle.metadata.startOpencode();
      expect(url).toBe('opencode-not-configured');
      expect(stub.startProcess).not.toHaveBeenCalled();
    });

    it('uses the supplied opencodeStarter callback', async () => {
      const stub = makeStub();
      const starter = vi.fn(async () => 'https://custom.example.com');
      const handle = new CloudflareSandboxHandle({
        workspaceId: 'ws-1',
        sandbox: stub,
        sandboxName: 'org:o1/ws:ws-1',
        opencodeStarter: starter,
      });
      const url = await handle.metadata.startOpencode();
      expect(url).toBe('https://custom.example.com');
      expect(starter).toHaveBeenCalledWith(stub);
      expect(stub.startProcess).not.toHaveBeenCalled();
    });
  });
});
