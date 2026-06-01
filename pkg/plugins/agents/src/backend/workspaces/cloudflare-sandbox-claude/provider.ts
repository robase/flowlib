/**
 * `cloudflareSandboxClaude()` — sibling of `cloudflareSandbox()` for
 * deployments that ship a sandbox image with `@anthropic-ai/claude-code`
 * (and the `@anthropic-ai/claude-agent-sdk` peer dep) baked in. Runs an
 * in-container HTTP server (see `runtime/claude-code-server/server.mjs`)
 * and exposes a typed client to the host's claude-code provider via
 * `sandbox.containerFetch`.
 *
 * Architecturally identical to `cloudflareSandbox` — same `setEnv()`
 * dance, same per-org sandbox naming via `buildSandboxName`, same
 * lazy SDK load. The only meaningful difference is the metadata
 * exposed on the workspace handle: `getClaudeCode()` instead of
 * `getOpencode()`.
 *
 * Hosts that want both opencode and claude-code agents register both
 * providers on the agents plugin:
 *
 * ```ts
 * agents({
 *   workspaceProviders: [
 *     cloudflareSandbox({ namespaceBinding: 'SANDBOX', ... }),
 *     cloudflareSandboxClaude({ namespaceBinding: 'SANDBOX_CLAUDE', ... }),
 *   ],
 * })
 * ```
 *
 * Each persisted workspace stores the provider id it was created with,
 * so the right binding is used when resolving sessions.
 */

import type { AgentsAuthContext } from '../../../shared/auth-context';
import type { CreateWorkspaceInput, WorkspaceHandle, WorkspaceProvider } from '../types';
import type { SandboxStub } from '../cloudflare-sandbox/handle';
import { buildSandboxName } from '../cloudflare-sandbox/provider';
import {
  CloudflareSandboxClaudeHandle,
  type ClaudeServerBootOptions,
  type ClaudeServerClient,
  type ClaudeServerLoader,
} from './handle';

/**
 * Path inside the container where the claude-code server lives.
 * The Dockerfile is responsible for COPY-ing
 * `runtime/claude-code-server/server.mjs` from `@flowlib/agents` here.
 */
const DEFAULT_SERVER_PATH = '/opt/claude-code-server/server.mjs';
const DEFAULT_PORT = 4097;
const DEFAULT_NODE_BIN = 'node';

/**
 * Surface of the sandbox stub the production loader uses on top of the
 * minimal `SandboxStub`. Declared loosely because the `@cloudflare/sandbox`
 * surface is in flux and we don't want to take a hard type dep.
 */
interface SandboxStubWithProcs extends SandboxStub {
  startProcess(
    command: string,
    options?: { cwd?: string; env?: Record<string, string>; processName?: string },
  ): Promise<{ pid: number | string }>;
  containerFetch(
    request: Request | string,
    init?: RequestInit,
    portOrOptions?: number | { port?: number },
  ): Promise<Response>;
  exposePort?(port: number, options?: { hostname?: string }): Promise<{ url: string } | string>;
}

export interface CloudflareSandboxClaudeEnv {
  [binding: string]: unknown;
}

export interface CloudflareSandboxClaudeOptions {
  /** Wrangler binding name for the Sandbox DO namespace (e.g. `'SANDBOX_CLAUDE'`). */
  namespaceBinding: string;
  /** Sandbox instance type. Defaults to `'lite'`. */
  instanceType?: 'lite' | 'standard' | 'heavy';
  /** Idle timeout before the sandbox stops (e.g. `'10m'`). */
  sleepAfter?: string;
  /** Default options for `getClaudeCode()` per workspace. */
  claudeServerOptions?: ClaudeServerBootOptions;
  /** Test seam — overrides the default in-container start/wait flow. */
  claudeServerLoader?: ClaudeServerLoader;
  /** Test seam — bypasses `@cloudflare/sandbox` entirely. */
  sandboxLookup?: (id: string) => SandboxStub | Promise<SandboxStub>;
  /** Static env accessor, used when `setEnv()` isn't called per request. */
  envAccessor?: () => CloudflareSandboxClaudeEnv;
}

export interface CloudflareSandboxClaudeProvider extends WorkspaceProvider {
  setEnv(env: CloudflareSandboxClaudeEnv): void;
  clearEnv(): void;
}

