/**
 * `cloudflareSandbox()` — `WorkspaceProvider` factory backed by
 * `@cloudflare/sandbox` Durable Objects.
 *
 * Each workspace maps to a sandbox container at the stable id
 *   `org:${orgId}/ws:${workspaceId}`
 * so the same workspace reuses its sandbox across sessions and reconnects
 * cheaply after the SDK puts the container to sleep.
 *
 * ## Env binding plumbing
 *
 * Cloudflare bindings (`env.SANDBOX`) are only valid inside a request
 * scope, not at module load time. Provider singletons live for the
 * lifetime of the plugin process, so they cannot capture an `env`
 * eagerly.
 *
 * The factory therefore accepts an `envAccessor` callback. Stream H
 * (the `AIChatAgent` DO that drives requests) wires the per-request
 * `env` through `setSandboxEnv()` on the provider, and the lifecycle
 * methods read it back when called. Hosts that prefer to pass `env`
 * directly at construction time (single-binding-per-process Workers)
 * can supply a static accessor — `() => env` — when they build the
 * `cloudflareSandbox` instance.
 *
 * ```ts
 * // Wrangler-bound Worker example (Stream H will do this for us):
 * const provider = cloudflareSandbox({ namespaceBinding: 'SANDBOX' });
 * provider.setEnv(env); // before delegating to AgentService
 * const handle = await provider.create({ ... });
 * ```
 *
 * The setter is exposed as a non-`WorkspaceProvider` extension method;
 * the `WorkspaceProvider` interface contract itself is unchanged.
 *
 * ## R2 mounts
 *
 * If `persistentBucketBinding` is set, the provider mounts that R2
 * bucket at `/workspace/persistent` on `create`. v1 keeps the mount
 * scoped to a single bucket per provider; per-org prefixes are derived
 * from the sandbox id. The mount is best-effort — if the binding is
 * missing or the SDK throws, we log and continue (the workspace works
 * without persistence; only the persistent dir is degraded).
 */

import type { AgentsAuthContext } from '../../../shared/auth-context';
import type { CreateWorkspaceInput, WorkspaceHandle, WorkspaceProvider } from '../types';
import {
  CloudflareSandboxHandle,
  type OpencodeBootOptions,
  type OpencodeLoader,
  type SandboxStub,
} from './handle';

/**
 * Lookup contract the provider uses to materialise a sandbox stub by id.
 *
 * In production this is `getSandbox(env[binding], id)` from
 * `@cloudflare/sandbox`. Tests inject a stub factory so they don't need
 * a workerd runtime. Keeping the indirection explicit also lets the
 * factory be lazily wired with `env` per request.
 */
export type SandboxLookup = (id: string) => SandboxStub | Promise<SandboxStub>;

/**
 * Minimal shape of the Worker `env` we expect — a record with one
 * `DurableObjectNamespace`-shaped property at `namespaceBinding` and
 * an optional R2 bucket binding. Typed loosely on purpose: the actual
 * `env` shape is host-specific and we resolve at runtime.
 */
export interface CloudflareSandboxEnv {
  [binding: string]: unknown;
}

export interface CloudflareSandboxOptions {
  /** Wrangler binding name for the Sandbox DO namespace (e.g. `'SANDBOX'`). */
  namespaceBinding: string;
  /** Sandbox instance type. Defaults to `'lite'`. */
  instanceType?: 'lite' | 'standard' | 'heavy';
  /** Idle timeout before the sandbox stops (e.g. `'10m'`). */
  sleepAfter?: string;
  /** Optional R2 bucket binding name for `/workspace/persistent`. */
  persistentBucketBinding?: string;
  /**
   * Default options forwarded to `createOpencode()` when the workspace's
   * `metadata.getOpencode()` is invoked. Typical use: pin the OpenCode
   * `Config` (provider keys, AI Gateway routing) and forward env vars
   * (e.g. `ANTHROPIC_API_KEY`) into the in-container OpenCode process.
   *
   * Per-call overrides supplied to `getOpencode()` shallow-merge on top
   * of these defaults (with `config` and `env` merged key-by-key).
   */
  opencodeOptions?: OpencodeBootOptions;
  /**
   * Test seam — overrides the dynamic import of
   * `@cloudflare/sandbox/opencode`. Production code leaves this unset.
   */
  opencodeLoader?: OpencodeLoader;
  /**
   * Test seam — supply a sandbox lookup that bypasses
   * `@cloudflare/sandbox`. When set, the provider ignores
   * `namespaceBinding` / env entirely.
   */
  sandboxLookup?: SandboxLookup;
  /**
   * Static env accessor. When the host can capture `env` once (e.g.
   * single-binding-per-process Workers), supply an accessor here to
   * skip the per-request `setEnv()` dance.
   */
  envAccessor?: () => CloudflareSandboxEnv;
}

