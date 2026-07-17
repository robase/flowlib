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
        'sandbox.clone',
        'sandbox.read_file',
        'sandbox.write_file',
        'sandbox.edit_file',
        'sandbox.multi_edit',
        'sandbox.list_files',
        'sandbox.glob',
        'sandbox.grep',
        'sandbox.run_shell',
        'sandbox.run_task',
        'sandbox.check_task',
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
    const read = (await tools['sandbox.read_file'].execute({ path: 'note.md' }, {})) as {
      path: string;
      content: string;
      totalLines: number;
      truncated: boolean;
    };

    // Content is now line-numbered ("     1\tlazy"); numbers are display-only.
    expect(read.path).toBe('note.md');
    expect(read.content).toMatch(/^\s*1\tlazy$/);
    expect(read.totalLines).toBe(1);
    expect(read.truncated).toBe(false);
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

/**
 * A workspace whose `exec` records the command and returns scripted output,
 * so we can assert command construction (incl. shell-quoting) and parsing
 * without a real container.
 */
function makeExecWorkspace(execImpl: (command: string) => { stdout: string; exitCode?: number }): {
  workspace: WorkspaceHandle;
  commands: string[];
} {
  const commands: string[] = [];
  const files = new Map<string, string>();
  const workspace: WorkspaceHandle = {
    id: 'ws-exec',
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
      commands.push(command);
      const r = execImpl(command);
      return { stdout: r.stdout, stderr: '', exitCode: r.exitCode ?? 0 };
    },
  };
  return { workspace, commands };
}

const passthroughAccessor =
  (h: WorkspaceHandle): WorkspaceAccessor =>
  async () =>
    h;

describe('buildSandboxTools — grep', () => {
  it('prefers rg, scopes by glob, and parses match lines', async () => {
    const { workspace, commands } = makeExecWorkspace(() => ({
      stdout: 'src/a.ts:12:const x = 1\nsrc/b.ts:3:const x = 2\n',
    }));
    const tools = buildSandboxTools(passthroughAccessor(workspace));

    const res = (await tools['sandbox.grep'].execute({ pattern: 'const x', glob: '*.ts' }, {})) as {
      count: number;
      output: string;
      truncated: boolean;
    };

    expect(res.count).toBe(2);
    expect(res.output).toContain('src/a.ts:12');
    const cmd = commands[0];
    expect(cmd).toContain('command -v rg');
    expect(cmd).toContain("-g '*.ts'");
    expect(cmd).toContain("-- 'const x'");
  });

  it('shell-quotes an injection-y pattern (no command break-out)', async () => {
    const { workspace, commands } = makeExecWorkspace(() => ({ stdout: '', exitCode: 1 }));
    const tools = buildSandboxTools(passthroughAccessor(workspace));

    await tools['sandbox.grep'].execute({ pattern: `'; rm -rf /` }, {});
    const cmd = commands[0];
    // The dangerous payload is fully single-quoted/escaped, never bare.
    expect(cmd).toContain(`'\\''; rm -rf /'`);
    expect(cmd).not.toMatch(/--\s+'?;? ?rm -rf \/(?!')/);
  });

  it('treats no-match (exit 1, empty stdout) as an empty result, not an error', async () => {
    const { workspace } = makeExecWorkspace(() => ({ stdout: '', exitCode: 1 }));
    const tools = buildSandboxTools(passthroughAccessor(workspace));

    const res = (await tools['sandbox.grep'].execute({ pattern: 'nope' }, {})) as {
      count: number;
      output: string;
    };
    expect(res.count).toBe(0);
    expect(res.output).toBe('');
  });

  it('passes -F for literal and -i for caseInsensitive', async () => {
    const { workspace, commands } = makeExecWorkspace(() => ({ stdout: '' }));
    const tools = buildSandboxTools(passthroughAccessor(workspace));
    await tools['sandbox.grep'].execute(
      { pattern: 'a.b(', literal: true, caseInsensitive: true },
      {},
    );
    expect(commands[0]).toMatch(/rg .*-i .*-F|rg .*-F .*-i/);
  });
});

