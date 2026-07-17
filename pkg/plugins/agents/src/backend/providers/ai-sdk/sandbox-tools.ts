/**
 * Sandbox-backed filesystem and shell tools for the AI SDK provider.
 *
 * Each tool wraps one method on `WorkspaceHandle`. The handle abstracts
 * the underlying transport — for Cloudflare Sandbox workspaces, every
 * call becomes a short `containerFetch` RPC into the sandbox DO. Each
 * tool invocation fits inside `containerFetch`'s ~10-15s request
 * lifetime budget; we never hold a long-lived response open.
 *
 * Hosts opt in by passing `tools: ({ ensureWorkspace }) =>
 * buildSandboxTools(ensureWorkspace)` to `aiSdkProvider({ ... })`.
 *
 * # Lazy provisioning
 *
 * Tools close over a {@link WorkspaceAccessor}, not a concrete handle.
 * Every tool awaits `ensure()` before touching the filesystem/shell, so
 * the sandbox container is provisioned on first use rather than at
 * session start. Two ways it boots:
 *
 *   - **Explicit** — the model calls `sandbox.start`, which provisions
 *     the container and reports it ready.
 *   - **Implicit** — any other `sandbox.*` tool provisions transparently
 *     on its first call.
 *
 * Either way the first call eats the cold-start; subsequent calls reuse
 * the cached handle. Pure-chat turns that never touch a `sandbox.*` tool
 * never provision a container at all.
 *
 * # Tool surface
 *
 * | Tool name             | Purpose                                                  |
 * | --------------------- | -------------------------------------------------------- |
 * | `sandbox.start`       | Provision (or attach to) the sandbox container           |
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

import type { WorkspaceAccessor } from '../../workspaces/types';
import type { AiSdkToolDescriptor, AiSdkToolSet } from './tools';

/**
 * Resolve a git access token server-side for a clone/push (the agent never
 * sees raw tokens). The host wires this to its credential store — e.g. the
 * org's GitHub credential. Returning `undefined` clones without auth
 * (public repos only).
 */
export type ResolveGitToken = (input: {
  repoUrl: string;
  credentialId?: string;
}) => Promise<string | undefined>;

export interface BuildSandboxToolsOptions {
  /** Host-supplied git-token resolver for `sandbox.clone` (see {@link ResolveGitToken}). */
  resolveGitToken?: ResolveGitToken;
}

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

/** Max lines returned by an unbounded `read_file` (use a range for more). */
const MAX_READ_LINES = 400;

/** Default / hard caps for `grep` and `glob` result counts. */
const GREP_DEFAULT_MAX = 100;
const GREP_HARD_MAX = 300;
const GLOB_DEFAULT_MAX = 200;
const GLOB_HARD_MAX = 1000;
/** Cap on `grep` context lines. */
const GREP_MAX_CONTEXT = 5;

/**
 * Build the sandbox tool catalogue bound to a lazy workspace accessor.
 * Returned tools close over `ensure`; each call provisions-or-resolves
 * the sandbox on first use and then flows through the handle's methods.
 */
