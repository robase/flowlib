/**
 * Map a running Docker container onto the agents-plugin `WorkspaceHandle`.
 *
 *   exec       → docker exec -u <user> -w <cwd> [-e K=V] <container> sh -lc '<cmd>'
 *   readFile   → docker exec -u <user> <container> cat <path>
 *   writeFile  → docker exec -u <user> -i <container> sh -c 'mkdir -p … && cat > …'  (stdin)
 *   listFiles  → docker exec -u <user> -w <root> <container> find . -type f  (+ glob)
 *
 * Paths are confined to the workspace dir by `resolveWorkspacePath` —
 * `..` traversal, null bytes, and absolute paths outside the root are
 * rejected before they reach the container. All docker invocations use
 * argv form (no host shell), so the only shell that runs is the
 * intentional one *inside* the container.
 *
 * Every exec runs as `user` (the unprivileged uid:gid the provider picked)
 * rather than the container's root — see `provider.ts` for why the
 * container's own pid 1 still starts as root.
 */
import type { WorkspaceExecOptions, WorkspaceExecResult, WorkspaceHandle } from '../types';
import { resolveWorkspacePath } from '../safe-path';
import { runDocker } from './docker';

/** POSIX single-quote a string for safe embedding in an in-container `sh -c`. */
export function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Default ceiling for an agent-issued `exec`. Previously unbounded
 * (`timeoutMs ?? 0`), so a `sleep infinity` or a wedged build wedged the
 * turn with it. Callers that need longer pass an explicit `timeoutMs`.
 */
const DEFAULT_EXEC_TIMEOUT_MS = 120_000;

/** Ceiling for `listFiles`' `find` — bounds a pathological tree walk. */
const LIST_FILES_TIMEOUT_MS = 30_000;

/** Max paths returned by `listFiles` before the result is truncated. */
const LIST_FILES_MAX_RESULTS = 10_000;

/**
 * Directories never worth walking: they are huge, machine-generated, and
 * never what the agent's glob is looking for. Excluding them at `find`
 * level (rather than filtering after) is what keeps a `node_modules`-heavy
 * repo from blowing the docker stdout buffer.
 */
const PRUNED_DIRS = ['node_modules', '.git', '.venv', 'dist', 'build', 'target', '.next'];

/** `find` args that prune {@link PRUNED_DIRS} before descending into them. */
function pruneArgs(): string[] {
  const args: string[] = ['('];
  PRUNED_DIRS.forEach((dir, i) => {
    if (i > 0) {
      args.push('-o');
    }
    args.push('-name', dir);
  });
  args.push(')', '-prune', '-o');
  return args;
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
  /** `uid:gid` every exec runs as. Omit to run as the container's user. */
  user?: string;
}

export function createLocalDockerHandle(ctx: LocalDockerHandleContext): WorkspaceHandle {
  const { workspaceId, container, workspaceDir, dockerPath, shell, user } = ctx;
  const userFlags = user ? ['-u', user] : [];
  return {
    id: workspaceId,
    rootPath: undefined, // files live inside the container
    remoteEndpoint: undefined,
    async exec(command: string, options?: WorkspaceExecOptions): Promise<WorkspaceExecResult> {
      const cwd = options?.cwd ? resolveWorkspacePath(workspaceDir, options.cwd) : workspaceDir;
      const envFlags: string[] = [];
      for (const [k, v] of Object.entries(options?.env ?? {})) {
        envFlags.push('-e', `${k}=${v}`);
      }
      const res = await runDocker(
        dockerPath,
        ['exec', ...userFlags, '-w', cwd, ...envFlags, container, shell, '-lc', command],
        { timeoutMs: options?.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS },
      );
      return { stdout: res.stdout, stderr: res.stderr, exitCode: res.exitCode };
    },
    async readFile(path: string): Promise<string> {
      const resolved = resolveWorkspacePath(workspaceDir, path);
      const res = await runDocker(dockerPath, ['exec', ...userFlags, container, 'cat', resolved]);
      if (res.exitCode !== 0) {
        throw new Error(`readFile(${path}) failed: ${res.stderr.trim() || `exit ${res.exitCode}`}`);
      }
      return res.stdout;
    },
    async writeFile(path: string, content: string): Promise<void> {
      const resolved = resolveWorkspacePath(workspaceDir, path);
      const q = shQuote(resolved);
      const res = await runDocker(
        dockerPath,
        [
          'exec',
          ...userFlags,
          '-i',
          container,
          shell,
          '-c',
          `mkdir -p "$(dirname ${q})" && cat > ${q}`,
        ],
        { input: content },
      );
      if (res.exitCode !== 0) {
        throw new Error(
          `writeFile(${path}) failed: ${res.stderr.trim() || `exit ${res.exitCode}`}`,
        );
      }
    },
    async listFiles(glob: string): Promise<string[]> {
      const res = await runDocker(
        dockerPath,
        [
          'exec',
          ...userFlags,
          '-w',
          workspaceDir,
          container,
          'find',
          '.',
          ...pruneArgs(),
          '-type',
          'f',
          '-print',
        ],
        { timeoutMs: LIST_FILES_TIMEOUT_MS },
      );
      const all = res.stdout
        .split('\n')
        .map((line) => line.replace(/^\.\//, '').trim())
        .filter(Boolean);
      const re = globToRegExp(glob);
      const matched: string[] = [];
      for (const p of all) {
        if (re.test(p)) {
          matched.push(p);
          if (matched.length >= LIST_FILES_MAX_RESULTS) {
            break;
          }
        }
      }
      return matched;
    },
    metadata: { container, provider: 'local-docker', workspaceDir, ...(user ? { user } : {}) },
  };
}
