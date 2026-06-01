/**
 * `buildOpencodeLlmProviderLoader` — host-side helper that wires
 * `openCodeProvider({ loadProviderConfig })` to Flowlib's credential
 * service.
 *
 * On first prompt for an opencode session, the provider calls this
 * loader. The loader queries every `type: 'llm'` credential the org
 * has, decrypts each via `flowlib.credentials.getDecryptedWithRefresh`,
 * and translates them into an OpenCode `Config.provider` map keyed by
 * vendor slug (`anthropic`, `openai`, …).
 *
 * Per the v1 design: OpenCode boots once per workspace with the union
 * of all the org's keys; per-session routing then happens via the
 * model id (e.g. `anthropic/claude-sonnet-4-5` → opencode's `anthropic`
 * provider config slot). The session's `credentialId` is stored on
 * the row for audit / billing — it doesn't gate which keys OpenCode
 * sees.
 *
 * The host wires the loader by passing a thunk that returns the
 * `FlowlibInstance` — we resolve lazily because providers are built
 * **before** `createFlowlib()` returns (providers are part of the
 * config that goes into `createFlowlib`). The thunk is only invoked
 * the first time the loader runs, by which time the instance exists.
 */

import type { AgentsAuthContext } from '../../../shared/auth-context';
import { inferOpencodeProvider } from '../../endpoints/credentials.endpoint';

/**
 * Minimal slice of `FlowlibInstance` we depend on. Typed structurally
 * so the helper doesn't pull `@flowlib/core` runtime types into
 * provider construction (which happens at module load).
 */
export interface FlowlibCredentialsSlice {
  credentials: {
    list(filters?: { type?: string }): Promise<
      Array<{
        id: string;
        name: string;
        authType: string;
        isActive: boolean;
        metadata?: Record<string, unknown> | null;
        config?: Record<string, unknown> | null;
      }>
    >;
    getDecryptedWithRefresh(id: string): Promise<{
      id: string;
      name: string;
      authType: string;
      config: Record<string, unknown>;
      metadata?: Record<string, unknown> | null;
    }>;
  };
}

export interface BuildOpencodeLlmProviderLoaderOptions {
  /**
   * Thunk that returns the live `FlowlibInstance` (or any object
   * exposing the credentials slice). Resolved lazily on first
   * invocation so callers can wire the loader before
   * `createFlowlib()` has finished.
   */
  getFlowlib: () => FlowlibCredentialsSlice | Promise<FlowlibCredentialsSlice>;
  /**
   * Optional logger — receives a single `warn` call per credential
   * that fails to decrypt or maps to an unknown vendor. Lets the
   * host surface "this credential is unusable" without aborting
   * the whole session boot.
   */
  logger?: { warn?: (message: string, meta?: Record<string, unknown>) => void };
}

/**
 * Map from `inferOpencodeProvider`'s slug → the OpenCode provider key
 * we should populate. Most slugs are 1:1; the table exists so we can
 * coalesce aliases (e.g. `gemini` → `google`).
 */
const PROVIDER_SLUG_MAP: Record<string, string> = {
  anthropic: 'anthropic',
  openai: 'openai',
  openrouter: 'openrouter',
  google: 'google',
  gemini: 'google',
  azure: 'azure',
  bedrock: 'amazon-bedrock',
  cohere: 'cohere',
  mistral: 'mistral',
  groq: 'groq',
  'cloudflare-ai-gateway': 'cloudflare-ai-gateway',
};

/**
 * Build the OpenCode `Config.provider` map for one credential.
 *
 * Most LLM providers want `{ options: { apiKey } }`. Cloudflare AI
 * Gateway is the odd one out — its slot accepts `{ accountId,
 * gatewayId, apiToken }`. We read those keys from `cred.config` if
 * present (the AI Gateway credential type stores them there).
 */
