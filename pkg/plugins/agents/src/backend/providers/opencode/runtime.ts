/**
 * opencode runtime helpers — lazy SDK loading, embedded-server cache, and
 * per-baseUrl HTTP client cache.
 *
 * The opencode SDK (`@opencode-ai/sdk`) ships with two factories:
 *
 *   - `createOpencode({ config })`        — embeds an in-process server.
 *   - `createOpencodeClient({ baseUrl })` — talks to a remote `opencode serve`.
 *
 * v1's recommended deployment is **external mode + Cloudflare Sandbox**:
 * opencode runs inside the workspace's `cloudflareSandbox` container and the
 * provider talks to it over HTTP. The sandbox is the security boundary
 * (opencode lacks Claude Code's synchronous `canUseTool` callback).
 *
 * Embedded mode is supported for local dev / non-CF deployments where the
 * caller is comfortable running opencode in-process. We cache one
 * `createOpencode()` server per workspace (keyed by `directory`); sessions
 * multiplex over it.
 *
 * **Lazy import contract:** the dynamic `import('@opencode-ai/sdk')` happens
 * exactly once per process the first time `getSdk()` is called. Modules that
 * only register the provider but never run a session pay no SDK import cost.
 */

import type { WorkspaceHandle } from '../../workspaces/types';

// ─── SDK shapes (structural, not bound to a specific SDK version) ───────

/**
 * The slice of the opencode SDK we depend on. Defined structurally so we
 * don't have to keep up with the SDK's `gen/sdk.gen.d.ts` line-by-line.
 */
/**
 * The v2 opencode SDK (`@opencode-ai/sdk/v2/client`) uses a **flat**
 * parameter shape: each method takes a single object whose keys are
 * routed to URL path / query / body via the SDK's internal field map.
 * Do NOT nest under `{ path: {…}, body: {…}, query: {…} }` — those keys
 * are not in the field map and would be silently dropped, leaving URL
 * placeholders like `{sessionID}` un-substituted and the server
 * rejecting the request with a Zod validation error.
 */
export interface OpencodeClientLike {
  session: {
    create(options: {
      title?: string;
      parentID?: string;
      directory?: string;
    }): Promise<{ data?: { id: string } } | { id: string }>;
    prompt(options: {
      sessionID: string;
      parts: Array<unknown>;
      model?: { providerID: string; modelID: string };
      system?: string;
      tools?: Record<string, boolean>;
      directory?: string;
    }): Promise<unknown>;
    /**
     * Fire-and-forget version of `prompt`. Posts the user message to
     * `/session/{sessionID}/prompt_async` and returns immediately with
     * an ack, without waiting for the LLM. Used by the provider's
     * polling loop to escape Cloudflare Sandbox's `containerFetch`
     * request-lifetime budget — see provider.ts comment block for the
     * full rationale.
     */
    promptAsync(options: {
      sessionID: string;
      parts: Array<unknown>;
      model?: { providerID: string; modelID: string };
      system?: string;
      tools?: Record<string, boolean>;
      directory?: string;
    }): Promise<unknown>;
    abort(options: { sessionID: string; directory?: string }): Promise<unknown>;
    delete(options: { sessionID: string; directory?: string }): Promise<unknown>;
    messages(options: { sessionID: string; directory?: string }): Promise<unknown>;
  };
  event: {
    subscribe(options?: { directory?: string }): Promise<{
      stream: AsyncGenerator<unknown, unknown, unknown>;
    }>;
  };
  provider: {
    list(options?: { directory?: string }): Promise<unknown>;
  };
}

/**
 * Embedded-mode handle — the in-process server plus its client. The server
 * exposes `close()` for cleanup; the client is a normal `OpencodeClientLike`.
 */
export interface EmbeddedOpencode {
  client: OpencodeClientLike;
  server: { url: string; close(): void };
}

interface OpencodeSdkModule {
  createOpencodeClient(config: { baseUrl: string; directory?: string }): OpencodeClientLike;
  createOpencode?(options?: {
    hostname?: string;
    port?: number;
    signal?: AbortSignal;
    timeout?: number;
    config?: Record<string, unknown>;
  }): Promise<EmbeddedOpencode>;
}

// ─── Lazy SDK loader ────────────────────────────────────────────────────

let cachedSdk: OpencodeSdkModule | undefined;

