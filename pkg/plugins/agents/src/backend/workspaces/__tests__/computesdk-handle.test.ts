/**
 * `createComputesdkHandle` — path confinement. The ComputeSDK backend
 * resolves relative paths against its own sandbox cwd, so the handle
 * refuses absolute paths and `..` rather than forwarding them raw.
 */
import { describe, it, expect, vi } from 'vitest';
import { createComputesdkHandle } from '../computesdk/handle';
import type { ComputeSandbox } from '../computesdk/types';

function makeSandbox(overrides: Partial<ComputeSandbox> = {}): ComputeSandbox {
  return {
    sandboxId: 'sb-1',
    runCommand: vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 })),
    filesystem: {
      readFile: vi.fn(async () => 'contents'),
      writeFile: vi.fn(async () => {}),
      mkdir: vi.fn(async () => {}),
      readdir: vi.fn(async () => []),
      exists: vi.fn(async () => true),
      remove: vi.fn(async () => {}),
    },
    ...overrides,
  };
}

describe('computesdk handle — path confinement', () => {
  it('rejects traversal before it reaches the SDK', async () => {
    const sandbox = makeSandbox();
    const handle = createComputesdkHandle('ws-1', sandbox);

    for (const p of ['../../etc/passwd', 'a/../../../root/.ssh/id_rsa']) {
      await expect(handle.readFile(p), p).rejects.toThrow(/traversal/i);
      await expect(handle.writeFile(p, 'x'), p).rejects.toThrow(/traversal/i);
    }
    expect(sandbox.filesystem.readFile).not.toHaveBeenCalled();
    expect(sandbox.filesystem.writeFile).not.toHaveBeenCalled();
  });

  it('rejects absolute paths', async () => {
    const sandbox = makeSandbox();
    const handle = createComputesdkHandle('ws-1', sandbox);

    await expect(handle.readFile('/etc/passwd')).rejects.toThrow(/workspace-relative/i);
    await expect(handle.writeFile('/etc/cron.d/x', 'x')).rejects.toThrow(/workspace-relative/i);
    expect(sandbox.filesystem.readFile).not.toHaveBeenCalled();
  });

  it('rejects null bytes', async () => {
    const sandbox = makeSandbox();
    const handle = createComputesdkHandle('ws-1', sandbox);

    await expect(handle.readFile('a\0.ts')).rejects.toThrow(/null byte/i);
    expect(sandbox.filesystem.readFile).not.toHaveBeenCalled();
  });

  it('rejects a traversing exec cwd', async () => {
    const sandbox = makeSandbox();
    const handle = createComputesdkHandle('ws-1', sandbox);

    await expect(handle.exec('ls', { cwd: '../..' })).rejects.toThrow(/traversal/i);
    expect(sandbox.runCommand).not.toHaveBeenCalled();
  });

  it('forwards legitimate paths normalised', async () => {
    const sandbox = makeSandbox();
    const handle = createComputesdkHandle('ws-1', sandbox);

    expect(await handle.readFile('./src/index.ts')).toBe('contents');
    expect(sandbox.filesystem.readFile).toHaveBeenCalledWith('src/index.ts');

    await handle.writeFile('src/a.ts', 'body');
    expect(sandbox.filesystem.writeFile).toHaveBeenCalledWith('src/a.ts', 'body');
  });

  it('leaves an unset cwd undefined', async () => {
    const sandbox = makeSandbox();
    const handle = createComputesdkHandle('ws-1', sandbox);

    await handle.exec('ls');
    expect(sandbox.runCommand).toHaveBeenCalledWith('ls', {
      cwd: undefined,
      env: undefined,
      timeout: undefined,
    });
  });
});
