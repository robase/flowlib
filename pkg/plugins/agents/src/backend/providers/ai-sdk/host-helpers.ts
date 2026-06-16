/**
 * Host-side helpers for wiring `aiSdkProvider` with the least boilerplate.
 *
 * The provider deliberately doesn't import any `@ai-sdk/*` package (they're
 * optional peers, and Cloudflare Workers can't dynamic-import at runtime —
 * the host owns the static binding). These helpers internalise the two
 * repetitive chunks a host would otherwise hand-write:
 *
 *   - `standardAiSdkVendors(...)` — the per-vendor model-factory map, with
 *     `baseURL` / `headers` passthrough so `openai` doubles as the
 *     OpenAI-compatible gateway (OpenRouter / Groq / Together / …).
 *   - `flowlibCredentialResolver(...)` — resolve the chat's selected
 *     credential (decrypted) to `{ vendor, apiKey, baseUrl }`, so each
 *     chat uses the user's own key (direct = no gateway markup).
 *
 * The host still installs the `@ai-sdk/*` packages it wants and passes the
 * `create*` functions + a Flowlib accessor — that's irreducible.
 */
import type {
  AiSdkCredential,
  AiSdkProviderOptions,
  AiSdkVendor,
  CredentialResolver,
} from './types';
import type { AgentCredentialsAccessor } from '../types';
import { inferOpencodeProvider } from '../../endpoints/credentials.endpoint';

export type { AgentCredentialsAccessor, ResolvedCredentialRow } from '../types';

/**
 * A vendor's model factory — the shape of `@ai-sdk/<vendor>`'s
 * `create<Vendor>({ apiKey, baseURL, headers })`, which returns a
 * `(modelId) => LanguageModel` provider.
 */
export type AiSdkProviderFactory = (settings: {
  apiKey: string;
  baseURL?: string;
  headers?: Record<string, string>;
}) => (modelId: string) => unknown;

/**
 * Build the `aiSdkProvider` `vendors` map from the `create*` functions the
 * host installed. Each factory gets the credential's `apiKey` plus, when
 * present, its `baseUrl` / `headers` — so a single `openai` factory also
 * serves any OpenAI-compatible endpoint (OpenRouter/Groq/Together/…).
 *
 * ```ts
 * import { createAnthropic } from '@ai-sdk/anthropic';
 * import { createOpenAI } from '@ai-sdk/openai';
 * import { createGoogleGenerativeAI } from '@ai-sdk/google';
 * vendors: standardAiSdkVendors({ createAnthropic, createOpenAI, createGoogleGenerativeAI }),
 * ```
 */
export function standardAiSdkVendors(creators: {
  createAnthropic?: AiSdkProviderFactory;
  createOpenAI?: AiSdkProviderFactory;
  createGoogleGenerativeAI?: AiSdkProviderFactory;
  /** Optional dedicated OpenRouter factory (`@openrouter/ai-sdk-provider`). */
  createOpenRouter?: AiSdkProviderFactory;
}): AiSdkProviderOptions['vendors'] {
  const wrap =
    (create: AiSdkProviderFactory) =>
    (credential: AiSdkCredential, modelId: string): unknown =>
      create({
        apiKey: credential.apiKey,
        ...(credential.baseUrl ? { baseURL: credential.baseUrl } : {}),
        ...(credential.headers ? { headers: credential.headers } : {}),
      })(modelId);

  const vendors: NonNullable<AiSdkProviderOptions['vendors']> = {};
  if (creators.createAnthropic) {
    vendors.anthropic = wrap(creators.createAnthropic);
  }
  if (creators.createOpenAI) {
    vendors.openai = wrap(creators.createOpenAI);
  }
  if (creators.createGoogleGenerativeAI) {
    vendors.google = wrap(creators.createGoogleGenerativeAI);
  }
  if (creators.createOpenRouter) {
    vendors.openrouter = wrap(creators.createOpenRouter);
  }
  return vendors;
}

/** Default `provider`-slug → OpenAI-compatible base URL map. */
export const DEFAULT_OPENAI_COMPATIBLE_BASE_URLS: Record<string, string> = {
  openrouter: 'https://openrouter.ai/api/v1',
  groq: 'https://api.groq.com/openai/v1',
  together: 'https://api.together.xyz/v1',
  fireworks: 'https://api.fireworks.ai/inference/v1',
  deepseek: 'https://api.deepseek.com',
  mistral: 'https://api.mistral.ai/v1',
};

/**
 * Map a credential's `provider` slug (from `inferOpencodeProvider`) to the
 * AI SDK vendor that serves it, plus an OpenAI-compatible `baseUrl` when
 * the provider is a gateway. `null` vendor = unknown slug (caller falls
 * back to the requested model vendor). Direct vendors (anthropic / openai
 * / google) talk to their own API; everything OpenAI-shaped maps to the
 * `openai` vendor + a base URL.
 */