/**
 * Lazy-load `@opencode-ai/sdk` exactly once per process.
 *
 * Throws a friendly error if the peer dep isn't installed — opencode is an
 * optional peer, so apps that only use the Claude Code provider don't have
 * it on their resolver path.
 */
export async function getSdk(): Promise<OpencodeSdkModule> {
  if (cachedSdk) {
    return cachedSdk;
  }
  try {
    // Dynamic import keeps this off the module-load path and avoids
    // bundlers from inlining the SDK into provider-thin builds.
    const mod = (await import('@opencode-ai/sdk')) as unknown as OpencodeSdkModule;
    if (typeof mod.createOpencodeClient !== 'function') {
      throw new Error('[agents/opencode] @opencode-ai/sdk did not expose `createOpencodeClient`');
    }
    cachedSdk = mod;
    return mod;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `[agents/opencode] failed to load @opencode-ai/sdk — install it as a peer dependency: ${reason}`,
    );
  }
}

/**
 * Reset the cached SDK reference. Used by tests; production code never calls.
 *
 * @internal
 */
export function _resetSdkCacheForTests(): void {
  cachedSdk = undefined;
}

// ─── Client cache ───────────────────────────────────────────────────────

/**
 * Per-baseUrl client cache. The opencode HTTP client is a thin wrapper
 * around `fetch`, but constructing it instantiates a tree of subclient
 * objects (`session`, `event`, `provider`, …); we only do that once per
 * baseUrl.
 */
const clientByBaseUrl = new Map<string, OpencodeClientLike>();

export async function getClient(baseUrl: string, directory?: string): Promise<OpencodeClientLike> {
  const cacheKey = `${baseUrl}::${directory ?? ''}`;
  const existing = clientByBaseUrl.get(cacheKey);
  if (existing) {
    return existing;
  }
  const sdk = await getSdk();
  const client = sdk.createOpencodeClient({ baseUrl, directory });
  clientByBaseUrl.set(cacheKey, client);
  return client;
}

/**
 * Drop every cached client. Called from `provider.shutdown()`.
 * @internal
 */
export function clearClientCache(): void {
  clientByBaseUrl.clear();
}

// ─── Embedded-mode server cache ─────────────────────────────────────────

/**
 * One embedded opencode server per workspace directory. Keyed by directory
 * so two agents pointed at the same workspace share a single server (and
 * its filesystem locks / LSP processes) — opencode is designed to be
 * multiplexed across sessions.
 */
const embeddedByDirectory = new Map<string, EmbeddedOpencode>();

/**
 * Lazily start (or return the cached) embedded opencode server for a
 * given workspace `directory`. The directory is the cache key — pass an
 * empty string for "no specific directory".
 *
 * The opencode embedded server starts the same set of subprocesses
 * (LSP, tree-sitter, formatters, …) that `opencode serve` does, so this
 * is genuinely a heavyweight operation; cache aggressively.
 */
export async function getEmbedded(directory: string): Promise<EmbeddedOpencode> {
  const existing = embeddedByDirectory.get(directory);
  if (existing) {
    return existing;
  }
  const sdk = await getSdk();
  if (typeof sdk.createOpencode !== 'function') {
    throw new Error(
      '[agents/opencode] @opencode-ai/sdk did not expose `createOpencode` — embedded mode unavailable; use mode: "external"',
    );
  }
  const handle = await sdk.createOpencode({});
  embeddedByDirectory.set(directory, handle);
  return handle;
}

/**
 * Tear down every cached embedded server. Called from `provider.shutdown()`.
 * @internal
 */
export function clearEmbeddedCache(): void {
  for (const handle of embeddedByDirectory.values()) {
    try {
      handle.server.close();
    } catch {
      // best-effort
    }
  }
  embeddedByDirectory.clear();
}

// ─── baseUrl resolution ─────────────────────────────────────────────────

/**
 * Resolve the opencode HTTP base URL the provider should connect to.
 *
 * Priority (highest first):
 *
 *   1. `workspace.metadata.opencodeBaseUrl` — set by `cloudflareSandbox`
 *      when the sandbox boots an opencode server.
 *   2. `extras.baseUrl` — escape hatch for tests + ops who run their
 *      own `opencode serve` outside the sandbox.
 *   3. `factoryBaseUrl` — provider-factory option, e.g. a fixed external
 *      `opencode serve` instance.
 *   4. `OPENCODE_BASE_URL` env var — process-wide fallback.
 *
 * Throws when none resolve.
 */
