/**
 * Map a ComputeSDK `Sandbox` onto the agents-plugin `WorkspaceHandle`.
 *
 *   exec       → sandbox.runCommand({ cwd, env, timeout })
 *   readFile   → sandbox.filesystem.readFile
 *   writeFile  → sandbox.filesystem.writeFile
 *   listFiles  → `find` + glob filter (the SDK has no native glob)
 */
import type { WorkspaceExecOptions, WorkspaceExecResult, WorkspaceHandle } from '../types';
import type { ComputeSandbox } from './types';

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

export function createComputesdkHandle(
  workspaceId: string,
  sandbox: ComputeSandbox,
): WorkspaceHandle {
  return {
    id: workspaceId,
    // Sandbox modes leave `rootPath` undefined — files live in the container.
    remoteEndpoint: undefined,
    async exec(command: string, options?: WorkspaceExecOptions): Promise<WorkspaceExecResult> {
      const res = await sandbox.runCommand(command, {
        cwd: options?.cwd,
        env: options?.env,
        timeout: options?.timeoutMs,
      });
      return { stdout: res.stdout, stderr: res.stderr, exitCode: res.exitCode };
    },
    readFile(path: string): Promise<string> {
      return sandbox.filesystem.readFile(path);
    },
    async writeFile(path: string, content: string): Promise<void> {
      await sandbox.filesystem.writeFile(path, content);
    },
    async listFiles(glob: string): Promise<string[]> {
      // No native glob — enumerate files and match in-process.
      const res = await sandbox.runCommand('find . -type f', {});
      const all = res.stdout
        .split('\n')
        .map((line) => line.replace(/^\.\//, '').trim())
        .filter(Boolean);
      const re = globToRegExp(glob);
      return all.filter((p) => re.test(p));
    },
    metadata: { sandboxId: sandbox.sandboxId, provider: 'computesdk' },
  };
}