export function cloudflareSandboxClaude(
  options: CloudflareSandboxClaudeOptions,
): CloudflareSandboxClaudeProvider {
  if (!options.namespaceBinding && !options.sandboxLookup) {
    throw new Error('cloudflareSandboxClaude: `namespaceBinding` is required');
  }

  let activeEnv: CloudflareSandboxClaudeEnv | undefined;
  const defaultBootOptions = options.claudeServerOptions;
  const claudeServerLoader = options.claudeServerLoader ?? defaultClaudeServerLoader;

  const getEnv = (): CloudflareSandboxClaudeEnv => {
    if (activeEnv) {
      return activeEnv;
    }
    if (options.envAccessor) {
      return options.envAccessor();
    }
    throw new Error(
      'cloudflareSandboxClaude: no Worker env set. Call `setEnv(env)` from your request handler ' +
        'or supply `envAccessor` at construction.',
    );
  };

  let sdkPromise: Promise<{ getSandbox: (ns: unknown, id: string) => SandboxStub }> | undefined;

  const loadSdk = (): Promise<{ getSandbox: (ns: unknown, id: string) => SandboxStub }> => {
    if (!sdkPromise) {
      sdkPromise = import('@cloudflare/sandbox') as Promise<{
        getSandbox: (ns: unknown, id: string) => SandboxStub;
      }>;
    }
    return sdkPromise;
  };

  const lookupSandbox = async (id: string): Promise<SandboxStub> => {
    if (options.sandboxLookup) {
      return options.sandboxLookup(id);
    }
    const env = getEnv();
    const ns = env[options.namespaceBinding];
    if (!ns) {
      throw new Error(
        `cloudflareSandboxClaude: env binding ${JSON.stringify(
          options.namespaceBinding,
        )} is not configured`,
      );
    }
    const sdk = await loadSdk();
    return sdk.getSandbox(ns, id);
  };

  const buildHandle = (
    workspaceId: string,
    sandbox: SandboxStub,
    sandboxName: string,
  ): CloudflareSandboxClaudeHandle =>
    new CloudflareSandboxClaudeHandle({
      workspaceId,
      sandbox,
      sandboxName,
      defaultBootOptions,
      claudeServerLoader,
    });

  return {
    id: 'cloudflare-sandbox-claude',
    name: 'Cloudflare Sandbox (Claude Code)',

    setEnv(env) {
      activeEnv = env;
    },
    clearEnv() {
      activeEnv = undefined;
    },

    async create(input: CreateWorkspaceInput): Promise<WorkspaceHandle> {
      if (!input.auth?.orgId) {
        throw new Error(
          'cloudflareSandboxClaude.create: AgentsAuthContext.orgId is required to derive the sandbox name',
        );
      }
      const sandboxName = buildSandboxName(input.auth, input.workspaceId);
      const sandbox = await lookupSandbox(sandboxName);
      return buildHandle(input.workspaceId, sandbox, sandboxName);
    },

    async resolve(workspaceId: string, auth: AgentsAuthContext): Promise<WorkspaceHandle> {
      if (!auth?.orgId) {
        throw new Error(
          'cloudflareSandboxClaude.resolve: AgentsAuthContext.orgId is required to derive the sandbox name',
        );
      }
      const sandboxName = buildSandboxName(auth, workspaceId);
      const sandbox = await lookupSandbox(sandboxName);
      return buildHandle(workspaceId, sandbox, sandboxName);
    },

    async destroy(workspaceId: string, auth: AgentsAuthContext): Promise<void> {
      if (!auth?.orgId) {
        throw new Error(
          'cloudflareSandboxClaude.destroy: AgentsAuthContext.orgId is required to derive the sandbox name',
        );
      }
      const sandboxName = buildSandboxName(auth, workspaceId);
      const sandbox = await lookupSandbox(sandboxName);
      await sandbox.destroy();
    },
  };
}

/**
 * Default loader: starts the in-container claude server (idempotent
 * across calls because the server caches its child by port), polls
 * `/health` until ready, then returns a `containerFetch`-backed client.
 *
 * The server stays running for the lifetime of the sandbox container.
 * Sleep/wake cycles re-run this loader; the host always polls /health
 * before issuing a session create, so a cold container that needs the
 * server respawned just pays a short wait.
 */
const defaultClaudeServerLoader: ClaudeServerLoader = async (sandbox, options) => {
  const port = options?.port ?? DEFAULT_PORT;
  const serverPath = options?.serverPath ?? DEFAULT_SERVER_PATH;
  const nodeBin = options?.nodeBin ?? DEFAULT_NODE_BIN;
  const stub = sandbox as SandboxStubWithProcs;

  if (typeof stub.startProcess !== 'function' || typeof stub.containerFetch !== 'function') {
    throw new Error(
      '[cloudflare-sandbox-claude] sandbox stub is missing `startProcess` / `containerFetch`. ' +
        'Update @cloudflare/sandbox or pass a custom `claudeServerLoader`.',
    );
  }

  const env: Record<string, string> = {
    ...options?.env,
    CLAUDE_SERVER_PORT: String(port),
  };

  // Best-effort start. If the server is already running on the port,
  // startProcess may throw or no-op depending on SDK version — we
  // swallow and rely on the readiness probe below.
  try {
    await stub.startProcess(`${nodeBin} ${serverPath}`, {
      cwd: '/workspace',
      env,
      processName: 'claude-code-server',
    });
  } catch {
    // Already running — fall through to /health check.
  }

  const baseUrl = `http://localhost:${port}`;
  await waitForHealth(stub, baseUrl, port);

  const client: ClaudeServerClient = {
    baseUrl,
    async fetch(path, init) {
      const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
      const response = await stub.containerFetch(
        url,
        {
          method: init?.method ?? 'GET',
          body: init?.body,
          headers: { 'Content-Type': 'application/json' },
          ...(init?.signal ? { signal: init.signal } : {}),
        },
        port,
      );
      return {
        status: response.status,
        headers: response.headers,
        body: response.body,
        text: () => response.text(),
      };
    },
  };

  const server = {
    port,
    url: baseUrl,
    async close() {
      // Best-effort shutdown — the sandbox itself owns process
      // lifecycle, so a hard kill isn't ours to make.
      try {
        await client.fetch('/sessions/__all__', { method: 'DELETE' });
      } catch {
        /* noop */
      }
    },
  };

  return { client, server };
};

async function waitForHealth(
  stub: SandboxStubWithProcs,
  baseUrl: string,
  port: number,
): Promise<void> {
  const deadline = Date.now() + 30_000;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const r = await stub.containerFetch(`${baseUrl}/health`, { method: 'GET' }, port);
      if (r.status === 200) {
        return;
      }
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(
    `[cloudflare-sandbox-claude] claude-code-server did not become healthy within 30s: ${
      lastErr instanceof Error ? lastErr.message : String(lastErr ?? 'no /health response')
    }`,
  );
}