export function resolveBaseUrl(input: {
  workspace?: WorkspaceHandle;
  extras?: Record<string, unknown>;
  factoryBaseUrl?: string;
}): string {
  const fromWorkspace = (input.workspace?.metadata ?? {}) as Record<string, unknown>;
  const fromMetadata =
    typeof fromWorkspace.opencodeBaseUrl === 'string'
      ? (fromWorkspace.opencodeBaseUrl as string)
      : undefined;
  if (fromMetadata) {
    return fromMetadata;
  }

  const fromExtras = input.extras?.baseUrl;
  if (typeof fromExtras === 'string' && fromExtras.length > 0) {
    return fromExtras;
  }

  if (input.factoryBaseUrl && input.factoryBaseUrl.length > 0) {
    return input.factoryBaseUrl;
  }

  const fromEnv = typeof process !== 'undefined' ? process.env?.OPENCODE_BASE_URL : undefined;
  if (typeof fromEnv === 'string' && fromEnv.length > 0) {
    return fromEnv;
  }

  throw new Error(
    '[agents/opencode] no opencode baseUrl resolved — expected `workspace.metadata.opencodeBaseUrl` ' +
      '(set by cloudflareSandbox), `extras.baseUrl`, factory `baseUrl`, or `OPENCODE_BASE_URL` env',
  );
}

/**
 * Mode selector for the opencode connection.
 *
 *   - `'sandbox'`: typed client returned by `@cloudflare/sandbox/opencode`'s
 *     `createOpencode()`. The transport routes through `sandbox.containerFetch`,
 *     so no `exposePort` / wildcard DNS is required and the helper handles
 *     container cold-start + port readiness internally. This is the v1
 *     production path when the workspace is a `cloudflareSandbox`.
 *   - `'external'`: HTTP client → an existing `opencode serve` reachable
 *     by URL. Useful when ops runs OpenCode out-of-band.
 *   - `'embedded'`: in-process server via the SDK's own `createOpencode()`.
 *     Useful for local dev or single-tenant non-CF deployments.
 */
export type OpencodeMode = 'sandbox' | 'embedded' | 'external';

/**
 * Options accepted by `cloudflareSandbox`'s `metadata.getOpencode`.
 */
export interface SandboxOpencodeOptions {
  port?: number;
  directory?: string;
  config?: Record<string, unknown>;
  env?: Record<string, string>;
}

/**
 * Workspace metadata shape exposed by `cloudflareSandbox` for the
 * sandbox-managed mode. Defined structurally so we don't import the
 * cloudflare-sandbox handle type into the opencode provider.
 */
export interface SandboxOpencodeMetadata {
  getOpencode: (
    options?: SandboxOpencodeOptions,
  ) => Promise<{ client: OpencodeClientLike; server: { url: string } }>;
}

function asSandboxMeta(workspace?: WorkspaceHandle): SandboxOpencodeMetadata | undefined {
  const meta = workspace?.metadata as Record<string, unknown> | undefined;
  if (meta && typeof meta.getOpencode === 'function') {
    return meta as unknown as SandboxOpencodeMetadata;
  }
  return undefined;
}

/**
 * Resolve the right `OpencodeClientLike` for the requested mode.
 *
 * Sandbox mode delegates to `workspace.metadata.getOpencode` (cached on
 * the handle). Embedded mode caches one server per `directory`. External
 * mode falls back to `resolveBaseUrl` for the connection target.
 *
 * `opencodeOverride` is the per-call options blob passed through to
 * `metadata.getOpencode` — typically the multi-provider OpenCode
 * `Config` built from the org's LLM credentials. Only applied to
 * sandbox mode (the other modes don't accept runtime config). The
 * cloudflare-sandbox handle merges this with any factory-level
 * `defaultOpencodeOptions`; first-call wins for caching purposes.
 */
