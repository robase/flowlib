/**
 * `localDockerWorkspace` — isolation defaults. The point of these tests
 * is that a caller passing *only* an image still gets a hardened
 * container: the limits must not be opt-in.
 *
 * `runDocker` is mocked — we assert on the `docker run` argv.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { localDockerWorkspace } from '../local-docker/provider';
import { runDocker } from '../local-docker/docker';
import type { AgentsAuthContext } from '../../../shared/auth-context';

vi.mock('../local-docker/docker', () => ({
  runDocker: vi.fn(),
}));

const mockRunDocker = vi.mocked(runDocker);

const auth = { orgId: 'org1' } as AgentsAuthContext;

/**
 * Default daemon script: `inspect` says "no such container" so the
 * provider takes the boot path, everything else succeeds.
 */
function mockDaemon() {
  mockRunDocker.mockImplementation(async (_path: string, args: string[]) => {
    if (args[0] === 'inspect') {
      return { stdout: '', stderr: 'No such object', exitCode: 1 };
    }
    return { stdout: 'ok', stderr: '', exitCode: 0 };
  });
}

/** The argv of the `docker run` call. */
function runArgv(): string[] {
  const call = mockRunDocker.mock.calls.find((c) => c[1][0] === 'run');
  if (!call) {
    throw new Error('docker run was never invoked');
  }
  return call[1];
}

/** Value following `flag` in the run argv. */
function flagValue(flag: string): string | undefined {
  const argv = runArgv();
  const i = argv.indexOf(flag);
  return i === -1 ? undefined : argv[i + 1];
}

beforeEach(() => {
  mockRunDocker.mockReset();
  mockDaemon();
});

describe('localDockerWorkspace — hardening defaults', () => {
  it('applies resource limits with no caller opt-in', async () => {
    const provider = localDockerWorkspace({ image: 'node:24-slim' });
    await provider.create({ workspaceId: 'ws-1', auth, name: 'w' });

    expect(flagValue('--memory')).toBe('2g');
    expect(flagValue('--cpus')).toBe('2');
    expect(flagValue('--pids-limit')).toBe('512');
  });

  it('drops all capabilities and blocks privilege escalation', async () => {
    const provider = localDockerWorkspace({ image: 'node:24-slim' });
    await provider.create({ workspaceId: 'ws-1', auth, name: 'w' });

    expect(runArgv()).toContain('--cap-drop=ALL');
    expect(runArgv()).toContain('--security-opt=no-new-privileges');
  });

  it('runs agent commands as a non-root user', async () => {
    const provider = localDockerWorkspace({ image: 'node:24-slim' });
    const handle = await provider.create({ workspaceId: 'ws-1', auth, name: 'w' });

    expect(handle.metadata.user).toBe('1000:1000');
  });

  it('creates the workspace dir at boot so the non-root user can write it', async () => {
    // Docker's own `-w` would create it root-owned, and `--cap-drop=ALL`
    // leaves no way to chown it afterwards.
    const provider = localDockerWorkspace({ image: 'node:24-slim' });
    await provider.create({ workspaceId: 'ws-1', auth, name: 'w' });

    const cmd = runArgv()[runArgv().length - 1];
    expect(cmd).toContain("mkdir -p '/workspace'");
    expect(cmd).toContain("chmod 1777 '/workspace'");
    expect(cmd).toContain('tail -f /dev/null');
  });

  it('attaches to an ICC-disabled network that still allows egress', async () => {
    const provider = localDockerWorkspace({ image: 'node:24-slim' });
    await provider.create({ workspaceId: 'ws-1', auth, name: 'w' });

    const netCall = mockRunDocker.mock.calls.find((c) => c[1][0] === 'network');
    expect(netCall?.[1]).toContain('com.docker.network.bridge.enable_icc=false');
    // Egress must survive — `git clone` runs inside this sandbox.
    expect(flagValue('--network')).toBe('flowlib-agents');
    expect(runArgv()).not.toContain('--internal');
  });

  it('creates the shared network only once across workspaces', async () => {
    const provider = localDockerWorkspace({ image: 'node:24-slim' });
    await provider.create({ workspaceId: 'ws-1', auth, name: 'w' });
    await provider.create({ workspaceId: 'ws-2', auth, name: 'w' });

    const netCalls = mockRunDocker.mock.calls.filter((c) => c[1][0] === 'network');
    expect(netCalls).toHaveLength(1);
  });

  it('tolerates a pre-existing network', async () => {
    mockRunDocker.mockImplementation(async (_p: string, args: string[]) => {
      if (args[0] === 'inspect') {
        return { stdout: '', stderr: 'No such object', exitCode: 1 };
      }
      if (args[0] === 'network') {
        return {
          stdout: '',
          stderr: 'Error response from daemon: network with name flowlib-agents already exists',
          exitCode: 1,
        };
      }
      return { stdout: 'ok', stderr: '', exitCode: 0 };
    });

    const provider = localDockerWorkspace({ image: 'node:24-slim' });
    await expect(provider.create({ workspaceId: 'ws-1', auth, name: 'w' })).resolves.toBeDefined();
  });

  it('surfaces a real network-create failure', async () => {
    mockRunDocker.mockImplementation(async (_p: string, args: string[]) => {
      if (args[0] === 'inspect') {
        return { stdout: '', stderr: 'No such object', exitCode: 1 };
      }
      if (args[0] === 'network') {
        return { stdout: '', stderr: 'permission denied', exitCode: 1 };
      }
      return { stdout: 'ok', stderr: '', exitCode: 0 };
    });

    const provider = localDockerWorkspace({ image: 'node:24-slim' });
    await expect(provider.create({ workspaceId: 'ws-1', auth, name: 'w' })).rejects.toThrow(
      /network create/i,
    );
  });
});