/**
 * Provider extension surface — exposed to Stream H so it can wire the
 * per-request `env` without modifying the `WorkspaceProvider` contract.
 */
export interface CloudflareSandboxProvider extends WorkspaceProvider {
  /**
   * Set the active Worker `env` for subsequent calls. Stream H calls
   * this at the top of each request handler before delegating to the
   * `AgentService`.
   */
  setEnv(env: CloudflareSandboxEnv): void;
  /** Clear the captured env (call after request settles). */
  clearEnv(): void;
}

/**
 * Build the stable sandbox identity used by both `getSandbox` and the
 * UI / audit log.
 *
 * Cloudflare's Sandbox SDK rejects IDs longer than 63 chars and accepts
 * only alphanumerics + `-` + `_`. With UUID orgIds and workspaceIds the
 * naive `org:${orgId}/ws:${workspaceId}` form is 80 chars and contains
 * `:` / `/`, both invalid. We collapse to a short, hyphen-separated form
 * that keeps a per-org prefix for log readability while staying well
 * under the limit:
 *
 *   o${orgId.slice(0, 8)}-${workspaceId}
 *
 * For UUID inputs that's 1 + 8 + 1 + 36 = 46 chars — safe. The
 * 8-char org prefix is an audit-log hint, not a security boundary;
 * tenant isolation comes from the DB layer (workspaces.org_id) +
 * cross-tenant 404s in the endpoint, and the workspaceId UUID is itself
 * globally unique.
 *
 * Non-alphanumeric characters in the inputs are normalised to hyphens
 * defensively; if the result is still over 63 chars (e.g. caller used a
 * very long custom workspaceId), we truncate.
 */
export function buildSandboxName(
  auth: Pick<AgentsAuthContext, 'orgId'>,
  workspaceId: string,
): string {
  if (!auth.orgId) {
    throw new Error('cloudflareSandbox: orgId is required');
  }
  if (!workspaceId) {
    throw new Error('cloudflareSandbox: workspaceId is required');
  }
  // Cloudflare's preview-URL routing relies on DNS, which is
  // case-insensitive. The Sandbox SDK refuses any id with uppercase
  // letters when previewing exposed ports. Force lowercase here so
  // mixed-case org/workspace UUIDs don't trip the SDK.
  const sanitize = (s: string): string => s.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  const prefix = sanitize(auth.orgId).slice(0, 8);
  const ws = sanitize(workspaceId);
  const id = `o${prefix}-${ws}`;
  return id.length > 63 ? id.slice(0, 63) : id;
}

/**
 * Stash for `workspaceId → AgentsAuthContext`. `WorkspaceProvider.resolve`
 * and `destroy` only get a workspace id, but we need the orgId to
 * reconstruct the sandbox name. The auth context the SDK passes through
 * `resolve(workspaceId, auth)` covers most cases; this fallback handles
 * `destroy(workspaceId, auth)` consistently.
 */
function makeAuthRequiredError(method: string): Error {
  return new Error(
    `cloudflareSandbox.${method}: AgentsAuthContext.orgId is required to derive the sandbox name`,
  );
}