export async function getClientForMode(input: {
  mode: OpencodeMode;
  workspace?: WorkspaceHandle;
  extras?: Record<string, unknown>;
  factoryBaseUrl?: string;
  opencodeOverride?: SandboxOpencodeOptions;
}): Promise<{ client: OpencodeClientLike; baseUrl?: string }> {
  const directory = input.workspace?.rootPath;
  if (input.mode === 'sandbox') {
    const meta = asSandboxMeta(input.workspace);
    if (!meta) {
      throw new Error(
        '[agents/opencode] mode="sandbox" requires a workspace whose metadata exposes `getOpencode` ' +
          '(supplied by `cloudflareSandbox`). Use mode "external" or "embedded" for non-sandbox deployments.',
      );
    }
    const opts: SandboxOpencodeOptions = {
      ...(directory ? { directory } : {}),
      ...input.opencodeOverride,
    };
    const bundle = await meta.getOpencode(opts);
    return { client: bundle.client, baseUrl: bundle.server.url };
  }
  if (input.mode === 'embedded') {
    const handle = await getEmbedded(directory ?? '');
    return { client: handle.client, baseUrl: handle.server.url };
  }
  const baseUrl = resolveBaseUrl({
    workspace: input.workspace,
    extras: input.extras,
    factoryBaseUrl: input.factoryBaseUrl,
  });
  const client = await getClient(baseUrl, directory);
  return { client, baseUrl };
}

// ─── Helpers ────────────────────────────────────────────────────────────

/**
 * The opencode `session.create` response shape changes slightly between
 * `data.id` (HTTP-wrapped) and `id` (already-unwrapped) depending on which
 * client mode is used. Normalise to a string id.
 *
 * heyapi's default `responseStyle: 'fields'` returns
 * `{ data, error, request, response }` even on non-2xx — so we have to
 * check `error` and the HTTP `response.status` before bailing on a
 * missing id, otherwise the bare "no session id" message swallows the
 * real cause (auth failure, opencode boot lag, etc.).
 */
export function unwrapSessionId(resp: unknown): string {
  if (resp && typeof resp === 'object') {
    const r = resp as {
      id?: unknown;
      data?: { id?: unknown };
      error?: unknown;
      response?: { status?: number; statusText?: string };
    };
    // Direct shape (embedded mode unwraps; or HTTP success with responseStyle: 'data').
    if (typeof r.id === 'string') {
      return r.id;
    }
    if (r.data && typeof r.data === 'object' && typeof r.data.id === 'string') {
      return r.data.id;
    }
    // Error shape — surface the actual reason.
    if (r.error !== undefined && r.error !== null) {
      const errMsg =
        typeof r.error === 'string'
          ? r.error
          : ((r.error as { message?: string }).message ?? JSON.stringify(r.error));
      const status = r.response?.status;
      throw new Error(
        `[agents/opencode] session.create failed${status ? ` (HTTP ${status})` : ''}: ${errMsg}`,
      );
    }
    // Non-2xx with no parsed error body.
    const status = r.response?.status;
    if (typeof status === 'number' && status >= 400) {
      throw new Error(
        `[agents/opencode] session.create failed (HTTP ${status} ${r.response?.statusText ?? ''})`,
      );
    }
  }
  throw new Error(
    `[agents/opencode] session.create returned no session id; response=${JSON.stringify(resp)}`,
  );
}

/**
 * Split a flat model id ("anthropic/claude-sonnet-4-7", "openai/gpt-5") into
 * the `{providerID, modelID}` shape the opencode session.prompt API expects.
 *
 * If the input contains no `/`, treat the whole thing as the modelID and
 * leave providerID undefined — opencode will fall back to its config.
 */
export function splitModelId(
  model: string | undefined,
): { providerID: string; modelID: string } | undefined {
  if (!model) {
    return undefined;
  }
  const slash = model.indexOf('/');
  if (slash === -1) {
    return undefined;
  }
  const providerID = model.slice(0, slash);
  const modelID = model.slice(slash + 1);
  if (!providerID || !modelID) {
    return undefined;
  }
  return { providerID, modelID };
}

/**
 * Build the `tools` flag map the opencode session.prompt API accepts.
 *
 * `enabledTools` (whitelist) wins over `extraDenied` when both supplied.
 * Returns `undefined` when neither is set (opencode then uses its
 * configured default).
 */
export function buildToolsMap(input: {
  enabledTools?: ReadonlyArray<string>;
  extraDenied?: ReadonlyArray<string>;
}): Record<string, boolean> | undefined {
  if (input.enabledTools && input.enabledTools.length > 0) {
    const map: Record<string, boolean> = {};
    for (const tool of input.enabledTools) {
      map[tool] = true;
    }
    // Anything not listed defaults to disabled — but opencode's API
    // semantics for "absent key" is "use default", so we explicitly
    // set the deny side as well when it's a whitelist context.
    return map;
  }
  if (input.extraDenied && input.extraDenied.length > 0) {
    const map: Record<string, boolean> = {};
    for (const tool of input.extraDenied) {
      map[tool] = false;
    }
    return map;
  }
  return undefined;
}