export function buildSandboxTools(
  ensure: WorkspaceAccessor,
  options: BuildSandboxToolsOptions = {},
): AiSdkToolSet {
  const start: AiSdkToolDescriptor = {
    description:
      'Provision (or attach to) the agent sandbox — a Linux container with ' +
      'a filesystem, shell, and git. Call this first if you want to boot ' +
      'the sandbox explicitly before doing file or shell work; otherwise ' +
      'the first sandbox.* tool call boots it automatically. Booting can ' +
      'take a few seconds the first time. Returns the workspace id once ' +
      'the sandbox is ready.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    execute: async (_raw, options) => {
      options.abortSignal?.throwIfAborted?.();
      const workspace = await ensure();
      return {
        ready: true,
        workspaceId: workspace.id,
        ...(workspace.rootPath ? { rootPath: workspace.rootPath } : {}),
      };
    },
  };

  const readFile: AiSdkToolDescriptor = {
    description:
      'Read a file from the agent workspace. Path is workspace-relative ' +
      '(no leading "/"). Output is line-numbered ("  42\\tcode") for easy ' +
      'reference — the numbers are DISPLAY ONLY; never include them in ' +
      '`edit_file`/`multi_edit` find strings. Use `startLine`/`endLine` ' +
      `(1-based, inclusive) to read a slice of a large file; without a range, ` +
      `files longer than ${MAX_READ_LINES} lines are truncated (read again ` +
      'with a range to see more).',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Workspace-relative path (e.g. "src/index.ts").',
        },
        startLine: {
          type: 'number',
          description: '1-based first line to return (inclusive). Optional.',
        },
        endLine: {
          type: 'number',
          description: '1-based last line to return (inclusive). Optional.',
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
    execute: async (raw, options) => {
      const path = String(raw.path ?? '');
      assertSafePath(path);
      const startLine = positiveInt(raw.startLine);
      const endLine = positiveInt(raw.endLine);
      options.abortSignal?.throwIfAborted?.();
      const workspace = await ensure();
      const text = await workspace.readFile(path);
      const lines = text.split('\n');
      const totalLines = lines.length;

      let from = startLine ? Math.max(1, startLine) : 1;
      let to = endLine ? Math.min(totalLines, endLine) : totalLines;
      let truncated = false;
      // Cap unbounded reads of large files to protect the context window.
      if (!startLine && !endLine && totalLines > MAX_READ_LINES) {
        to = MAX_READ_LINES;
        truncated = true;
      }
      if (from > to) {
        from = Math.min(from, totalLines);
        to = from;
      }
      const numbered = lines
        .slice(from - 1, to)
        .map((line, i) => `${String(from + i).padStart(6)}\t${line}`)
        .join('\n');

      return { path, content: numbered, startLine: from, endLine: to, totalLines, truncated };
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
      const workspace = await ensure();
      await workspace.writeFile(path, content);
      return { path, bytesWritten: byteLength };
    },
  };

  const editFile: AiSdkToolDescriptor = {
    description:
      'Edit a file by replacing a literal string. Reads the file, replaces ' +
      '`find` with `replace`, writes the result. By default `find` must ' +
      'appear exactly once (use `read_file` first to confirm uniqueness, ' +
      'and include surrounding context to make it unique). Set ' +
      '`replaceAll: true` to replace every occurrence instead.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative file path.' },
        find: {
          type: 'string',
          description: 'The exact literal string to find (no regex).',
        },
        replace: {
          type: 'string',
          description: 'The literal replacement string.',
        },
        replaceAll: {
          type: 'boolean',
          description: 'Replace every occurrence instead of requiring a unique match.',
        },
      },
      required: ['path', 'find', 'replace'],
      additionalProperties: false,
    },
    execute: async (raw, options) => {
      const path = String(raw.path ?? '');
      const find = String(raw.find ?? '');
      const replace = String(raw.replace ?? '');
      const replaceAll = raw.replaceAll === true;
      assertSafePath(path);
      options.abortSignal?.throwIfAborted?.();
      const workspace = await ensure();
      const before = await workspace.readFile(path);
      const { result, replacements } = applyLiteralEdit(before, find, replace, replaceAll, path);
      options.abortSignal?.throwIfAborted?.();
      await workspace.writeFile(path, result);
      return {
        path,
        replacements,
        bytesBefore: new TextEncoder().encode(before).length,
        bytesAfter: new TextEncoder().encode(result).length,
      };
    },
  };

  const multiEdit: AiSdkToolDescriptor = {
    description:
      'Apply an ordered list of literal find/replace edits to ONE file, ' +
      'atomically — the file is read once, all edits are applied in sequence ' +
      'in memory, then written once. If any edit fails (no match, or an ' +
      'ambiguous match without `replaceAll`), the whole batch aborts with no ' +
      'changes written. Use for multi-site edits in a single file instead of ' +
      'many edit_file calls. Edits apply in order, so a later edit sees the ' +
      'result of earlier ones.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative file path.' },
        edits: {
          type: 'array',
          description: 'Ordered edits to apply.',
          items: {
            type: 'object',
            properties: {
              find: { type: 'string', description: 'Exact literal string (no regex).' },
              replace: { type: 'string', description: 'Literal replacement.' },
              replaceAll: {
                type: 'boolean',
                description: 'Replace every occurrence instead of requiring a unique match.',
              },
            },
            required: ['find', 'replace'],
            additionalProperties: false,
          },
        },
      },
      required: ['path', 'edits'],
      additionalProperties: false,
    },
    execute: async (raw, options) => {
      const path = String(raw.path ?? '');
      assertSafePath(path);
      const edits = Array.isArray(raw.edits) ? (raw.edits as Array<Record<string, unknown>>) : [];
      if (edits.length === 0) {
        throw new Error('sandbox.multi_edit: `edits` must be a non-empty array.');
      }
      options.abortSignal?.throwIfAborted?.();
      const workspace = await ensure();
      const before = await workspace.readFile(path);
      // Apply all edits in memory first; any failure throws before we write.
      let working = before;
      let total = 0;
      edits.forEach((e, i) => {
        const find = String(e.find ?? '');
        const replace = String(e.replace ?? '');
        const replaceAll = e.replaceAll === true;
        try {
          const { result, replacements } = applyLiteralEdit(
            working,
            find,
            replace,
            replaceAll,
            path,
          );
          working = result;
          total += replacements;
        } catch (err) {
          throw new Error(
            `sandbox.multi_edit: edit #${i + 1} failed — ${err instanceof Error ? err.message : String(err)} ` +
              '(no changes written).',
          );
        }
      });
      options.abortSignal?.throwIfAborted?.();
      await workspace.writeFile(path, working);
      return {
        path,
        edits: edits.length,
        replacements: total,
        bytesBefore: new TextEncoder().encode(before).length,
        bytesAfter: new TextEncoder().encode(working).length,
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
      const workspace = await ensure();
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
      const workspace = await ensure();
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
      const workspace = await ensure();
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

  const grep: AiSdkToolDescriptor = {
    description:
      'Search file contents across the workspace (ripgrep, falling back to ' +
      'grep). Returns matching lines as "file:line:text". This is the primary ' +
      'way to find code — prefer it over run_shell. `pattern` is a regex by ' +
      'default (set `literal:true` for a fixed string). Scope with `path` ' +
      '(a subdir) and/or `glob` (e.g. "*.ts"). Honours .gitignore (skips ' +
      'node_modules etc.).',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Search pattern (regex unless `literal`).' },
        path: { type: 'string', description: 'Workspace-relative subdir to search. Optional.' },
        glob: { type: 'string', description: 'File filter, e.g. "*.ts" or "**/*.test.ts".' },
        literal: { type: 'boolean', description: 'Treat `pattern` as a fixed string.' },
        caseInsensitive: { type: 'boolean', description: 'Case-insensitive search.' },
        contextLines: {
          type: 'number',
          description: `Lines of context around each match (0–${GREP_MAX_CONTEXT}).`,
        },
        maxResults: {
          type: 'number',
          description: `Max matching lines (default ${GREP_DEFAULT_MAX}, hard cap ${GREP_HARD_MAX}).`,
        },
      },
      required: ['pattern'],
      additionalProperties: false,
    },
    execute: async (raw, options) => {
      const pattern = String(raw.pattern ?? '');
      if (pattern.length === 0) {
        throw new Error('sandbox.grep: `pattern` must be a non-empty string.');
      }
      const path = typeof raw.path === 'string' && raw.path.length > 0 ? raw.path : '.';
      if (path !== '.') {
        assertSafePath(path);
      }
      const glob = typeof raw.glob === 'string' && raw.glob.length > 0 ? raw.glob : undefined;
      const literal = raw.literal === true;
      const ci = raw.caseInsensitive === true;
      const ctx = clampInt(raw.contextLines, 0, GREP_MAX_CONTEXT, 0);
      const max = clampInt(raw.maxResults, 1, GREP_HARD_MAX, GREP_DEFAULT_MAX);

      const command = buildGrepCommand({ pattern, path, glob, literal, ci, ctx, max });
      options.abortSignal?.throwIfAborted?.();
      const workspace = await ensure();
      const result = await workspace.exec(command, { timeoutMs: DEFAULT_SHELL_TIMEOUT_MS });
      // grep/rg exit 1 on "no matches" — that's a normal empty result, not an error.
      const output = result.stdout ?? '';
      const count = countMatchLines(output);
      return { pattern, output, count, truncated: count >= max };
    },
  };

  const glob: AiSdkToolDescriptor = {
    description:
      'Find files by glob pattern (ripgrep --files, falling back to find). ' +
      'Honours .gitignore. Use to locate where code lives (e.g. ' +
      '"**/*.service.ts"). Returns workspace-relative paths.',
    parameters: {
      type: 'object',
      properties: {
        glob: {
          type: 'string',
          description: 'Glob pattern, e.g. "**/*.ts". Defaults to all files.',
        },
        maxResults: {
          type: 'number',
          description: `Max paths (default ${GLOB_DEFAULT_MAX}, hard cap ${GLOB_HARD_MAX}).`,
        },
      },
      required: [],
      additionalProperties: false,
    },
    execute: async (raw, options) => {
      const pattern = typeof raw.glob === 'string' && raw.glob.length > 0 ? raw.glob : undefined;
      const max = clampInt(raw.maxResults, 1, GLOB_HARD_MAX, GLOB_DEFAULT_MAX);
      const command = buildGlobCommand({ glob: pattern, max });
      options.abortSignal?.throwIfAborted?.();
      const workspace = await ensure();
      const result = await workspace.exec(command, { timeoutMs: DEFAULT_SHELL_TIMEOUT_MS });
      const files = (result.stdout ?? '')
        .split('\n')
        .map((l) => l.replace(/^\.\//, '').trim())
        .filter((l) => l.length > 0);
      return {
        glob: pattern ?? '**/*',
        files,
        count: files.length,
        truncated: files.length >= max,
      };
    },
  };

  const clone: AiSdkToolDescriptor = {
    description:
      'Clone a git repository into the workspace so you can work on it. ' +
      'Authentication is handled server-side for private repos (you never ' +
      'pass a token). Returns the directory the repo was cloned into; `cd` ' +
      'there (via cwd on other tools) to work on it.',
    parameters: {
      type: 'object',
      properties: {
        repoUrl: {
          type: 'string',
          description: 'Clone URL, e.g. https://github.com/owner/repo.git',
        },
        branch: { type: 'string', description: 'Branch to check out (optional).' },
        dir: { type: 'string', description: 'Target directory (defaults to the repo name).' },
        depth: { type: 'number', description: 'Shallow-clone depth (optional; omit for full).' },
      },
      required: ['repoUrl'],
      additionalProperties: false,
    },
    execute: async (raw, opts) => {
      const repoUrl = String(raw.repoUrl ?? '');
      if (!repoUrl) {
        throw new Error('sandbox.clone: `repoUrl` is required.');
      }
      opts.abortSignal?.throwIfAborted?.();
      const workspace = await ensure();
      if (!workspace.cloneRepo) {
        return { error: 'This workspace does not support git clone.' };
      }
      const token = options.resolveGitToken
        ? await options.resolveGitToken({
            repoUrl,
            credentialId: typeof raw.credentialId === 'string' ? raw.credentialId : undefined,
          })
        : undefined;
      const res = await workspace.cloneRepo({
        repoUrl,
        ...(typeof raw.branch === 'string' ? { branch: raw.branch } : {}),
        ...(typeof raw.dir === 'string' ? { dir: raw.dir } : {}),
        ...(typeof raw.depth === 'number' ? { depth: raw.depth } : {}),
        ...(token ? { token } : {}),
      });
      return {
        dir: res.dir,
        exitCode: res.exitCode,
        stdout: res.stdout,
        stderr: res.stderr,
      };
    },
  };

  const runTask: AiSdkToolDescriptor = {
    description:
      'Start a long-running command (install deps, build, test suite) ' +
      'detached and return a task id immediately — use this instead of ' +
      'run_shell for anything that may take more than a few seconds. Poll ' +
      'it with sandbox.check_task until status is "completed"/"failed".',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The command line to run, e.g. "pnpm install".' },
        cwd: { type: 'string', description: 'Workspace-relative working directory (optional).' },
      },
      required: ['command'],
      additionalProperties: false,
    },
    execute: async (raw, opts) => {
      const command = String(raw.command ?? '');
      if (command.trim().length === 0) {
        throw new Error('sandbox.run_task: `command` must be a non-empty string.');
      }
      opts.abortSignal?.throwIfAborted?.();
      const workspace = await ensure();
      if (!workspace.startCommand) {
        return { error: 'This workspace does not support detached commands.' };
      }
      const cwd = typeof raw.cwd === 'string' ? raw.cwd : undefined;
      const { id } = await workspace.startCommand(command, cwd ? { cwd } : undefined);
      return { taskId: id, status: 'running', note: 'Poll with sandbox.check_task.' };
    },
  };

  const checkTask: AiSdkToolDescriptor = {
    description:
      'Check a task started by sandbox.run_task. Returns its status ' +
      '("running" | "completed" | "failed" | …), exit code, and accumulated ' +
      'stdout/stderr. Poll periodically until it is no longer "running".',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'The id returned by sandbox.run_task.' },
      },
      required: ['taskId'],
      additionalProperties: false,
    },
    execute: async (raw, opts) => {
      const taskId = String(raw.taskId ?? '');
      if (!taskId) {
        throw new Error('sandbox.check_task: `taskId` is required.');
      }
      opts.abortSignal?.throwIfAborted?.();
      const workspace = await ensure();
      if (!workspace.getCommand) {
        return { error: 'This workspace does not support detached commands.' };
      }
      const status = await workspace.getCommand(taskId);
      return { taskId, ...status };
    },
  };

  return {
    'sandbox.start': start,
    'sandbox.clone': clone,
    'sandbox.read_file': readFile,
    'sandbox.write_file': writeFile,
    'sandbox.edit_file': editFile,
    'sandbox.multi_edit': multiEdit,
    'sandbox.list_files': listFiles,
    'sandbox.glob': glob,
    'sandbox.grep': grep,
    'sandbox.run_shell': runShell,
    'sandbox.run_task': runTask,
    'sandbox.check_task': checkTask,
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

/**
 * POSIX single-quote a string for safe shell interpolation. Wraps in
 * single quotes and escapes embedded single quotes as `'\''`. EVERY
 * LLM-supplied value placed in an `exec` command MUST go through this —
 * it's the guard against shell injection (e.g. a pattern like `'; rm -rf /`).
 */
function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Coerce to a positive integer, or undefined. */
function positiveInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1
    ? Math.floor(value)
    : undefined;
}