describe('buildSandboxTools — glob', () => {
  it('lists files via rg --files and strips ./ prefixes', async () => {
    const { workspace, commands } = makeExecWorkspace(() => ({
      stdout: './src/a.ts\nsrc/b.ts\n',
    }));
    const tools = buildSandboxTools(passthroughAccessor(workspace));

    const res = (await tools['sandbox.glob'].execute({ glob: '**/*.ts' }, {})) as {
      files: string[];
      count: number;
    };
    expect(res.files).toEqual(['src/a.ts', 'src/b.ts']);
    expect(res.count).toBe(2);
    expect(commands[0]).toContain("-g '**/*.ts'");
  });
});

describe('buildSandboxTools — ranged read_file', () => {
  async function seed(content: string) {
    const { workspace } = makeExecWorkspace(() => ({ stdout: '' }));
    await workspace.writeFile('f.ts', content);
    return buildSandboxTools(passthroughAccessor(workspace));
  }

  it('returns line-numbered content for a range', async () => {
    const tools = await seed('a\nb\nc\nd\ne');
    const res = (await tools['sandbox.read_file'].execute(
      { path: 'f.ts', startLine: 2, endLine: 4 },
      {},
    )) as { content: string; startLine: number; endLine: number; totalLines: number };
    expect(res.startLine).toBe(2);
    expect(res.endLine).toBe(4);
    expect(res.totalLines).toBe(5);
    expect(res.content).toContain('2\tb');
    expect(res.content).toContain('4\td');
    expect(res.content).not.toContain('\ta\n'); // line 1 excluded
  });

  it('caps an unbounded read of a large file and flags truncated', async () => {
    const big = Array.from({ length: 500 }, (_, i) => `line${i + 1}`).join('\n');
    const tools = await seed(big);
    const res = (await tools['sandbox.read_file'].execute({ path: 'f.ts' }, {})) as {
      endLine: number;
      totalLines: number;
      truncated: boolean;
    };
    expect(res.totalLines).toBe(500);
    expect(res.endLine).toBe(400);
    expect(res.truncated).toBe(true);
  });
});

describe('buildSandboxTools — clone + run_task/check_task', () => {
  function makeRepoWorkspace(): {
    workspace: WorkspaceHandle;
    cloneCalls: Array<{ repoUrl: string; token?: string; branch?: string; dir?: string }>;
    procs: Map<string, { status: string; exitCode?: number; stdout: string; stderr: string }>;
  } {
    const cloneCalls: Array<{ repoUrl: string; token?: string; branch?: string; dir?: string }> =
      [];
    const procs = new Map<
      string,
      { status: string; exitCode?: number; stdout: string; stderr: string }
    >();
    const base = makeWorkspace();
    const workspace: WorkspaceHandle = {
      ...base,
      async cloneRepo(input) {
        cloneCalls.push({
          repoUrl: input.repoUrl,
          token: input.token,
          branch: input.branch,
          dir: input.dir,
        });
        return { dir: input.dir ?? 'repo', stdout: 'Cloning…', stderr: '', exitCode: 0 };
      },
      async startCommand(command) {
        const id = `task-${procs.size + 1}`;
        procs.set(id, { status: 'running', stdout: `started: ${command}`, stderr: '' });
        return { id };
      },
      async getCommand(id) {
        return procs.get(id) ?? { status: 'error', stdout: '', stderr: 'no such task' };
      },
    };
    return { workspace, cloneCalls, procs };
  }

  it('clone resolves a token server-side and passes it to the handle', async () => {
    const { workspace, cloneCalls } = makeRepoWorkspace();
    const tools = buildSandboxTools(passthroughAccessor(workspace), {
      resolveGitToken: async ({ repoUrl }) =>
        new URL(repoUrl).hostname === 'github.com' ? 'ghp_secret' : undefined,
    });
    const res = (await tools['sandbox.clone'].execute(
      { repoUrl: 'https://github.com/acme/app.git', branch: 'main' },
      {},
    )) as { dir: string; exitCode: number };
    expect(res.dir).toBe('repo');
    expect(res.exitCode).toBe(0);
    expect(cloneCalls).toEqual([
      {
        repoUrl: 'https://github.com/acme/app.git',
        token: 'ghp_secret',
        branch: 'main',
        dir: undefined,
      },
    ]);
  });

  it('clone works without a resolver (public repo, no token)', async () => {
    const { workspace, cloneCalls } = makeRepoWorkspace();
    const tools = buildSandboxTools(passthroughAccessor(workspace));
    await tools['sandbox.clone'].execute({ repoUrl: 'https://github.com/acme/pub.git' }, {});
    expect(cloneCalls[0].token).toBeUndefined();
  });

  it('clone degrades gracefully when the workspace lacks support', async () => {
    const tools = buildSandboxTools(passthroughAccessor(makeWorkspace()));
    const res = (await tools['sandbox.clone'].execute({ repoUrl: 'https://x/y.git' }, {})) as {
      error?: string;
    };
    expect(res.error).toMatch(/does not support git clone/);
  });

  it('run_task starts a detached command and check_task polls it', async () => {
    const { workspace, procs } = makeRepoWorkspace();
    const tools = buildSandboxTools(passthroughAccessor(workspace));

    const started = (await tools['sandbox.run_task'].execute({ command: 'pnpm install' }, {})) as {
      taskId: string;
      status: string;
    };
    expect(started.status).toBe('running');
    expect(started.taskId).toBe('task-1');

    // Simulate the task finishing.
    procs.set('task-1', { status: 'completed', exitCode: 0, stdout: 'done', stderr: '' });
    const checked = (await tools['sandbox.check_task'].execute({ taskId: 'task-1' }, {})) as {
      status: string;
      exitCode: number;
      stdout: string;
    };
    expect(checked.status).toBe('completed');
    expect(checked.exitCode).toBe(0);
    expect(checked.stdout).toBe('done');
  });
});