export function vendorForProviderSlug(slug: string): {
  vendor: AiSdkVendor | null;
  baseUrl?: string;
} {
  switch (slug) {
    case 'anthropic':
      return { vendor: 'anthropic' };
    case 'openai':
      return { vendor: 'openai' };
    case 'google':
    case 'gemini':
      return { vendor: 'google' };
    case 'openrouter':
      // OpenRouter has a dedicated AI SDK provider
      // (`@openrouter/ai-sdk-provider`) with its base URL built in, and the
      // model normaliser rewrites gateway-credentialed chats to
      // `openrouter/<model>`. Map to the `openrouter` vendor so that spec
      // matches. Hosts wire `createOpenRouter` via `standardAiSdkVendors`.
      return { vendor: 'openrouter', baseUrl: DEFAULT_OPENAI_COMPATIBLE_BASE_URLS.openrouter };
    case 'groq':
    case 'together':
    case 'fireworks':
    case 'deepseek':
    case 'mistral':
      return { vendor: 'openai', baseUrl: DEFAULT_OPENAI_COMPATIBLE_BASE_URLS[slug] };
    case 'azure':
    case 'cloudflare-ai-gateway':
      // OpenAI-shaped, but the base URL is deployment-specific — read it
      // from the credential's `config.baseUrl`.
      return { vendor: 'openai' };
    default:
      return { vendor: null };
  }
}

/** A flowlib-instance-shaped accessor (`flowlib.credentials.*`). */
export interface CredentialsAccessor {
  credentials: AgentCredentialsAccessor;
}

/**
 * Core resolution: read `credentialId` from a credentials accessor
 * (decrypted) and turn it into an `AiSdkCredential` for the requested
 * model vendor. Returns `null` when there's no usable credential (caller
 * decides the fallback). Shared by `flowlibCredentialResolver` (host
 * convenience) and the `aiSdkProvider`'s built-in default resolver.
 *
 * The credential's **own** provider slug (explicit `provider` → metadata
 * → oauth2Provider → name heuristic) drives the vendor: a known slug wins
 * (so a mismatched model fails clearly via `resolveModel`), an unknown
 * (`custom`) slug defers to the requested vendor so generic keys work.
 */
export async function resolveCredentialFromAccessor(
  accessor: AgentCredentialsAccessor,
  input: { credentialId?: string; vendor: AiSdkVendor },
  options: { compatibleBaseUrls?: Record<string, string> } = {},
): Promise<AiSdkCredential | null> {
  if (!input.credentialId) {
    return null;
  }
  const baseUrls = { ...DEFAULT_OPENAI_COMPATIBLE_BASE_URLS, ...options.compatibleBaseUrls };
  const cred = await accessor.getDecryptedWithRefresh(input.credentialId);
  const cfg = (cred?.config ?? {}) as { apiKey?: string; baseUrl?: string; baseURL?: string };
  if (!cred || !cfg.apiKey) {
    return null;
  }
  const slug =
    cred.provider ??
    inferOpencodeProvider({
      name: cred.name ?? '',
      authType: cred.authType ?? '',
      config: cred.config ?? null,
      metadata: cred.metadata ?? null,
    });
  const mapped = vendorForProviderSlug(slug);
  const vendor = mapped.vendor ?? input.vendor;
  const baseUrl = cfg.baseUrl ?? cfg.baseURL ?? mapped.baseUrl ?? baseUrls[slug];
  return { vendor, apiKey: cfg.apiKey, ...(baseUrl ? { baseUrl } : {}) };
}

export interface FlowlibCredentialResolverOptions {
  /** Override / extend the provider-slug → base-URL map. */
  compatibleBaseUrls?: Record<string, string>;
  /**
   * Called when no usable credential is found via `credentialId` (e.g. no
   * credential attached, or it had no `apiKey`). Use it for a dev/env
   * fallback. If omitted, the resolver throws a clear error.
   */
  fallback?: CredentialResolver;
}

/**
 * A `resolveCredential` that reads the chat's **selected** Flowlib
 * credential (decrypted) and returns it for the requested model vendor —
 * so each chat uses the user's own key, hitting the provider directly
 * (no gateway markup).
 *
 * Most hosts don't need this: the `aiSdkProvider` already resolves the
 * attached credential internally (the agents plugin threads
 * `flowlib.credentials` in). Use this only to add a custom `fallback`
 * (e.g. a dev env-key path).
 *
 * `getFlowlib` is late-bound because the config is usually built before
 * the instance exists (see the Express adapter's
 * `createFlowlibRouter(config, { onInstance })`).
 */
export function flowlibCredentialResolver(
  getFlowlib: () => CredentialsAccessor | null | undefined,
  options: FlowlibCredentialResolverOptions = {},
): CredentialResolver {
  return async (input) => {
    const fl = getFlowlib();
    if (fl) {
      try {
        const resolved = await resolveCredentialFromAccessor(
          fl.credentials,
          input,
          options.compatibleBaseUrls ? { compatibleBaseUrls: options.compatibleBaseUrls } : {},
        );
        if (resolved) {
          return resolved;
        }
      } catch {
        // fall through to the host's fallback
      }
    }
    if (options.fallback) {
      return options.fallback(input);
    }
    throw new Error(
      `No usable credential for vendor "${input.vendor}" ` +
        `(credentialId=${input.credentialId ?? 'none'}). Attach an LLM credential to the chat.`,
    );
  };
}