/** Clamp a numeric input to [min, max], falling back to `fallback`. */
function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(value)));
}

/**
 * Apply a single literal find/replace to `text`. Default requires a unique
 * match (throws if missing or ambiguous); `replaceAll` replaces every
 * occurrence. Returns the new text + replacement count. Shared by
 * `edit_file` and `multi_edit`.
 */
function applyLiteralEdit(
  text: string,
  find: string,
  replace: string,
  replaceAll: boolean,
  path: string,
): { result: string; replacements: number } {
  if (find.length === 0) {
    throw new Error('`find` must be a non-empty string.');
  }
  const first = text.indexOf(find);
  if (first < 0) {
    throw new Error(`\`find\` string not found in ${path}.`);
  }
  if (!replaceAll) {
    const second = text.indexOf(find, first + find.length);
    if (second >= 0) {
      throw new Error(
        `\`find\` string appears more than once in ${path}. Include enough ` +
          'surrounding context to make it unique, or set replaceAll.',
      );
    }
    return {
      result: text.slice(0, first) + replace + text.slice(first + find.length),
      replacements: 1,
    };
  }
  // replaceAll — literal, non-regex global replace.
  const parts = text.split(find);
  return { result: parts.join(replace), replacements: parts.length - 1 };
}

/** Build the rg-preferred / grep-fallback content-search command. */
function buildGrepCommand(opts: {
  pattern: string;
  path: string;
  glob?: string;
  literal: boolean;
  ci: boolean;
  ctx: number;
  max: number;
}): string {
  const rg = ['rg', '--line-number', '--no-heading', '--color', 'never'];
  if (opts.ci) {
    rg.push('-i');
  }
  if (opts.literal) {
    rg.push('-F');
  }
  if (opts.ctx > 0) {
    rg.push('-C', String(opts.ctx));
  }
  if (opts.glob) {
    rg.push('-g', shQuote(opts.glob));
  }
  rg.push('-m', String(opts.max), '--', shQuote(opts.pattern), shQuote(opts.path));

  const grep = ['grep', '-rnI'];
  if (opts.ci) {
    grep.push('-i');
  }
  if (opts.literal) {
    grep.push('-F');
  }
  if (opts.ctx > 0) {
    grep.push('-C', String(opts.ctx));
  }
  for (const dir of ['node_modules', '.git', 'dist', 'build', '.next']) {
    grep.push(`--exclude-dir=${dir}`);
  }
  if (opts.glob) {
    grep.push(`--include=${shQuote(opts.glob)}`);
  }
  grep.push('--', shQuote(opts.pattern), shQuote(opts.path));
  const grepCmd = `${grep.join(' ')} | head -n ${opts.max}`;

  return `if command -v rg >/dev/null 2>&1; then ${rg.join(' ')}; else ${grepCmd}; fi`;
}

