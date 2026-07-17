/**
 * Map a ComputeSDK `Sandbox` onto the agents-plugin `WorkspaceHandle`.
 *
 *   exec       → sandbox.runCommand({ cwd, env, timeout })
 *   readFile   → sandbox.filesystem.readFile
 *   writeFile  → sandbox.filesystem.writeFile
 *   listFiles  → `find` + glob filter (the SDK has no native glob)
 *
 * Paths are LLM-supplied and were previously handed to the SDK raw, so
 * `readFile('../../../etc/passwd')` reached the provider verbatim. The
 * root here is provider-defined (each ComputeSDK backend resolves
 * relative paths against its own sandbox cwd), so confinement takes the
 * relative-only form: `..`, null bytes, and absolute paths are rejected,
 * pinning access to that cwd. This matches the tool contract the agent
 * already sees ("Workspace-relative path (e.g. \"src/index.ts\")").
 */
import type { WorkspaceExecOptions, WorkspaceExecResult, WorkspaceHandle } from '../types';
import { assertRelativeWorkspacePath } from '../safe-path';
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
        cwd: options?.cwd === undefined ? undefined : assertRelativeWorkspacePath(options.cwd),
        env: options?.env,
        timeout: options?.timeoutMs,
      });
      return { stdout: res.stdout, stderr: res.stderr, exitCode: res.exitCode };
    },
    // `async` so a rejected path surfaces as a rejected promise rather
    // than a synchronous throw — `WorkspaceHandle.readFile` is declared
    // to return a Promise, and callers only guard the promise.
    async readFile(path: string): Promise<string> {
      return sandbox.filesystem.readFile(assertRelativeWorkspacePath(path));
    },
    async writeFile(path: string, content: string): Promise<void> {
      await sandbox.filesystem.writeFile(assertRelativeWorkspacePath(path), content);
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