export function cloudflareSandbox(options: CloudflareSandboxOptions): CloudflareSandboxProvider {
  if (!options.namespaceBinding && !options.sandboxLookup) {
    throw new Error('cloudflareSandbox: `namespaceBinding` is required');
  }

  let activeEnv: CloudflareSandboxEnv | undefined;
  const defaultOpencodeOptions = options.opencodeOptions;
  const opencodeLoader = options.opencodeLoader;

  /**
   * Resolve the active env. Order:
   *   1. `setEnv()` (per-request)
   *   2. `options.envAccessor` (static)
   *   3. throw — caller must wire one before invoking lifecycle methods
   */
  const getEnv = (): CloudflareSandboxEnv => {
    if (activeEnv) {
      return activeEnv;
    }
    if (options.envAccessor) {
      return options.envAccessor();
    }
    throw new Error(
      'cloudflareSandbox: no Worker env set. Call `setEnv(env)` from your request handler or supply `envAccessor` at construction.',
    );
  };

  /**
   * Materialise a sandbox stub for a given identity. Test seam first;
   * otherwise lazy-import `@cloudflare/sandbox` and call `getSandbox`.
   */
  /**
   * Cached SDK module. We dynamic-`import()` it on first use so the
   * provider can be constructed in environments where the SDK isn't
   * installed (the package is in `peerDependencies`, not `dependencies`).
   * `tsdown.deps.neverBundle` keeps the import external in builds.
   */
  let sdkPromise:
    | Promise<{
        getSandbox: (ns: unknown, id: string) => SandboxStub;
      }>
    | undefined;

  const loadSdk = (): Promise<{
    getSandbox: (ns: unknown, id: string) => SandboxStub;
  }> => {
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
        `cloudflareSandbox: env binding ${JSON.stringify(
          options.namespaceBinding,
        )} is not configured`,
      );
    }
    const sdk = await loadSdk();
    return sdk.getSandbox(ns, id);
  };

  /**
   * Best-effort R2 mount for `/workspace/persistent`. Failures are
   * logged (via thrown errors that the caller can swallow) but don't
   * break workspace creation.
   */
  const mountPersistent = async (sandbox: SandboxStub, auth: AgentsAuthContext): Promise<void> => {
    if (!options.persistentBucketBinding) {
      return;
    }
    const env = getEnv();
    const bucket = env[options.persistentBucketBinding];
    if (!bucket) {
      return;
    }
    // We don't enforce mount semantics here in v1 — the SDK call is
    // wrapped because it may not exist on test stubs. Use a per-org
    // prefix so multiple orgs sharing one bucket stay isolated.
    const stub = sandbox as SandboxStub & {
      mountBucket?: (
        bucketName: string,
        mountPath: string,
        options: Record<string, unknown>,
      ) => Promise<void>;
    };
    if (typeof stub.mountBucket !== 'function') {
      return;
    }
    await stub.mountBucket(options.persistentBucketBinding, '/workspace/persistent', {
      localBucket: true,
      prefix: `/org/${auth.orgId}`,
    });
  };

  const buildHandle = (
    workspaceId: string,
    sandbox: SandboxStub,
    sandboxName: string,
  ): CloudflareSandboxHandle =>
    new CloudflareSandboxHandle({
      workspaceId,
      sandbox,
      sandboxName,
      defaultOpencodeOptions,
      opencodeLoader,
    });

  return {
    id: 'cloudflare-sandbox',
    name: 'Cloudflare Sandbox',

    setEnv(env) {
      activeEnv = env;
    },
    clearEnv() {
      activeEnv = undefined;
    },

    async create(input: CreateWorkspaceInput): Promise<WorkspaceHandle> {
      if (!input.auth?.orgId) {
        throw makeAuthRequiredError('create');
      }
      const sandboxName = buildSandboxName(input.auth, input.workspaceId);
      const sandbox = await lookupSandbox(sandboxName);

      // Optionally mount the persistent bucket. Best-effort.
      try {
        await mountPersistent(sandbox, input.auth);
      } catch (err) {
        // Surface as a soft warning via Error → caller logs. We don't
        // have a logger here (provider is constructed before plugin
        // init); Stream H can wrap the call.
        // eslint-disable-next-line no-console
        console.warn(
          `[cloudflare-sandbox] mountBucket failed for ${sandboxName}:`,
          err instanceof Error ? err.message : err,
        );
      }
      return buildHandle(input.workspaceId, sandbox, sandboxName);
    },

    async resolve(workspaceId: string, auth: AgentsAuthContext): Promise<WorkspaceHandle> {
      if (!auth?.orgId) {
        throw makeAuthRequiredError('resolve');
      }
      const sandboxName = buildSandboxName(auth, workspaceId);
      const sandbox = await lookupSandbox(sandboxName);
      return buildHandle(workspaceId, sandbox, sandboxName);
    },

    async destroy(workspaceId: string, auth: AgentsAuthContext): Promise<void> {
      if (!auth?.orgId) {
        throw makeAuthRequiredError('destroy');
      }
      const sandboxName = buildSandboxName(auth, workspaceId);
      const sandbox = await lookupSandbox(sandboxName);
      await sandbox.destroy();
    },
  };
}
