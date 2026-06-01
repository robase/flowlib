/**
 * Sandbox-backed filesystem and shell tools for the AI SDK provider.
 *
 * Each tool wraps one method on `WorkspaceHandle`. The handle abstracts
 * the underlying transport — for Cloudflare Sandbox workspaces, every
 * call becomes a short `containerFetch` RPC into the sandbox DO. Each
 * tool invocation fits inside `containerFetch`'s ~10-15s request
 * lifetime budget; we never hold a long-lived response open.
 *
 * Hosts opt in by passing `tools: ({ workspace }) =>
 * buildSandboxTools(workspace)` to `aiSdkProvider({ ... })`.
 *
 * # Tool surface
 *
 * | Tool name             | Purpose                                                  |
 * | --------------------- | -------------------------------------------------------- |
 * | `sandbox.read_file`   | Read a workspace-relative file as UTF-8                  |
 * | `sandbox.write_file`  | Create or overwrite a workspace file                     |
 * | `sandbox.edit_file`   | Find-and-replace within a file (single literal match)    |
 * | `sandbox.list_files`  | Glob-match files under the workspace root                |
 * | `sandbox.run_shell`   | Run an arbitrary shell command (timeout + cwd supported) |
 * | `sandbox.git`         | Run `git <args>` (convenience wrapper over `run_shell`)  |
 *
 * The tool ids use `sandbox.*` snake_case to match the rest of the
 * flowlib action catalogue.
 */

import type { WorkspaceHandle } from '../../workspaces/types';
import type { AiSdkToolDescriptor, AiSdkToolSet } from './tools';

/**
 * Default per-call timeout for `run_shell`. The LLM can override per
 * call via `timeoutMs`. We cap below `containerFetch`'s effective
 * budget to leave room for opencode → container roundtrip overhead.
 */
const DEFAULT_SHELL_TIMEOUT_MS = 8_000;

/**
 * Hard cap on file content size we allow the LLM to write through the
 * tool. Prevents one over-eager `write_file` from blowing the
 * sandbox's RPC body size limit. The container itself can hold much
 * larger files — this is a per-call protective limit, not a workspace
 * quota.
 */
const MAX_WRITE_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Build the sandbox tool catalogue bound to a specific workspace
 * handle. Returned tools close over `workspace`; calls flow through
 * its methods.
 */
