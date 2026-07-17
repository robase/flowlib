/**
 * `fetchVendorModels(vendor, creds)` — live model catalogue for an LLM
 * vendor, fetched from that vendor's own `/models` API.
 *
 * The model selection dropdown is otherwise driven by a hardcoded
 * frontend catalogue that goes stale. This pulls the *real* list using
 * the credential the user picked, server-side (the API key never reaches
 * the browser). Each vendor's response is normalised to the same
 * `{ id, label }` shape the picker expects, with ids in the **backend
 * model-string format** so they round-trip through `sessions.model` and
 * `normaliseModelForCredential` unchanged:
 *
 *   anthropic   → "anthropic/<id>"
 *   openai      → "openai/<id>"
 *   google      → "google/<id>"
 *   openrouter  → "<vendor>/<id>" (already namespaced by OpenRouter; the
 *                 backend adds the "openrouter/" routing prefix later)
 *
 * Vendors we don't have a fetcher for return `null` so the caller falls
 * back to the hardcoded catalogue.
 */

export interface VendorModel {
  id: string;
  label: string;
}

export interface VendorCredential {
  apiKey: string;
  /** Optional base URL override (OpenAI-compatible gateways). */
  baseUrl?: string;
}

/** TTL cache — vendor catalogues change rarely; avoid hammering on every open. */
const CACHE_TTL_MS = 10 * 60_000;
interface CacheEntry {
  expires: number;
  models: VendorModel[];
}
const cache = new Map<string, CacheEntry>();

function cacheKey(vendor: string, baseUrl: string | undefined): string {
  return `${vendor}|${baseUrl ?? ''}`;
}

/**
 * Fetch + normalise a vendor's model catalogue. Returns `null` for
 * unsupported vendors (caller falls back to the hardcoded list); throws
 * only on a network/HTTP failure so the endpoint can surface it.
 *
 * `now` is injected for testability (avoids `Date.now()` in tests).
 */
export async function fetchVendorModels(
  vendor: string,
  creds: VendorCredential,
  opts: { fetchImpl?: typeof fetch; now?: () => number } = {},
): Promise<VendorModel[] | null> {
  const fetchImpl = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => globalThis.fetch(...a));
  const now = opts.now ?? (() => Date.now());

  const key = cacheKey(vendor, creds.baseUrl);
  const hit = cache.get(key);
  if (hit && hit.expires > now()) {
    return hit.models;
  }

  const fetcher = FETCHERS[vendor];
  if (!fetcher) {
    return null;
  }

  const models = await fetcher(creds, fetchImpl);
  // Dedupe by id, keep first label, sort by id for a stable menu.
  const seen = new Set<string>();
  const deduped = models
    .filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)))
    .sort((a, b) => a.id.localeCompare(b.id));
  cache.set(key, { expires: now() + CACHE_TTL_MS, models: deduped });
  return deduped;
}

/** Clear the cache (tests / forced refresh). */
export function clearVendorModelCache(): void {
  cache.clear();
}

// ─── Per-vendor fetchers ─────────────────────────────────────────────

type Fetcher = (creds: VendorCredential, f: typeof fetch) => Promise<VendorModel[]>;

async function getJson(
  f: typeof fetch,
  url: string,
  headers: Record<string, string>,
): Promise<unknown> {
  const res = await f(url, { headers });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${url} → ${res.status} ${text.slice(0, 200)}`);
  }
  return res.json();
}

const FETCHERS: Record<string, Fetcher> = {
  // OpenRouter ids are already "<vendor>/<model>" (e.g. anthropic/claude-3.5-sonnet).
  openrouter: async (creds, f) => {
    const base = (creds.baseUrl ?? 'https://openrouter.ai/api/v1').replace(/\/$/, '');
    const body = (await getJson(f, `${base}/models`, {
      Authorization: `Bearer ${creds.apiKey}`,
    })) as { data?: Array<{ id?: string; name?: string }> };
    return (body.data ?? [])
      .filter((m): m is { id: string; name?: string } => typeof m.id === 'string')
      .map((m) => ({ id: m.id, label: m.name ?? m.id }));
  },

  anthropic: async (creds, f) => {
    const base = (creds.baseUrl ?? 'https://api.anthropic.com/v1').replace(/\/$/, '');
    const body = (await getJson(f, `${base}/models?limit=1000`, {
      'x-api-key': creds.apiKey,
      'anthropic-version': '2023-06-01',
    })) as { data?: Array<{ id?: string; display_name?: string }> };
    return (body.data ?? [])
      .filter((m): m is { id: string; display_name?: string } => typeof m.id === 'string')
      .map((m) => ({ id: `anthropic/${m.id}`, label: m.display_name ?? m.id }));
  },

  openai: async (creds, f) => {
    const base = (creds.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '');
    const body = (await getJson(f, `${base}/models`, {
      Authorization: `Bearer ${creds.apiKey}`,
    })) as { data?: Array<{ id?: string }> };
    return (
      (body.data ?? [])
        .map((m) => m.id)
        .filter((id): id is string => typeof id === 'string')
        // The bare OpenAI list includes embeddings/tts/whisper/etc. Keep the
        // chat-capable families so the picker isn't drowned in noise.
        .filter((id) => /^(gpt-|o\d|chatgpt)/i.test(id))
        .map((id) => ({ id: `openai/${id}`, label: id }))
    );
  },

  google: async (creds, f) => {
    const base = (creds.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta').replace(
      /\/$/,
      '',
    );
    const body = (await getJson(
      f,
      `${base}/models?pageSize=1000&key=${encodeURIComponent(creds.apiKey)}`,
      {},
    )) as {
      models?: Array<{
        name?: string;
        displayName?: string;
        supportedGenerationMethods?: string[];
      }>;
    };
    return (body.models ?? [])
      .filter((m) => m.supportedGenerationMethods?.includes('generateContent') ?? true)
      .map((m) => {
        const id = (m.name ?? '').replace(/^models\//, '');
        return { id: `google/${id}`, label: m.displayName ?? id };
      })
      .filter((m) => m.id !== 'google/');
  },
};

/** Vendors with a live fetcher — others fall back to the static catalogue. */
export const SUPPORTED_MODEL_VENDORS = Object.freeze(Object.keys(FETCHERS));
