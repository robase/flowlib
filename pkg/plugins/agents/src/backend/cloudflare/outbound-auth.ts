/**
 * Outbound-Worker authentication helpers for sandboxed agent chats.
 *
 * Mirrors the structure of `cloudflare/sandbox-sdk`'s
 * [authentication example](https://github.com/cloudflare/sandbox-sdk/tree/main/examples/authentication):
 *
 *   - The container makes plain unauthenticated requests to LLM hosts.
 *   - A per-host outbound handler runs in the Worker (NOT the container).
 *   - The handler injects the API key into the request before forwarding
 *     upstream. The container never sees credentials.
 *
 * What this module ships:
 *   1. `OutboundCredentialKV` — a small `KVNamespace` wrapper that hides
 *      the key-naming convention and TTL handling.
 *   2. Handler factories per LLM vendor — `(env) => (req, env) => Response`.
 *      Each factory closes over the KV binding name; the runtime handler
 *      reads `X-Flowlib-Session-Id` from the request, looks up the
 *      session's API key in KV, sets the vendor-specific auth header,
 *      strips the session-id header, and forwards.
 *   3. `buildFlowlibOutboundHandlers()` — bundles the per-host map the
 *      consumer Worker assigns to `Sandbox.outboundByHost`. We don't
 *      ship the `class FlowlibSandbox extends Sandbox` declaration
 *      itself because (a) the user's Worker controls Sandbox subclass
 *      identity (Wrangler binds the class by name) and (b) the
 *      `@cloudflare/sandbox` outbound-Workers feature isn't published
 *      on npm yet — keeping the SDK dependency at the consumer's edge
 *      lets this plugin compile without it.
 *
 * Consumer Worker assembles the pieces:
 *
 * ```ts
 * import { Sandbox as BaseSandbox } from '@cloudflare/sandbox';
 * import { buildFlowlibOutboundHandlers } from '@flowlib/agents';
 *
 * export class Sandbox extends BaseSandbox {
 *   interceptHttps = true;
 * }
 * Sandbox.outboundByHost = buildFlowlibOutboundHandlers({
 *   kvBinding: 'SANDBOX_CRED_KV',
 * });
 * ```
 */

/**
 * Header the container sends so the outbound handler knows which
 * session is making the request. Set by the agents plugin when it
 * boots OpenCode (in `Config.provider.<vendor>.options.headers`).
 *
 * The value is a placeholder identifier — strip before forwarding so
 * upstream LLM APIs don't see it.
 */
export const FLOWLIB_SESSION_HEADER = 'x-flowlib-session-id';

/**
 * Vendor slug used in KV key construction. These match
 * `inferOpencodeProvider`'s slugs so the credential picker and the
 * outbound handler agree on what's bound.
 */
export type OutboundVendor =
  | 'anthropic'
  | 'openai'
  | 'openrouter'
  | 'google'
  | 'cloudflare-ai-gateway';

/**
 * Minimal `KVNamespace` shape so this module compiles without the
 * Cloudflare workers-types peer dep being resolved.
 */
export interface OutboundCredentialKVStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

/**
 * Build a KV key for a (session, vendor) binding. Centralised so
 * the endpoint and handler can't drift apart.
 */
export function credentialKvKey(sessionId: string, vendor: OutboundVendor): string {
  return `agents/cred/session/${sessionId}/${vendor}`;
}

/**
 * Default TTL for credential bindings — 24h. The endpoint also
 * actively deletes on session close; TTL is a backstop for archived
 * / abandoned sessions whose `closeSession` hook never fired.
 */
export const DEFAULT_BINDING_TTL_SECONDS = 24 * 60 * 60;

/**
 * Convenience wrapper around the KV binding that hides the key
 * naming. Used by both the agents endpoint (to write bindings) and
 * the outbound handler (to read them).
 */
export class OutboundCredentialKV {
  constructor(
    private readonly kv: OutboundCredentialKVStore,
    private readonly ttlSeconds = DEFAULT_BINDING_TTL_SECONDS,
  ) {}

