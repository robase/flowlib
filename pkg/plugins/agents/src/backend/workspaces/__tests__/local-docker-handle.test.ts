/**
 * `createLocalDockerHandle` — path confinement, exec user, timeouts, and
 * the bounded file listing. `runDocker` is mocked, so no daemon is
 * touched: we assert on the argv the handle *would* hand to docker.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createLocalDockerHandle } from '../local-docker/handle';
import { runDocker } from '../local-docker/docker';

vi.mock('../local-docker/docker', () => ({
  runDocker: vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 })),
}));

const mockRunDocker = vi.mocked(runDocker);

function buildHandle(overrides: Partial<Parameters<typeof createLocalDockerHandle>[0]> = {}) {
  return createLocalDockerHandle({
    workspaceId: 'ws-1',
    container: 'flowlib-ws-org-ws-1',
    workspaceDir: '/workspace',
    dockerPath: 'docker',
    shell: 'sh',
    user: '1000:1000',
    ...overrides,
  });
}

/** The argv of the most recent `runDocker` call. */
function lastArgs(): string[] {
  return mockRunDocker.mock.calls[mockRunDocker.mock.calls.length - 1][1];
}

beforeEach(() => {
  mockRunDocker.mockClear();
  mockRunDocker.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
});

describe('local-docker handle — path confinement', () => {
  it('rejects traversal in readFile / writeFile without dialing docker', async () => {
    const handle = buildHandle();
    for (const p of ['../../etc/passwd', 'a/../../../etc/shadow']) {
      await expect(handle.readFile(p), p).rejects.toThrow(/traversal/i);
      await expect(handle.writeFile(p, 'x'), p).rejects.toThrow(/traversal/i);
    }
    expect(mockRunDocker).not.toHaveBeenCalled();
  });

  it('rejects absolute paths outside the workspace dir', async () => {
    const handle = buildHandle();
    await expect(handle.readFile('/etc/passwd')).rejects.toThrow(/must live under/i);
    await expect(handle.writeFile('/root/.ssh/authorized_keys', 'k')).rejects.toThrow(
      /must live under/i,
    );
    expect(mockRunDocker).not.toHaveBeenCalled();
  });

  it('rejects null bytes', async () => {
    const handle = buildHandle();
    await expect(handle.readFile('ok\0/../../etc/passwd')).rejects.toThrow(/null byte/i);
    expect(mockRunDocker).not.toHaveBeenCalled();
  });

  it('rejects a traversing exec cwd', async () => {
    const handle = buildHandle();
    await expect(handle.exec('ls', { cwd: '../../..' })).rejects.toThrow(/traversal/i);
    expect(mockRunDocker).not.toHaveBeenCalled();
  });

  it('resolves legitimate relative and in-root absolute paths', async () => {
    const handle = buildHandle();
    mockRunDocker.mockResolvedValue({ stdout: 'contents', stderr: '', exitCode: 0 });

    await handle.readFile('src/index.ts');
    expect(lastArgs()).toContain('/workspace/src/index.ts');

    await handle.readFile('/workspace/src/other.ts');
    expect(lastArgs()).toContain('/workspace/src/other.ts');
  });
});

describe('local-docker handle — exec user + timeouts', () => {
  it('runs every operation as the unprivileged user', async () => {
    const handle = buildHandle();
    mockRunDocker.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });

    await handle.exec('whoami');
    expect(lastArgs().join(' ')).toContain('-u 1000:1000');

    await handle.readFile('a.ts');
    expect(lastArgs().join(' ')).toContain('-u 1000:1000');

    await handle.writeFile('a.ts', 'x');
    expect(lastArgs().join(' ')).toContain('-u 1000:1000');

    await handle.listFiles('**');
    expect(lastArgs().join(' ')).toContain('-u 1000:1000');
  });

  it('omits -u when no user is configured', async () => {
    const handle = buildHandle({ user: undefined });
    await handle.exec('whoami');
    expect(lastArgs()).not.toContain('-u');
  });

  it('applies a default exec timeout instead of running unbounded', async () => {
    const handle = buildHandle();
    await handle.exec('sleep infinity');
    const opts = mockRunDocker.mock.calls[0][2];
    expect(opts?.timeoutMs).toBeGreaterThan(0);
  });

  it('honours a caller-supplied exec timeout', async () => {
    const handle = buildHandle();
    await handle.exec('pnpm build', { timeoutMs: 600_000 });
    expect(mockRunDocker.mock.calls[0][2]?.timeoutMs).toBe(600_000);
  });
});

describe('local-docker handle — listFiles', () => {
  it('prunes node_modules/.git and bounds the walk with a timeout', async () => {
    const handle = buildHandle();
    await handle.listFiles('**/*.ts');

    const argv = lastArgs().join(' ');
    expect(argv).toContain('-name node_modules');
    expect(argv).toContain('-name .git');
    expect(argv).toContain('-prune');
    expect(mockRunDocker.mock.calls[0][2]?.timeoutMs).toBeGreaterThan(0);
  });

  it('still glob-filters the results', async () => {
    mockRunDocker.mockResolvedValue({
      stdout: './src/a.ts\n./src/b.js\n./src/deep/c.ts\n',
      stderr: '',
      exitCode: 0,
    });
    const handle = buildHandle();
    expect(await handle.listFiles('**/*.ts')).toEqual(['src/a.ts', 'src/deep/c.ts']);
  });

  it('caps the number of results returned', async () => {
    const many = Array.from({ length: 12_000 }, (_, i) => `./src/f${i}.ts`).join('\n');
    mockRunDocker.mockResolvedValue({ stdout: many, stderr: '', exitCode: 0 });
    const handle = buildHandle();
    expect((await handle.listFiles('**/*.ts')).length).toBe(10_000);
  });
});
