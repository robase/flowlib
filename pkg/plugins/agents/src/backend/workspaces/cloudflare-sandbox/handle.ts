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
 * `metadata.getOpencode()` is a lazy starter that boots an OpenCode server
 * inside the sandbox via `@cloudflare/sandbox/opencode`'s `createOpencode`
 * helper. It returns the typed `OpencodeClient` (whose transport routes
 * through `sandbox.containerFetch`, so no `exposePort` / wildcard DNS is
 * required for SDK traffic) plus a server handle. The result is cached
 * on the metadata object — subsequent calls reuse the same client.
 *
 * The lifecycle helper handles container cold-start and process readiness
 * internally (it polls until the OpenCode HTTP port responds), and reuses
 * an existing OpenCode process on the same port if one is already running.
 * That replaces the prior manual `startProcess` + `exposePort` dance which
 * raced cold-start and produced `Sandbox.startProcess - Canceled` errors.
 */

import type {
  WorkspaceCloneInput,
  WorkspaceCloneResult,
  WorkspaceCommandStatus,
  WorkspaceExecOptions,
  WorkspaceExecResult,
  WorkspaceHandle,
} from '../types';
import {
  OutboundCredentialKV,
  type OutboundCredentialKVStore,
  type OutboundVendor,
} from '../../cloudflare/outbound-auth';

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
  readFile(path: string, options?: { encoding?: string }): Promise<{ content: string }>;
  writeFile(path: string, content: string, options?: { encoding?: string }): Promise<unknown>;
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
  destroy(): Promise<void>;
}

/** Structural shape of `@cloudflare/sandbox`'s `Process`. */
export interface SandboxProcess {
  readonly id: string;
  readonly status: string;
  readonly exitCode?: number;
  getLogs(): Promise<{ stdout: string; stderr: string }>;
}

/**
 * The subset of `@cloudflare/sandbox`'s process API the handle uses for
 * detached commands. Cast onto the stub at the call site (kept off the
 * shared {@link SandboxStub} so other providers' process typings don't
 * conflict).
 */
interface ProcCapableSandbox {
  startProcess(
    command: string,
    options?: { cwd?: string; env?: Record<string, string | undefined> },
  ): Promise<SandboxProcess>;
  getProcess(id: string): Promise<SandboxProcess | null>;
}

/**
 * Structural shape of the result returned by
 * `@cloudflare/sandbox/opencode`'s `createOpencode()`. We import the
 * type loosely so the workspace handle doesn't take a hard runtime
 * dependency on `@opencode-ai/sdk`.
 */
export interface OpencodeServerHandle {
  port: number;
  url: string;
  close(): Promise<void>;
}

export interface OpencodeBundle {
  client: unknown;
  server: OpencodeServerHandle;
}

/**
 * Options passed through to `createOpencode()`. Mirrors `OpencodeOptions`
 * from `@cloudflare/sandbox/opencode` without forcing the import.
 */
export interface OpencodeBootOptions {
  port?: number;
  directory?: string;
  config?: Record<string, unknown>;
  env?: Record<string, string>;
}

/**
 * Loader contract for `@cloudflare/sandbox/opencode`. Tests inject a fake;
 * production code falls through to a dynamic `import()`.
 */