export function buildSandboxTools(workspace: WorkspaceHandle): AiSdkToolSet {
  const readFile: AiSdkToolDescriptor = {
    description:
      'Read the contents of a file from the agent workspace. Path is ' +
      'workspace-relative (no leading "/"). Returns the file contents as ' +
      'UTF-8 text. Throws if the file does not exist.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Workspace-relative path (e.g. "src/index.ts").',
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
    execute: async (raw, options) => {
      const path = String(raw.path ?? '');
      assertSafePath(path);
      options.abortSignal?.throwIfAborted?.();
      const content = await workspace.readFile(path);
      return { path, content };
    },
  };

  const writeFile: AiSdkToolDescriptor = {
    description:
      'Write a file to the agent workspace. Creates parent directories ' +
      'as needed; overwrites silently if the file already exists. Path ' +
      'is workspace-relative. Returns the path and bytes written.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative file path.' },
        content: { type: 'string', description: 'The full file contents to write.' },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
    execute: async (raw, options) => {
      const path = String(raw.path ?? '');
      const content = String(raw.content ?? '');
      assertSafePath(path);
      const byteLength = new TextEncoder().encode(content).length;
      if (byteLength > MAX_WRITE_BYTES) {
        throw new Error(
          `sandbox.write_file: refused — content is ${byteLength} bytes, max ${MAX_WRITE_BYTES}.`,
        );
      }
      options.abortSignal?.throwIfAborted?.();
      await workspace.writeFile(path, content);
      return { path, bytesWritten: byteLength };
    },
  };

  const editFile: AiSdkToolDescriptor = {
    description:
      'Edit a file by replacing a single literal string. Reads the file, ' +
      'replaces the first occurrence of `find` with `replace`, writes ' +
      'the result. Fails if `find` does not appear exactly once in the ' +
      'file (use `read_file` first to verify the target string is unique).',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative file path.' },
        find: {
          type: 'string',
          description: 'The exact literal string to find (no regex). Must appear exactly once.',
        },
        replace: {
          type: 'string',
          description: 'The literal replacement string.',
        },
      },
      required: ['path', 'find', 'replace'],
      additionalProperties: false,
    },
    execute: async (raw, options) => {
      const path = String(raw.path ?? '');
      const find = String(raw.find ?? '');
      const replace = String(raw.replace ?? '');
      assertSafePath(path);
      if (find.length === 0) {
        throw new Error('sandbox.edit_file: `find` must be a non-empty string.');
      }
      options.abortSignal?.throwIfAborted?.();
      const before = await workspace.readFile(path);
      const first = before.indexOf(find);
      if (first < 0) {
        throw new Error(`sandbox.edit_file: \`find\` string not found in ${path}.`);
      }
      const second = before.indexOf(find, first + find.length);
      if (second >= 0) {
        throw new Error(
          `sandbox.edit_file: \`find\` string appears more than once in ${path}. ` +
            'Supply a more specific match — include enough surrounding context to ' +
            'make it unique.',
        );
      }
      const after = before.slice(0, first) + replace + before.slice(first + find.length);
      options.abortSignal?.throwIfAborted?.();
      await workspace.writeFile(path, after);
      return {
        path,
        bytesBefore: new TextEncoder().encode(before).length,
        bytesAfter: new TextEncoder().encode(after).length,
      };
    },
  };

  const listFiles: AiSdkToolDescriptor = {
    description:
      'List files in the agent workspace matching a glob pattern. ' +
      'Pattern syntax supports `*` and `**`. Returns an array of ' +
      'workspace-relative paths.',
    parameters: {
      type: 'object',
      properties: {
        glob: {
          type: 'string',
          description:
            'Glob pattern, e.g. "**/*.ts" for all TypeScript files, "src/*" for top-level src/.',
        },
      },
      required: ['glob'],
      additionalProperties: false,
    },
    execute: async (raw, options) => {
      const glob = String(raw.glob ?? '**/*');
      options.abortSignal?.throwIfAborted?.();
      const files = await workspace.listFiles(glob);
      return { glob, files };
    },
  };

  const runShell: AiSdkToolDescriptor = {
    description:
      'Run a shell command inside the agent workspace. Returns stdout, ' +
      'stderr, and the exit code. The command runs in the workspace root ' +
      'unless `cwd` is specified. Times out after the provided `timeoutMs` ' +
      `(default ${DEFAULT_SHELL_TIMEOUT_MS}ms). Use this only when no ` +
      'more specific tool is available — shell access is broad and slow.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The shell command line to run (e.g. "ls -la", "node -v").',
        },
        cwd: {
          type: 'string',
          description: 'Workspace-relative working directory. Defaults to the workspace root.',
        },
        timeoutMs: {
          type: 'number',
          description: `Hard timeout in milliseconds (default ${DEFAULT_SHELL_TIMEOUT_MS}).`,
        },
      },
      required: ['command'],
      additionalProperties: false,
    },
    execute: async (raw, options) => {
      const command = String(raw.command ?? '');
      if (command.trim().length === 0) {
        throw new Error('sandbox.run_shell: `command` must be a non-empty string.');
      }
      const cwd = typeof raw.cwd === 'string' ? raw.cwd : undefined;
      const timeoutMs =
        typeof raw.timeoutMs === 'number' && raw.timeoutMs > 0
          ? raw.timeoutMs
          : DEFAULT_SHELL_TIMEOUT_MS;
      options.abortSignal?.throwIfAborted?.();
      const result = await workspace.exec(command, {
        ...(cwd ? { cwd } : {}),
        timeoutMs,
      });
      return {
        command,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    },
  };

  const git: AiSdkToolDescriptor = {
    description:
      'Run a git command in the agent workspace. Equivalent to ' +
      '`run_shell` with the command prefixed by `git `. Use for status, ' +
      'commit, branch, etc. Returns stdout/stderr/exit-code from git.',
    parameters: {
      type: 'object',
      properties: {
        args: {
          type: 'string',
          description: 'Arguments to pass to git (e.g. "status", "log --oneline -n 10").',
        },
        cwd: {
          type: 'string',
          description: 'Workspace-relative working directory.',
        },
        timeoutMs: {
          type: 'number',
          description: `Hard timeout in milliseconds (default ${DEFAULT_SHELL_TIMEOUT_MS}).`,
        },
      },
      required: ['args'],
      additionalProperties: false,
    },
    execute: async (raw, options) => {
      const args = String(raw.args ?? '');
      if (args.trim().length === 0) {
        throw new Error('sandbox.git: `args` must be a non-empty string.');
      }
      const cwd = typeof raw.cwd === 'string' ? raw.cwd : undefined;
      const timeoutMs =
        typeof raw.timeoutMs === 'number' && raw.timeoutMs > 0
          ? raw.timeoutMs
          : DEFAULT_SHELL_TIMEOUT_MS;
      options.abortSignal?.throwIfAborted?.();
      const result = await workspace.exec(`git ${args}`, {
        ...(cwd ? { cwd } : {}),
        timeoutMs,
      });
      return {
        args,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    },
  };

  return {
    'sandbox.read_file': readFile,
    'sandbox.write_file': writeFile,
    'sandbox.edit_file': editFile,
    'sandbox.list_files': listFiles,
    'sandbox.run_shell': runShell,
    'sandbox.git': git,
  };
}

/**
 * Reject paths that try to escape the workspace root via `..` or
 * absolute paths. The workspace's underlying provider may have its
 * own sandboxing, but rejecting these here gives the LLM a clear
 * error rather than a silent provider-side reject.
 */
function assertSafePath(path: string): void {
  if (path.length === 0) {
    throw new Error('path must be non-empty.');
  }
  if (path.startsWith('/')) {
    throw new Error(`path "${path}" must be workspace-relative (no leading "/").`);
  }
  const segments = path.split('/');
  for (const seg of segments) {
    if (seg === '..') {
      throw new Error(`path "${path}" must not contain ".." segments.`);
    }
  }
}