describe('localDockerWorkspace — caller overrides', () => {
  it('lets runArgs override a default (docker takes the last flag)', async () => {
    const provider = localDockerWorkspace({
      image: 'node:24-slim',
      runArgs: ['--memory', '8g'],
    });
    await provider.create({ workspaceId: 'ws-1', auth, name: 'w' });

    const argv = runArgv();
    // Both present, ours first — docker resolves scalar flags last-wins.
    expect(argv.lastIndexOf('--memory')).toBeGreaterThan(argv.indexOf('--memory'));
    expect(argv[argv.lastIndexOf('--memory') + 1]).toBe('8g');
  });

  it('honours explicit option overrides', async () => {
    const provider = localDockerWorkspace({
      image: 'node:24-slim',
      memory: '512m',
      cpus: '1',
      pidsLimit: 64,
      user: '2000:2000',
    });
    const handle = await provider.create({ workspaceId: 'ws-1', auth, name: 'w' });

    expect(flagValue('--memory')).toBe('512m');
    expect(flagValue('--cpus')).toBe('1');
    expect(flagValue('--pids-limit')).toBe('64');
    expect(handle.metadata.user).toBe('2000:2000');
  });

  it('supports network: "none" for a no-egress sandbox', async () => {
    const provider = localDockerWorkspace({ image: 'node:24-slim', network: 'none' });
    await provider.create({ workspaceId: 'ws-1', auth, name: 'w' });

    expect(flagValue('--network')).toBe('none');
    // No dedicated network needed when there's no network at all.
    expect(mockRunDocker.mock.calls.some((c) => c[1][0] === 'network')).toBe(false);
  });

  it('does not stack --network when runArgs already sets one', async () => {
    // Docker *accumulates* repeated --network rather than last-wins, so
    // ours has to step aside entirely.
    const provider = localDockerWorkspace({
      image: 'node:24-slim',
      runArgs: ['--network', 'my-net'],
    });
    await provider.create({ workspaceId: 'ws-1', auth, name: 'w' });

    const argv = runArgv();
    expect(argv.filter((a) => a === '--network')).toHaveLength(1);
    expect(flagValue('--network')).toBe('my-net');
  });

  it('user: null runs as the image user (no -u on exec)', async () => {
    const provider = localDockerWorkspace({ image: 'node:24-slim', user: null });
    const handle = await provider.create({ workspaceId: 'ws-1', auth, name: 'w' });

    expect(handle.metadata.user).toBeUndefined();
  });
});