export type OpencodeLoader = (
  sandbox: SandboxStub,
  options?: OpencodeBootOptions,
) => Promise<OpencodeBundle>;

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
  /**
   * Default options merged into every `getOpencode()` call. Typically
   * supplied by the `cloudflareSandbox()` factory and contains the
   * OpenCode `Config` (provider keys, AI Gateway routing, …) plus any
   * extra env vars to forward into the OpenCode process.
   */
  defaultOpencodeOptions?: OpencodeBootOptions;
  /**
   * Test seam — overrides the dynamic import of
   * `@cloudflare/sandbox/opencode`. Production code leaves this unset.
   */
  opencodeLoader?: OpencodeLoader;
  /**
   * When set, the workspace exposes an `outboundAuth` namespace on its
   * metadata (`bindCredential` / `unbindCredential`). The agents
   * endpoint writes per-session credential bindings into this KV store;
   * the consumer Worker's `Sandbox.outboundByHost` handlers read from
   * the same keys to inject auth headers — keeping the LLM API key
   * out of the sandbox container. See [outbound-auth.ts](../../cloudflare/outbound-auth.ts).
   */
  outboundAuth?: { kv: OutboundCredentialKVStore; ttlSeconds?: number };
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
    /** The raw sandbox stub — exposed so providers (e.g. opencode) can call SDK helpers like `containerFetch`. */
    sandbox: SandboxStub;
    /** Cached opencode bundle (filled lazily by `getOpencode`). Null until the first call. */
    opencode: OpencodeBundle | null;
    /**
     * Boot (or return the cached) OpenCode server inside the sandbox via
     * `@cloudflare/sandbox/opencode`. Returns the typed SDK client plus a
     * server handle. Subsequent calls are idempotent and ignore options
     * (the first call wins).
     */
    getOpencode: (options?: OpencodeBootOptions) => Promise<OpencodeBundle>;
    /**
     * Outbound-Workers credential binding surface. Present iff the
     * `cloudflareSandbox()` factory was configured with an
     * `outboundAuth` KV namespace. The opencode provider uses this
     * to pre-decrypt + bind LLM API keys for the session before
     * booting OpenCode with a placeholder header.
     *
     * Absent on workspaces where outbound-Workers auth isn't
     * configured — providers fall back to the legacy in-container
     * key injection path.
     */
    outboundAuth?: {
      bindCredential: (sessionId: string, vendor: OutboundVendor, apiKey: string) => Promise<void>;
      unbindCredential: (sessionId: string, vendor: OutboundVendor) => Promise<void>;
    };
  };

  private readonly sandbox: SandboxStub;

  constructor(opts: CloudflareSandboxHandleOptions) {
    this.id = opts.workspaceId;
    this.sandbox = opts.sandbox;
    const loader = opts.opencodeLoader ?? defaultOpencodeLoader;
    const defaults = opts.defaultOpencodeOptions;

    let inflight: Promise<OpencodeBundle> | undefined;

    const getOpencode = async (override?: OpencodeBootOptions): Promise<OpencodeBundle> => {
      if (this.metadata.opencode) {
        return this.metadata.opencode;
      }
      if (!inflight) {
        const merged: OpencodeBootOptions = {
          directory: SANDBOX_WORKSPACE_ROOT,
          ...defaults,
          ...override,
          // Merge config + env shallowly so callers can extend defaults
          // without dropping factory-supplied provider keys.
          ...(defaults?.config || override?.config
            ? { config: { ...defaults?.config, ...override?.config } }
            : {}),
          ...(defaults?.env || override?.env
            ? { env: { ...defaults?.env, ...override?.env } }
            : {}),
        };
        inflight = loader(this.sandbox, merged)
          .then((bundle) => {
            this.metadata.opencode = bundle;
            return bundle;
          })
          .catch((err) => {
            // Allow retry on next call after a failure.
            inflight = undefined;
            throw err;
          });
      }
      return inflight;
    };

    let outboundAuth: CloudflareSandboxHandle['metadata']['outboundAuth'];
    if (opts.outboundAuth) {
      const credKv = new OutboundCredentialKV(opts.outboundAuth.kv, opts.outboundAuth.ttlSeconds);
      outboundAuth = {
        bindCredential: (sessionId, vendor, apiKey) => credKv.bind(sessionId, vendor, apiKey),
        unbindCredential: (sessionId, vendor) => credKv.unbind(sessionId, vendor),
      };
    }

    this.metadata = {
      sandboxName: opts.sandboxName,
      sandbox: opts.sandbox,
      opencode: null,
      getOpencode,
      outboundAuth,
    };
  }

  async exec(command: string, options?: WorkspaceExecOptions): Promise<WorkspaceExecResult> {
    const cwd = options?.cwd ? this.absolute(options.cwd) : SANDBOX_WORKSPACE_ROOT;
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
    const target = prefix ? this.absolute(prefix) : SANDBOX_WORKSPACE_ROOT;
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
      .filter((f) => fragments.every((frag) => f.absolutePath.includes(frag)))
      .map((f) => f.absolutePath);
  }

  /**
   * Clone a git repo into the workspace. When a `token` is given, a git
   * credential store is configured inside the container so the clone — and
   * later `git push`/`fetch` to the same host — authenticate without the
   * token ever appearing on a command line. The credential file lives under
   * `/workspace` in the isolated, per-org container.
   *
   * NOTE: the token is stored inside the container. That's acceptable for
   * an isolated per-org sandbox (the same trust boundary as the cloned
   * code), and is the standard CI pattern. Hardening to Worker-side egress
   * injection (like the LLM-key path) is a documented follow-up.
   */
  async cloneRepo(input: WorkspaceCloneInput): Promise<WorkspaceCloneResult> {
    const dir = input.dir ?? deriveRepoDir(input.repoUrl);
    assertSafeRelPath(dir);
    const timeoutMs = input.timeoutMs ?? CLONE_TIMEOUT_MS;

    if (input.token) {
      const host = safeHost(input.repoUrl);
      const credFile = `${SANDBOX_WORKSPACE_ROOT}/.flowlib-git-credentials`;
      // x-access-token is GitHub's username convention for PAT/installation tokens.
      await this.sandbox.writeFile(credFile, `https://x-access-token:${input.token}@${host}\n`);
      // `git config` values are constant strings (no token) — safe to inline.
      await this.runConfig(
        `git config --global credential.helper 'store --file=${credFile}' && ` +
          'git config --global user.email "agent@flowlib.dev" && ' +
          'git config --global user.name "Flowlib Agent"',
        timeoutMs,
      );
    }

    const parts = ['git', 'clone'];
    if (input.depth && input.depth > 0) {
      parts.push('--depth', String(input.depth));
    }
    if (input.branch) {
      parts.push('--branch', shArg(input.branch));
    }
    parts.push(shArg(input.repoUrl), shArg(dir));
    const result = await this.sandbox.exec(parts.join(' '), {
      cwd: SANDBOX_WORKSPACE_ROOT,
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { dir, stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
  }

  /**
   * Start a detached command. Requires the SDK's `startProcess` (present on
   * `@cloudflare/sandbox`); throws a clear error if the underlying sandbox
   * doesn't support it.
   */
  async startCommand(command: string, options?: WorkspaceExecOptions): Promise<{ id: string }> {
    const procApi = this.sandbox as unknown as Partial<ProcCapableSandbox>;
    if (typeof procApi.startProcess !== 'function') {
      throw new Error('This sandbox does not support detached commands (startProcess).');
    }
    const cwd = options?.cwd ? this.absolute(options.cwd) : SANDBOX_WORKSPACE_ROOT;
    const proc = await procApi.startProcess(command, { cwd, env: options?.env });
    return { id: proc.id };
  }

  /** Poll a detached command started by {@link startCommand}. */
  async getCommand(id: string): Promise<WorkspaceCommandStatus> {
    const procApi = this.sandbox as unknown as Partial<ProcCapableSandbox>;
    if (typeof procApi.getProcess !== 'function') {
      throw new Error('This sandbox does not support detached commands (getProcess).');
    }
    const proc = await procApi.getProcess(id);
    if (!proc) {
      return { status: 'error', stdout: '', stderr: `No process with id "${id}".` };
    }
    const logs = await proc.getLogs();
    return {
      status: proc.status,
      ...(proc.exitCode !== undefined ? { exitCode: proc.exitCode } : {}),
      stdout: logs.stdout,
      stderr: logs.stderr,
    };
  }

  /** Run a constant config command (no untrusted interpolation). */
  private async runConfig(command: string, timeoutMs: number): Promise<void> {
    await this.sandbox.exec(command, {
      cwd: SANDBOX_WORKSPACE_ROOT,
      signal: AbortSignal.timeout(timeoutMs),
    });
  }

  /**
   * Resolve a workspace-relative path to an absolute path inside the
   * sandbox. Rejects `..` segments and absolute paths outside
   * `/workspace`.
   */
  private absolute(path: string): string {
    if (path.includes('\0')) {
      throw new Error(`Refusing to resolve path with null byte: ${JSON.stringify(path)}`);
    }
    // Normalise leading ./ and trailing /.
    const p = path.replace(/^\.\//, '').replace(/\/+$/, '');
    if (p === '' || p === '.') {
      return SANDBOX_WORKSPACE_ROOT;
    }
    if (p.startsWith('/')) {
      // Caller passed an absolute path — must remain inside /workspace.
      const segments = p.split('/').filter(Boolean);
      if (segments.includes('..')) {
        throw new Error(`Path traversal rejected: ${JSON.stringify(path)}`);
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
      throw new Error(`Path traversal rejected: ${JSON.stringify(path)}`);
    }
    return `${SANDBOX_WORKSPACE_ROOT}/${segments.join('/')}`;
  }
}

/**
 * Default opencode loader — dynamically imports `@cloudflare/sandbox/opencode`
 * the first time it is needed. Cached at module scope so repeated calls
 * across handles only pay the import cost once.
 */
let cachedOpencodeFactory:
  | ((sandbox: unknown, options?: OpencodeBootOptions) => Promise<OpencodeBundle>)
  | undefined;

const defaultOpencodeLoader: OpencodeLoader = async (sandbox, options) => {
  if (!cachedOpencodeFactory) {
    const mod = (await import('@cloudflare/sandbox/opencode')) as {
      createOpencode: (sandbox: unknown, options?: OpencodeBootOptions) => Promise<OpencodeBundle>;
    };
    if (typeof mod.createOpencode !== 'function') {
      throw new Error(
        '[cloudflare-sandbox] @cloudflare/sandbox/opencode did not expose `createOpencode`',
      );
    }
    cachedOpencodeFactory = mod.createOpencode;
  }
  return cachedOpencodeFactory(sandbox, options);
};

/**
 * Reset the cached opencode factory. Used by tests; production code never
 * calls this. @internal
 */
export function _resetOpencodeFactoryCacheForTests(): void {
  cachedOpencodeFactory = undefined;
}

/** Default clone timeout (clones run over the long-lived RPC transport). */
const CLONE_TIMEOUT_MS = 180_000;

/** POSIX single-quote a shell argument (guards against injection). */
function shArg(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Derive a target directory name from a clone URL (`…/owner/repo.git` → `repo`). */
export function deriveRepoDir(repoUrl: string): string {
  const last = repoUrl
    .replace(/\.git$/, '')
    .replace(/\/+$/, '')
    .split('/')
    .pop();
  const name = (last ?? '').trim();
  return /^[a-zA-Z0-9._-]+$/.test(name) ? name : 'repo';
}

/** Host of a clone URL, defaulting to github.com on parse failure. */
function safeHost(repoUrl: string): string {
  try {
    return new URL(repoUrl).host || 'github.com';
  } catch {
    return 'github.com';
  }
}

/** Reject directory names that escape the workspace root. */
function assertSafeRelPath(dir: string): void {
  if (dir.startsWith('/') || dir.split('/').includes('..') || dir.includes('\0')) {
    throw new Error(`Unsafe clone directory: ${JSON.stringify(dir)}`);
  }
}
