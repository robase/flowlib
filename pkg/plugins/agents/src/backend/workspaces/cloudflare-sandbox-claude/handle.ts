/**
 * `CloudflareSandboxClaudeHandle` — sibling of `CloudflareSandboxHandle`
 * that boots a small `claude-agent-sdk` HTTP server inside the sandbox
 * container and exposes a typed client to the host.
 *
 * Why a sibling rather than an extension: the opencode runtime ships
 * `@cloudflare/sandbox/opencode`'s typed `createOpencode()` helper and
 * uses sandbox.containerFetch as its transport. Claude Code has no
 * equivalent in the sandbox SDK, so we run our own HTTP server (see
 * `runtime/claude-code-server/server.mjs`) and dial it via the same
 * `containerFetch` mechanism.
 *
 * The file/exec methods are identical to `CloudflareSandboxHandle`;
 * only the metadata differs. Path-traversal, glob translation, and
 * exec wiring are kept inline for clarity — duplication is small
 * enough that an abstract base would obscure more than it'd save.
 */

import type { WorkspaceExecOptions, WorkspaceExecResult, WorkspaceHandle } from '../types';
import type { SandboxStub } from '../cloudflare-sandbox/handle';
import { SANDBOX_WORKSPACE_ROOT } from '../cloudflare-sandbox/handle';

/**
 * Options forwarded to the in-container claude-server boot. The host
 * needs to know the API key to mint the SDK env, plus optional
 * model/permission defaults pre-set at session-create time.
 */
export interface ClaudeServerBootOptions {
  /** Port to listen on inside the container. Default: 4097. */
  port?: number;
  /** Absolute server.mjs path inside the container. */
  serverPath?: string;
  /** `node` binary path inside the container. */
  nodeBin?: string;
  /** Forwarded into the server child process env. */
  env?: Record<string, string>;
}

/**
 * Typed client returned by `getClaudeCode()`. Mirrors a subset of the
 * SDK's session shape but proxied over HTTP. The host's claude-code
 * provider consumes this in sandbox mode.
 */
export interface ClaudeServerClient {
  /** Base URL the host can `fetch` against (in-container address). */
  readonly baseUrl: string;
  /** containerFetch wrapper bound to the underlying sandbox stub. */
  fetch(
    path: string,
    init?: { method?: string; body?: string; signal?: AbortSignal },
  ): Promise<{
    status: number;
    headers: Headers;
    body: ReadableStream<Uint8Array> | null;
    text(): Promise<string>;
  }>;
}

export interface ClaudeServerHandle {
  port: number;
  url: string;
  close(): Promise<void>;
}

export interface ClaudeServerBundle {
  client: ClaudeServerClient;
  server: ClaudeServerHandle;
}

/**
 * Loader contract — production wiring boots the server via
 * `sandbox.startProcess()` and waits on /health. Tests can inject a
 * fake bundle.
 */
export type ClaudeServerLoader = (
  sandbox: SandboxStub,
  options?: ClaudeServerBootOptions,
) => Promise<ClaudeServerBundle>;

export interface CloudflareSandboxClaudeHandleOptions {
  workspaceId: string;
  sandbox: SandboxStub;
  sandboxName: string;
  defaultBootOptions?: ClaudeServerBootOptions;
  claudeServerLoader: ClaudeServerLoader;
}

function globToPrefix(glob: string): string {
  if (!glob || glob === '**' || glob === '**/*' || glob === '*') {
    return '';
  }
  const idx = glob.indexOf('*');
  if (idx === -1) {
    return glob;
  }
  let prefix = glob.slice(0, idx);
  if (prefix.endsWith('/')) {
    prefix = prefix.slice(0, -1);
  }
  return prefix;
}

export class CloudflareSandboxClaudeHandle implements WorkspaceHandle {
  readonly id: string;
  readonly rootPath = SANDBOX_WORKSPACE_ROOT;
  readonly remoteEndpoint?: string;
  readonly metadata: {
    sandboxName: string;
    sandbox: SandboxStub;
    /** Cached bundle (filled lazily on first `getClaudeCode()`). */
    claudeServer: ClaudeServerBundle | null;
    getClaudeCode: (options?: ClaudeServerBootOptions) => Promise<ClaudeServerBundle>;
  };

  private readonly sandbox: SandboxStub;

  constructor(opts: CloudflareSandboxClaudeHandleOptions) {
    this.id = opts.workspaceId;
    this.sandbox = opts.sandbox;
    const loader = opts.claudeServerLoader;
    const defaults = opts.defaultBootOptions;

    let inflight: Promise<ClaudeServerBundle> | undefined;

    const getClaudeCode = async (
      override?: ClaudeServerBootOptions,
    ): Promise<ClaudeServerBundle> => {
      if (this.metadata.claudeServer) {
        return this.metadata.claudeServer;
      }
      if (!inflight) {
        const merged: ClaudeServerBootOptions = {
          ...defaults,
          ...override,
          ...(defaults?.env || override?.env
            ? { env: { ...defaults?.env, ...override?.env } }
            : {}),
        };
        inflight = loader(this.sandbox, merged)
          .then((bundle) => {
            this.metadata.claudeServer = bundle;
            return bundle;
          })
          .catch((err) => {
            inflight = undefined;
            throw err;
          });
      }
      return inflight;
    };

    this.metadata = {
      sandboxName: opts.sandboxName,
      sandbox: opts.sandbox,
      claudeServer: null,
      getClaudeCode,
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
    return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
  }

  async readFile(path: string): Promise<string> {
    const result = await this.sandbox.readFile(this.absolute(path));
    return result.content;
  }

  async writeFile(path: string, content: string): Promise<void> {
    await this.sandbox.writeFile(this.absolute(path), content);
  }

  async listFiles(glob: string): Promise<string[]> {
    const prefix = globToPrefix(glob);
    const target = prefix ? this.absolute(prefix) : SANDBOX_WORKSPACE_ROOT;
    const result = await this.sandbox.listFiles(target, { recursive: true, includeHidden: false });
    const filtered = result.files.filter((f) => f.type === 'file');
    if (!glob || glob === '**' || glob === '**/*') {
      return filtered.map((f) => f.absolutePath);
    }
    const fragments = glob.split('*').filter((s) => s.length > 0);
    return filtered
      .filter((f) => fragments.every((frag) => f.absolutePath.includes(frag)))
      .map((f) => f.absolutePath);
  }

  private absolute(path: string): string {
    if (path.includes('\0')) {
      throw new Error(`Refusing to resolve path with null byte: ${JSON.stringify(path)}`);
    }
    const p = path.replace(/^\.\//, '').replace(/\/+$/, '');
    if (p === '' || p === '.') {
      return SANDBOX_WORKSPACE_ROOT;
    }
    if (p.startsWith('/')) {
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
