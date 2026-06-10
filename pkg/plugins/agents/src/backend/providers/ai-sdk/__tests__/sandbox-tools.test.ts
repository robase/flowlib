import { describe, expect, it } from 'vitest';

import { buildSandboxTools } from '../sandbox-tools';
import type { WorkspaceHandle, WorkspaceAccessor } from '../../../workspaces/types';

/**
 * Minimal in-memory workspace handle. Tracks `exec` calls so tests can
 * assert tools route through the resolved handle.
 */
function makeWorkspace(id = 'ws-1'): WorkspaceHandle {
  const files = new Map<string, string>();
  return {
    id,
    metadata: {},
    async readFile(path) {
      const v = files.get(path);
      if (v === undefined) {
        throw new Error(`no such file: ${path}`);
      }
      return v;
    },
    async writeFile(path, content) {
      files.set(path, content);
    },
    async listFiles() {
      return [...files.keys()];
    },
    async exec(command) {
      return { stdout: `ran: ${command}`, stderr: '', exitCode: 0 };
    },
  };
}

/**
 * An accessor that counts how many times it actually provisioned, so we
 * can prove the sandbox boots at most once and only when a tool needs it.
 */
function countingAccessor(handle: WorkspaceHandle): {
  ensure: WorkspaceAccessor;
  bootCount: () => number;
} {
  let count = 0;
  let cached: WorkspaceHandle | undefined;
  return {
    bootCount: () => count,
    ensure: async () => {
      if (cached) {
        return cached;
      }
      count += 1;
      cached = handle;
      return handle;
    },
  };
}

describe('buildSandboxTools — lazy provisioning', () => {
  it('exposes the explicit sandbox.start tool alongside the fs/shell tools', () => {
    const { ensure } = countingAccessor(makeWorkspace());
    const tools = buildSandboxTools(ensure);
    expect(Object.keys(tools).sort()).toEqual(
      [
        'sandbox.start',
        'sandbox.read_file',
        'sandbox.write_file',
        'sandbox.edit_file',
        'sandbox.list_files',
        'sandbox.run_shell',
        'sandbox.git',
      ].sort(),
    );
  });

  it('does NOT provision a sandbox just by building the tools', () => {
    const { ensure, bootCount } = countingAccessor(makeWorkspace());
    buildSandboxTools(ensure);
    expect(bootCount()).toBe(0);
  });

  it('explicit: sandbox.start provisions and reports the workspace id', async () => {
    const { ensure, bootCount } = countingAccessor(makeWorkspace('ws-explicit'));
    const tools = buildSandboxTools(ensure);

    const result = await tools['sandbox.start'].execute({}, {});

    expect(bootCount()).toBe(1);
    expect(result).toMatchObject({ ready: true, workspaceId: 'ws-explicit' });
  });

  it('implicit: the first sandbox.* tool call provisions on demand', async () => {
    const { ensure, bootCount } = countingAccessor(makeWorkspace());
    const tools = buildSandboxTools(ensure);

    expect(bootCount()).toBe(0);
    const result = await tools['sandbox.run_shell'].execute({ command: 'ls' }, {});

    expect(bootCount()).toBe(1);
    expect(result).toMatchObject({ command: 'ls', exitCode: 0, stdout: 'ran: ls' });
  });

  it('boots the sandbox at most once across explicit + multiple tool calls', async () => {
    const { ensure, bootCount } = countingAccessor(makeWorkspace());
    const tools = buildSandboxTools(ensure);

    await tools['sandbox.start'].execute({}, {});
    await tools['sandbox.write_file'].execute({ path: 'a.txt', content: 'hi' }, {});
    await tools['sandbox.read_file'].execute({ path: 'a.txt' }, {});
    await tools['sandbox.git'].execute({ args: 'status' }, {});

    expect(bootCount()).toBe(1);
  });

  it('round-trips a write→read through the lazily-provisioned handle', async () => {
    const { ensure } = countingAccessor(makeWorkspace());
    const tools = buildSandboxTools(ensure);

    await tools['sandbox.write_file'].execute({ path: 'note.md', content: 'lazy' }, {});
    const read = await tools['sandbox.read_file'].execute({ path: 'note.md' }, {});

    expect(read).toEqual({ path: 'note.md', content: 'lazy' });
  });

  it('propagates provisioning failures to the tool call', async () => {
    const ensure: WorkspaceAccessor = async () => {
      throw new Error('no workspace provider registered');
    };
    const tools = buildSandboxTools(ensure);

    await expect(tools['sandbox.start'].execute({}, {})).rejects.toThrow(
      /no workspace provider registered/,
    );
    await expect(tools['sandbox.read_file'].execute({ path: 'x' }, {})).rejects.toThrow(
      /no workspace provider registered/,
    );
  });

  it('honours an already-aborted signal before provisioning', async () => {
    const { ensure, bootCount } = countingAccessor(makeWorkspace());
    const tools = buildSandboxTools(ensure);
    const controller = new AbortController();
    controller.abort();

    await expect(
      tools['sandbox.run_shell'].execute({ command: 'ls' }, { abortSignal: controller.signal }),
    ).rejects.toThrow();
    // Aborted before ensure() — no sandbox booted.
    expect(bootCount()).toBe(0);
  });
});