function credentialToProviderEntry(cred: {
  authType: string;
  config: Record<string, unknown>;
  metadata?: Record<string, unknown> | null;
  vendor: string;
}): Record<string, unknown> | undefined {
  const apiKey = cred.config.apiKey;
  if (cred.vendor === 'cloudflare-ai-gateway') {
    const accountId = cred.config.accountId ?? cred.metadata?.accountId;
    const gatewayId = cred.config.gatewayId ?? cred.metadata?.gatewayId;
    const apiToken = cred.config.apiToken ?? apiKey;
    if (!accountId || !gatewayId || !apiToken) {
      return undefined;
    }
    return { options: { accountId, gatewayId, apiToken } };
  }
  if (typeof apiKey !== 'string' || apiKey.length === 0) {
    return undefined;
  }
  return { options: { apiKey } };
}

/**
 * Build the OpenCode `Config.provider` map from every active
 * `type: 'llm'` credential in the caller's org.
 *
 * Returns `undefined` when the org has no usable LLM credentials —
 * the opencode provider treats `undefined` the same as "no override",
 * meaning the in-container OpenCode boots without provider keys and
 * the user gets a clear error on first prompt.
 */
export function buildOpencodeLlmProviderLoader(
  options: BuildOpencodeLlmProviderLoaderOptions,
): (input: {
  auth: AgentsAuthContext;
  credentialId?: string;
}) => Promise<Record<string, unknown> | undefined> {
  let cachedFlowlib: FlowlibCredentialsSlice | undefined;

  return async function loadProviderConfig(_input) {
    if (!cachedFlowlib) {
      cachedFlowlib = await options.getFlowlib();
    }
    const flowlib = cachedFlowlib;
    const rows = await flowlib.credentials.list({ type: 'llm' });
    const provider: Record<string, unknown> = {};

    for (const row of rows) {
      if (!row.isActive) {
        continue;
      }
      const slug = inferOpencodeProvider({
        name: row.name,
        authType: row.authType,
        config: row.config ?? null,
        metadata: row.metadata ?? null,
      });
      const vendor = PROVIDER_SLUG_MAP[slug];
      if (!vendor) {
        options.logger?.warn?.(
          '[agents/opencode] credential mapped to unknown vendor slug; skipping',
          { credentialId: row.id, slug },
        );
        continue;
      }
      // Decrypt to get the secret material.
      let decrypted;
      try {
        decrypted = await flowlib.credentials.getDecryptedWithRefresh(row.id);
      } catch (err) {
        options.logger?.warn?.('[agents/opencode] credential decrypt failed; skipping', {
          credentialId: row.id,
          error: err instanceof Error ? err.message : String(err),
        });
        continue;
      }
      const entry = credentialToProviderEntry({
        authType: decrypted.authType,
        config: decrypted.config,
        metadata: decrypted.metadata ?? null,
        vendor,
      });
      if (!entry) {
        options.logger?.warn?.(
          '[agents/opencode] credential has no usable secret for vendor; skipping',
          { credentialId: row.id, vendor },
        );
        continue;
      }
      // First credential per vendor wins. If the org has multiple
      // anthropic keys, OpenCode only sees one — picking by stable
      // creation order is fine for v1; a future enhancement can
      // surface a UI for the user to pick the active one.
      if (!provider[vendor]) {
        provider[vendor] = entry;
      }
    }

    const vendors = Object.keys(provider);
    if (vendors.length === 0) {
      options.logger?.warn?.(
        "[agents/opencode] loadProviderConfig produced no provider entries — opencode will boot with no API keys and the first LLM call will fail. Check that the org has at least one active `type: 'llm'` credential and that `inferOpencodeProvider` recognises its vendor.",
        { totalRows: rows.length },
      );
    } else {
      options.logger?.warn?.('[agents/opencode] loadProviderConfig resolved vendors', {
        vendors,
        totalRows: rows.length,
      });
    }
    return vendors.length > 0 ? provider : undefined;
  };
}