  async bind(sessionId: string, vendor: OutboundVendor, apiKey: string): Promise<void> {
    if (!apiKey) {
      throw new Error('[agents/outbound] cannot bind empty apiKey');
    }
    await this.kv.put(credentialKvKey(sessionId, vendor), apiKey, {
      expirationTtl: this.ttlSeconds,
    });
  }

  async lookup(sessionId: string, vendor: OutboundVendor): Promise<string | null> {
    return this.kv.get(credentialKvKey(sessionId, vendor));
  }

  async unbind(sessionId: string, vendor: OutboundVendor): Promise<void> {
    await this.kv.delete(credentialKvKey(sessionId, vendor));
  }
}

/**
 * Env shape required by every outbound handler. Consumer Workers
 * extend this with their own `Env` declaration; we just need the KV
 * binding to exist under whichever name the consumer picks.
 */
export interface OutboundEnv {
  [kvBinding: string]: unknown;
}

/**
 * Per-vendor handler signature. Matches the `outboundByHost` value
 * shape from `@cloudflare/sandbox` (a function of `(request, env, ctx)`
 * — we ignore `ctx` because session identity comes from the
 * `X-Flowlib-Session-Id` header rather than `ctx.containerId`).
 */
export type OutboundHandler = (
  request: Request,
  env: OutboundEnv,
  ctx?: unknown,
) => Promise<Response>;

export interface BuildOutboundHandlersOptions {
  /**
   * Name of the KV namespace binding on the consumer's Worker `env`.
   * The handler reads `env[kvBinding]` at request time and treats it
   * as an `OutboundCredentialKVStore`.
   */
  kvBinding: string;
  /**
   * Override the TTL on credential bindings. Default 24h. Reads use
   * whatever TTL the binding was written with.
   */
  ttlSeconds?: number;
}

/**
 * Resolve the KV binding from `env` and read the API key for the
 * session id carried in the request. Returns `null` if the binding,
 * the header, or the key is missing — caller decides the response
 * shape.
 */
async function lookupApiKey(
  request: Request,
  env: OutboundEnv,
  vendor: OutboundVendor,
  kvBinding: string,
): Promise<{ apiKey: string; sessionId: string } | { error: string; status: number }> {
  const url = new URL(request.url);
  const sessionId = request.headers.get(FLOWLIB_SESSION_HEADER);
  // eslint-disable-next-line no-console
  console.log('[agents/outbound] intercepted', {
    vendor,
    host: url.host,
    path: url.pathname,
    method: request.method,
    hasSessionHeader: Boolean(sessionId),
  });
  if (!sessionId) {
    // eslint-disable-next-line no-console
    console.warn(
      '[agents/outbound] rejecting — request did not carry the session-id header. ' +
        'The opencode provider should boot with `Config.provider.<vendor>.options.headers` ' +
        'set; check that `outboundAuth` is configured on the workspace and that the ' +
        'opencode provider took the outbound branch.',
      { vendor, host: url.host },
    );
    return { error: `Missing ${FLOWLIB_SESSION_HEADER} header`, status: 401 };
  }
  const store = env[kvBinding] as OutboundCredentialKVStore | undefined;
  if (!store || typeof store.get !== 'function') {
    // eslint-disable-next-line no-console
    console.error(
      `[agents/outbound] KV binding "${kvBinding}" not present on env — ` +
        'check wrangler.toml has `[[kv_namespaces]] binding = "' +
        kvBinding +
        '"`.',
    );
    return { error: `KV binding "${kvBinding}" not configured`, status: 500 };
  }
  const apiKey = await store.get(credentialKvKey(sessionId, vendor));
  if (!apiKey) {
    // eslint-disable-next-line no-console
    console.warn('[agents/outbound] no credential bound for session+vendor', {
      vendor,
      sessionId,
      key: credentialKvKey(sessionId, vendor),
      hint:
        'The agents plugin `POST /sessions` should have written this key. Check ' +
        'that the credential row has a vendor `inferOpencodeProvider` recognises ' +
        '(name="anthropic" / "openrouter" / "openai" / "google" or metadata.provider).',
    });
    return {
      error: `No ${vendor} credential bound to session ${sessionId}`,
      status: 401,
    };
  }
  return { apiKey, sessionId };
}

