/**
 * `CloudflareSandboxHandle` — concrete `WorkspaceHandle` implementation
 * backed by a `@cloudflare/sandbox` stub returned from `getSandbox()`.
 *
 * Methods proxy directly to the SDK:
 *   - `exec`       → `sandbox.exec(cmd, { cwd, env, … })`
 *   - `readFile`   → `sandbox.readFile(absolute(path))`
 *   - `writeFile`  → `sandbox.writeFile(absolute(path), content)`
 *   - `listFiles`  → `sandbox.listFiles(absolute(prefix), { recursive: true })`
 *
 * The handle never reaches across the host filesystem — every file
 * operation runs inside the sandbox container, which is the workspace's
 * only filesystem. `rootPath` is therefore an *in-sandbox* absolute path
 * (`/workspace`), not a host path.
 *
 * `metadata.startOpencode()` is a lazy starter that boots `opencode serve`
 * inside the sandbox and exposes its port. Stream D's `openCodeProvider`
 * calls it when it needs an HTTP base URL. The default impl is a
 * placeholder that documents the integration point — Stream H/D may
 * supply a real implementation through `metadata.opencodeStarter`.
 */

import type {
  WorkspaceExecOptions,
  WorkspaceExecResult,
  WorkspaceHandle,
} from '../types';

/**
 * Subset of the `@cloudflare/sandbox` `Sandbox` stub surface this handle
 * uses. Declaring the shape locally keeps the type-only import light and
 * makes mocking trivial in tests.
 */
export interface SandboxStub {
  exec(
    command: string,
    options?: {
      cwd?: string;
      env?: Record<string, string | undefined>;
      signal?: AbortSignal;
    },
  ): Promise<{ stdout: string; stderr: string; exitCode: number }>;
  readFile(
    path: string,
    options?: { encoding?: string },
  ): Promise<{ content: string }>;
  writeFile(
    path: string,
    content: string,
    options?: { encoding?: string },
  ): Promise<unknown>;
  listFiles(
    path: string,
    options?: { recursive?: boolean; includeHidden?: boolean },
  ): Promise<{
    files: Array<{
      relativePath: string;
      absolutePath: string;
      type: 'file' | 'directory' | 'symlink' | 'other';
    }>;
  }>;
  startProcess(
    command: string,
    options?: { cwd?: string; env?: Record<string, string | undefined> },
  ): Promise<{ id: string }>;
  exposePort(
    port: number,
    options: { name?: string; hostname: string; token?: string },
  ): Promise<{ url: string; port: number }>;
  destroy(): Promise<void>;
}

/** Lazy starter contract for spinning up `opencode serve` inside the sandbox. */
export type OpencodeStarter = (sandbox: SandboxStub) => Promise<string>;

/**
 * Workspace-root inside the sandbox container.
 *
 * The Sandbox SDK guarantees this directory exists and is writable.
 * Persistent artefacts live under `/workspace/persistent` and are
 * preserved across sandbox sleep/wake cycles when an R2 mount is
 * configured.
 */
export const SANDBOX_WORKSPACE_ROOT = '/workspace';

/**
 * Glob → list-files-prefix translation rules.
 *
 * The SDK's `listFiles` doesn't take a glob — it lists a directory
 * recursively. v1 supports two shapes:
 *
 *   1. `**` / `**\/*`  → list everything under root
 *   2. `<dir>/**`      → list everything under `<dir>`
 *   3. `<exact-path>`   → list that single path (callers can post-filter)
 *
 * Anything more complex falls back to listing the root and the caller
 * does its own filtering. Documented in the JSDoc on `listFiles` below.
 */
function globToPrefix(glob: string): string {
  if (!glob || glob === '**' || glob === '**/*' || glob === '*') {
    return '';
  }
  const idx = glob.indexOf('*');
  if (idx === -1) {
    return glob;
  }
  // Strip the wildcard tail and any trailing slash.
  let prefix = glob.slice(0, idx);
  if (prefix.endsWith('/')) {
    prefix = prefix.slice(0, -1);
  }
  return prefix;
}

export interface CloudflareSandboxHandleOptions {
  /** Workspace id (matches `agent_workspaces.id`). */
  workspaceId: string;
  /** The Sandbox SDK stub returned from `getSandbox()`. */
  sandbox: SandboxStub;
  /** The full sandbox identity (`org:${orgId}/ws:${workspaceId}`). */
  sandboxName: string;
  /** Optional opencode starter; supplied by Stream H/D when ready. */
  opencodeStarter?: OpencodeStarter;
  /** Hostname used by `exposePort` for opencode's preview URL. */
  exposeHostname?: string;
}

/**
 * Concrete `WorkspaceHandle` for the cloudflare-sandbox provider.
 */
