/**
 * Map a running Docker container onto the agents-plugin `WorkspaceHandle`.
 *
 *   exec       → docker exec -w <cwd> [-e K=V] <container> sh -lc '<cmd>'
 *   readFile   → docker exec <container> cat <path>
 *   writeFile  → docker exec -i <container> sh -c 'mkdir -p … && cat > …'  (stdin)
 *   listFiles  → docker exec -w <root> <container> find . -type f  (+ glob)
 *
 * Paths are resolved under the workspace dir (relative) or used as-is
 * (absolute). All docker invocations use argv form (no host shell), so the
 * only shell that runs is the intentional one *inside* the container.
 */
import type { WorkspaceExecOptions, WorkspaceExecResult, WorkspaceHandle } from '../types';
import { runDocker } from './docker';

/** POSIX single-quote a string for safe embedding in an in-container `sh -c`. */
function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Resolve a workspace-relative path under `root`; pass absolute through. */
function resolvePath(root: string, p: string): string {
  if (p.startsWith('/')) {
    return p;
  }
  return `${root.replace(/\/$/, '')}/${p.replace(/^\.\//, '')}`;
}

/** Convert a simple `**`/`*` glob to a RegExp anchored to the full path. */
function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i += 1;
      } else {
        re += '[^/]*';
      }
    } else if ('.+?^${}()|[]\\'.includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  // Glob is an internal, caller-controlled pattern (not user input).
  // eslint-disable-next-line security/detect-non-literal-regexp
  return new RegExp(`^${re}$`);
}

export interface LocalDockerHandleContext {
  workspaceId: string;
  container: string;
  workspaceDir: string;
  dockerPath: string;
  shell: string;
}

export function createLocalDockerHandle(ctx: LocalDockerHandleContext): WorkspaceHandle {
  const { workspaceId, container, workspaceDir, dockerPath, shell } = ctx;
  return {
    id: workspaceId,
    rootPath: undefined, // files live inside the container
    remoteEndpoint: undefined,
    async exec(command: string, options?: WorkspaceExecOptions): Promise<WorkspaceExecResult> {
      const cwd = options?.cwd ? resolvePath(workspaceDir, options.cwd) : workspaceDir;
      const envFlags: string[] = [];
      for (const [k, v] of Object.entries(options?.env ?? {})) {
        envFlags.push('-e', `${k}=${v}`);
      }
      const res = await runDocker(
        dockerPath,
        ['exec', '-w', cwd, ...envFlags, container, shell, '-lc', command],
        { timeoutMs: options?.timeoutMs ?? 0 },
      );
      return { stdout: res.stdout, stderr: res.stderr, exitCode: res.exitCode };
    },
    async readFile(path: string): Promise<string> {
      const resolved = resolvePath(workspaceDir, path);
      const res = await runDocker(dockerPath, ['exec', container, 'cat', resolved]);
      if (res.exitCode !== 0) {
        throw new Error(`readFile(${path}) failed: ${res.stderr.trim() || `exit ${res.exitCode}`}`);
      }
      return res.stdout;
    },
    async writeFile(path: string, content: string): Promise<void> {
      const resolved = resolvePath(workspaceDir, path);
      const q = shQuote(resolved);
      const res = await runDocker(
        dockerPath,
        ['exec', '-i', container, shell, '-c', `mkdir -p "$(dirname ${q})" && cat > ${q}`],
        { input: content },
      );
      if (res.exitCode !== 0) {
        throw new Error(`writeFile(${path}) failed: ${res.stderr.trim() || `exit ${res.exitCode}`}`);
      }
    },
    async listFiles(glob: string): Promise<string[]> {
      const res = await runDocker(dockerPath, [
        'exec',
        '-w',
        workspaceDir,
        container,
        'find',
        '.',
        '-type',
        'f',
      ]);
      const all = res.stdout
        .split('\n')
        .map((line) => line.replace(/^\.\//, '').trim())
        .filter(Boolean);
      const re = globToRegExp(glob);
      return all.filter((p) => re.test(p));
    },
    metadata: { container, provider: 'local-docker', workspaceDir },
  };
}