/**
 * Strip the session-id header before forwarding upstream. The header
 * is internal to flowlib; LLM APIs shouldn't see it.
 */
function forwardWith(headers: Headers, request: Request): Request {
  headers.delete(FLOWLIB_SESSION_HEADER);
  return new Request(request, { headers });
}

// ─── Per-vendor handlers ───────────────────────────────────────────────

export function createAnthropicOutboundHandler(
  options: BuildOutboundHandlersOptions,
): OutboundHandler {
  return async (request, env) => {
    const r = await lookupApiKey(request, env, 'anthropic', options.kvBinding);
    if ('error' in r) {
      return new Response(r.error, { status: r.status });
    }
    const headers = new Headers(request.headers);
    // Anthropic only accepts `x-api-key` auth — drop any stray
    // `Authorization` header opencode may have set from the placeholder
    // config, then inject the real key.
    headers.delete('authorization');
    headers.set('x-api-key', r.apiKey);
    if (!headers.has('anthropic-version')) {
      headers.set('anthropic-version', '2023-06-01');
    }
    return fetch(forwardWith(headers, request));
  };
}

export function createOpenAIOutboundHandler(
  options: BuildOutboundHandlersOptions,
): OutboundHandler {
  return async (request, env) => {
    const r = await lookupApiKey(request, env, 'openai', options.kvBinding);
    if ('error' in r) {
      return new Response(r.error, { status: r.status });
    }
    const headers = new Headers(request.headers);
    // Replace any placeholder Authorization wholesale.
    headers.delete('authorization');
    headers.set('Authorization', `Bearer ${r.apiKey}`);
    return fetch(forwardWith(headers, request));
  };
}

export function createOpenRouterOutboundHandler(
  options: BuildOutboundHandlersOptions,
): OutboundHandler {
  return async (request, env) => {
    const r = await lookupApiKey(request, env, 'openrouter', options.kvBinding);
    if ('error' in r) {
      return new Response(r.error, { status: r.status });
    }
    const headers = new Headers(request.headers);
    headers.delete('authorization');
    headers.set('Authorization', `Bearer ${r.apiKey}`);
    return fetch(forwardWith(headers, request));
  };
}

export function createGoogleOutboundHandler(
  options: BuildOutboundHandlersOptions,
): OutboundHandler {
  return async (request, env) => {
    const r = await lookupApiKey(request, env, 'google', options.kvBinding);
    if ('error' in r) {
      return new Response(r.error, { status: r.status });
    }
    const headers = new Headers(request.headers);
    headers.delete('authorization');
    headers.set('x-goog-api-key', r.apiKey);
    return fetch(forwardWith(headers, request));
  };
}

export function createCloudflareAiGatewayOutboundHandler(
  options: BuildOutboundHandlersOptions,
): OutboundHandler {
  return async (request, env) => {
    const r = await lookupApiKey(request, env, 'cloudflare-ai-gateway', options.kvBinding);
    if ('error' in r) {
      return new Response(r.error, { status: r.status });
    }
    const headers = new Headers(request.headers);
    headers.delete('authorization');
    headers.set('Authorization', `Bearer ${r.apiKey}`);
    return fetch(forwardWith(headers, request));
  };
}

/**
 * Map of `host → OutboundHandler` ready to assign to
 * `Sandbox.outboundByHost`. Hosts cover the official endpoints for
 * each vendor we currently support; consumers can extend the returned
 * object to add their own (e.g. self-hosted OpenAI-compatible
 * endpoints) before assigning.
 */
export function buildFlowlibOutboundHandlers(
  options: BuildOutboundHandlersOptions,
): Record<string, OutboundHandler> {
  return {
    'api.anthropic.com': createAnthropicOutboundHandler(options),
    'api.openai.com': createOpenAIOutboundHandler(options),
    'openrouter.ai': createOpenRouterOutboundHandler(options),
    'generativelanguage.googleapis.com': createGoogleOutboundHandler(options),
    'gateway.ai.cloudflare.com': createCloudflareAiGatewayOutboundHandler(options),
  };
}