export class CloudflareSandboxHandle implements WorkspaceHandle {
  readonly id: string;
  /** In-sandbox absolute path; tools always treat this as the working dir. */
  readonly rootPath = SANDBOX_WORKSPACE_ROOT;
  readonly remoteEndpoint?: string;
  readonly metadata: {
    sandboxName: string;
    /**
     * Cached opencode base URL (filled lazily by `startOpencode`). Null
     * until opencode has been started for this handle.
     */
    opencodeBaseUrl: string | null;
    /**
     * Lazy starter — boots `opencode serve` in the sandbox, exposes
     * port 4096, and resolves to the public preview URL.
     *
     * If no `opencodeStarter` was supplied at construction time, the
     * stub returns a documented "not yet implemented" string. Stream
     * D's `openCodeProvider` checks for this sentinel and either falls
     * back to the configured `opencodeBaseUrl` or surfaces a clear
     * error.
     */
    startOpencode: () => Promise<string>;
  };

  private readonly sandbox: SandboxStub;

  constructor(opts: CloudflareSandboxHandleOptions) {
    this.id = opts.workspaceId;
    this.sandbox = opts.sandbox;
    const starter = opts.opencodeStarter;
    const hostname = opts.exposeHostname;
    this.metadata = {
      sandboxName: opts.sandboxName,
      opencodeBaseUrl: null,
      startOpencode: async () => {
        if (this.metadata.opencodeBaseUrl) {
          return this.metadata.opencodeBaseUrl;
        }
        if (starter) {
          const url = await starter(this.sandbox);
          this.metadata.opencodeBaseUrl = url;
          return url;
        }
        // Default impl: start opencode serve and expose port 4096. Only
        // works when an `exposeHostname` was supplied so we know how to
        // construct the preview URL.
        if (hostname) {
          await this.sandbox.startProcess(
            'opencode serve --port 4096 --host 0.0.0.0',
            { cwd: SANDBOX_WORKSPACE_ROOT },
          );
          const exposed = await this.sandbox.exposePort(4096, {
            name: 'opencode',
            hostname,
          });
          this.metadata.opencodeBaseUrl = exposed.url;
          return exposed.url;
        }
        // No starter, no hostname — return a sentinel the caller checks.
        return 'opencode-not-configured';
      },
    };
  }

  async exec(
    command: string,
    options?: WorkspaceExecOptions,
  ): Promise<WorkspaceExecResult> {
    const cwd = options?.cwd
      ? this.absolute(options.cwd)
      : SANDBOX_WORKSPACE_ROOT;
    const result = await this.sandbox.exec(command, {
      cwd,
      env: options?.env,
      ...(options?.timeoutMs !== undefined
        ? { signal: AbortSignal.timeout(options.timeoutMs) }
        : {}),
    });
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    };
  }

  async readFile(path: string): Promise<string> {
    const result = await this.sandbox.readFile(this.absolute(path));
    return result.content;
  }

  async writeFile(path: string, content: string): Promise<void> {
    await this.sandbox.writeFile(this.absolute(path), content);
  }

  /**
   * Glob-match files under the workspace root.
   *
   * v1 supports a narrow glob vocabulary — see {@link globToPrefix}.
   * Anything more complex falls back to listing the root recursively
   * and post-filtering by `String.includes`. Callers needing real
   * glob semantics should layer their own matcher on top.
   */
  async listFiles(glob: string): Promise<string[]> {
    const prefix = globToPrefix(glob);
    const target = prefix
      ? this.absolute(prefix)
      : SANDBOX_WORKSPACE_ROOT;
    const result = await this.sandbox.listFiles(target, {
      recursive: true,
      includeHidden: false,
    });
    const filtered = result.files.filter((f) => f.type === 'file');
    if (!glob || glob === '**' || glob === '**/*') {
      return filtered.map((f) => f.absolutePath);
    }
    // Fallback substring match on the literal glob fragments.
    const fragments = glob.split('*').filter((s) => s.length > 0);
    return filtered
      .filter((f) =>
        fragments.every((frag) => f.absolutePath.includes(frag)),
      )
      .map((f) => f.absolutePath);
  }

  /**
   * Resolve a workspace-relative path to an absolute path inside the
   * sandbox. Rejects `..` segments and absolute paths outside
   * `/workspace`.
   */
  private absolute(path: string): string {
    if (path.includes('\0')) {
      throw new Error(
        `Refusing to resolve path with null byte: ${JSON.stringify(path)}`,
      );
    }
    // Normalise leading ./ and trailing /.
    let p = path.replace(/^\.\//, '').replace(/\/+$/, '');
    if (p === '' || p === '.') {
      return SANDBOX_WORKSPACE_ROOT;
    }
    if (p.startsWith('/')) {
      // Caller passed an absolute path — must remain inside /workspace.
      const segments = p.split('/').filter(Boolean);
      if (segments.includes('..')) {
        throw new Error(
          `Path traversal rejected: ${JSON.stringify(path)}`,
        );
      }
      if (!p.startsWith(`${SANDBOX_WORKSPACE_ROOT}/`) && p !== SANDBOX_WORKSPACE_ROOT) {
        throw new Error(
          `Absolute paths must live under ${SANDBOX_WORKSPACE_ROOT}: ${JSON.stringify(path)}`,
        );
      }
      return p;
    }
    const segments = p.split('/').filter(Boolean);
    if (segments.includes('..')) {
      throw new Error(
        `Path traversal rejected: ${JSON.stringify(path)}`,
      );
    }
    return `${SANDBOX_WORKSPACE_ROOT}/${segments.join('/')}`;
  }
}
