/**
 * `GET /plugins/agents/credentials/llm` — list LLM credentials the
 * caller can use to start a new agent session. Backed by Flowlib's
 * `flowlib.credentials.list({ type: 'llm' })`; we never return the
 * decrypted secret material — just the metadata the picker UI needs.
 *
 * Why a dedicated endpoint and not the generic `/credentials` API?
 *
 *  1. Filters to LLM-type creds only — the agents picker shouldn't
 *     show database / generic-API creds even if the user has them.
 *  2. Surfaces a derived `opencodeProvider` slug (anthropic, openai,
 *     openrouter, …) inferred from the credential's metadata or
 *     auth type, so the frontend can group / label entries without
 *     re-implementing the heuristic.
 *  3. Insulates the agents UI from `flowlib.credentials` shape
 *     changes — the agents picker only depends on this small DTO.
 */

import type { FlowlibPluginEndpoint, PluginEndpointResponse } from '@flowlib/core';
import type { PluginContext } from '../plugin-context';
import { safeHandler, notFound, type EndpointDeps } from './helpers';
import { fetchVendorModels } from '../providers/vendor-models';

/**
 * Trimmed-down credential entry returned to the agents picker UI.
 * Contains everything the user needs to identify the credential plus a
 * provider slug so the frontend can filter by what the agent provider
 * supports.
 */
export interface AgentCredentialOption {
  id: string;
  name: string;
  description: string | null;
  /** Inferred OpenCode provider slug ('anthropic' | 'openai' | …) — never null. */
  provider: string;
  authType: string;
  isActive: boolean;
  isShared: boolean;
  expiresAt: string | null;
}

/**
 * Map a credential to its OpenCode provider slug. Falls through several
 * heuristics so users don't have to backfill metadata on existing
 * credentials. Returns `'custom'` when nothing matches — the picker
 * still shows the entry but groups it under "Other".
 */
export function inferOpencodeProvider(cred: {
  name: string;
  authType: string;
  config?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}): string {
  // 1) explicit metadata override wins.
  const meta = cred.metadata ?? {};
  const explicit = meta.opencodeProvider ?? meta.provider;
  if (typeof explicit === 'string' && explicit.length > 0) {
    return explicit;
  }
  // 2) OAuth2 provider id maps directly when it's an LLM provider we know.
  const oauthProvider = cred.config?.oauth2Provider;
  if (typeof oauthProvider === 'string' && KNOWN_PROVIDERS.has(oauthProvider)) {
    return oauthProvider;
  }
  // 3) Name-based heuristic — covers the common case where users name
  //    their key after the vendor ("My Anthropic Key", "openai-prod").
  const lc = cred.name.toLowerCase();
  for (const provider of KNOWN_PROVIDERS) {
    if (lc.includes(provider)) {
      return provider;
    }
  }
  return 'custom';
}

const KNOWN_PROVIDERS = new Set([
  'anthropic',
  'openai',
  'openrouter',
  'google',
  'gemini',
  'azure',
  'bedrock',
  'cohere',
  'mistral',
  'groq',
  'cloudflare-ai-gateway',
]);

async function listLlmCredentials(deps: EndpointDeps): Promise<PluginEndpointResponse> {
  const flowlib = deps.pluginCtx.flowlib.getFlowlib();
  // `list` returns sanitised rows (no decrypted config material).
  const rows = await flowlib.credentials.list({ type: 'llm' });
  const data: AgentCredentialOption[] = rows.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description ?? null,
    provider: inferOpencodeProvider({
      name: c.name,
      authType: c.authType,
      config: (c as { config?: Record<string, unknown> | null }).config ?? null,
      metadata: c.metadata ?? null,
    }),
    authType: c.authType,
    isActive: c.isActive,
    isShared: c.isShared,
    expiresAt: c.expiresAt ?? null,
  }));
  return { body: { data } };
}

/** Collapse vendor aliases onto a slug `fetchVendorModels` understands. */
function canonicalVendor(slug: string): string {
  return slug === 'gemini' ? 'google' : slug;
}

/**
 * `GET /agents/credentials/:credentialId/models` — the live model
 * catalogue for a credential's vendor, fetched from the vendor's own API
 * (server-side, so the key never reaches the browser).
 *
 * Returns `{ data, source }` where `source` is:
 *   - `live`     — fetched from the vendor's `/models` API
 *   - `fallback` — no fetcher for this vendor; use the static catalogue
 *   - `error`    — the vendor call failed; use the static catalogue
 *
 * Always 200 (with possibly-empty `data`) so a vendor hiccup degrades to
 * the hardcoded list rather than breaking the picker.
 */
async function listCredentialModels(deps: EndpointDeps): Promise<PluginEndpointResponse> {
  const credentialId = deps.endpointCtx.params.credentialId;
  if (!credentialId) {
    return notFound('credentialId is required');
  }

  const flowlib = deps.pluginCtx.flowlib.getFlowlib();
  let cred: {
    name?: string;
    authType?: string;
    config?: Record<string, unknown> | null;
    metadata?: Record<string, unknown> | null;
  };
  try {
    cred = await flowlib.credentials.getDecryptedWithRefresh(credentialId);
  } catch (err) {
    return notFound(
      `Credential not found or not accessible: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const vendor = canonicalVendor(
    inferOpencodeProvider({
      name: cred.name ?? '',
      authType: cred.authType ?? '',
      config: cred.config ?? null,
      metadata: cred.metadata ?? null,
    }),
  );

  const apiKey = typeof cred.config?.apiKey === 'string' ? cred.config.apiKey : '';
  const baseUrl = typeof cred.config?.baseUrl === 'string' ? cred.config.baseUrl : undefined;
  if (!apiKey) {
    return { status: 200, body: { data: [], source: 'fallback', vendor } };
  }

  try {
    const models = await fetchVendorModels(vendor, { apiKey, ...(baseUrl ? { baseUrl } : {}) });
    if (models === null) {
      return { status: 200, body: { data: [], source: 'fallback', vendor } };
    }
    return { status: 200, body: { data: models, source: 'live', vendor } };
  } catch (err) {
    deps.pluginCtx.logger.warn('[agents] vendor model fetch failed', {
      credentialId,
      vendor,
      message: err instanceof Error ? err.message : String(err),
    });
    return {
      status: 200,
      body: {
        data: [],
        source: 'error',
        vendor,
        error: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

export function createCredentialsEndpoints(ctx: PluginContext): FlowlibPluginEndpoint[] {
  return [
    {
      method: 'GET',
      path: '/agents/credentials/llm',
      handler: safeHandler(ctx, listLlmCredentials),
    },
    {
      method: 'GET',
      path: '/agents/credentials/:credentialId/models',
      handler: safeHandler(ctx, listCredentialModels),
    },
  ];
}