/** Build the rg-preferred / find-fallback file-listing command. */
function buildGlobCommand(opts: { glob?: string; max: number }): string {
  const rg = ['rg', '--files'];
  if (opts.glob) {
    rg.push('-g', shQuote(opts.glob));
  }
  const rgCmd = `${rg.join(' ')} | head -n ${opts.max}`;

  const find = [
    'find',
    '.',
    '-type',
    'f',
    '-not',
    '-path',
    shQuote('./node_modules/*'),
    '-not',
    '-path',
    shQuote('./.git/*'),
  ];
  // `find` has no glob filter as flexible as rg's; approximate with -name on
  // the basename when the glob is a simple "*.ext" form.
  if (opts.glob && /^\*\.[a-zA-Z0-9]+$/.test(opts.glob)) {
    find.push('-name', shQuote(opts.glob));
  }
  const findCmd = `${find.join(' ')} | head -n ${opts.max}`;

  return `if command -v rg >/dev/null 2>&1; then ${rgCmd}; else ${findCmd}; fi`;
}

/** Count lines that look like grep/rg matches (`path:line:…`). */
function countMatchLines(output: string): number {
  let n = 0;
  for (const line of output.split('\n')) {
    if (/:\d+:/.test(line)) {
      n += 1;
    }
  }
  return n;
}