describe('buildSandboxTools — edit_file replaceAll + multi_edit', () => {
  async function seed(content: string) {
    const { workspace } = makeExecWorkspace(() => ({ stdout: '' }));
    await workspace.writeFile('f.ts', content);
    return { tools: buildSandboxTools(passthroughAccessor(workspace)), workspace };
  }

  it('edit_file refuses an ambiguous match without replaceAll', async () => {
    const { tools } = await seed('x x x');
    await expect(
      tools['sandbox.edit_file'].execute({ path: 'f.ts', find: 'x', replace: 'y' }, {}),
    ).rejects.toThrow(/more than once/);
  });

  it('edit_file replaceAll replaces every occurrence', async () => {
    const { tools, workspace } = await seed('x x x');
    const res = (await tools['sandbox.edit_file'].execute(
      { path: 'f.ts', find: 'x', replace: 'y', replaceAll: true },
      {},
    )) as { replacements: number };
    expect(res.replacements).toBe(3);
    expect(await workspace.readFile('f.ts')).toBe('y y y');
  });

  it('multi_edit applies edits in order, atomically', async () => {
    const { tools, workspace } = await seed('const A = 1;\nconst B = 2;');
    const res = (await tools['sandbox.multi_edit'].execute(
      {
        path: 'f.ts',
        edits: [
          { find: 'A', replace: 'ALPHA' },
          { find: 'B', replace: 'BETA' },
        ],
      },
      {},
    )) as { edits: number; replacements: number };
    expect(res.edits).toBe(2);
    expect(await workspace.readFile('f.ts')).toBe('const ALPHA = 1;\nconst BETA = 2;');
  });

  it('multi_edit aborts the whole batch on a failing edit (no partial write)', async () => {
    const { tools, workspace } = await seed('const A = 1;');
    await expect(
      tools['sandbox.multi_edit'].execute(
        {
          path: 'f.ts',
          edits: [
            { find: 'A', replace: 'ALPHA' },
            { find: 'DOES_NOT_EXIST', replace: 'z' },
          ],
        },
        {},
      ),
    ).rejects.toThrow(/edit #2 failed/);
    // First edit must NOT have been written.
    expect(await workspace.readFile('f.ts')).toBe('const A = 1;');
  });
});
