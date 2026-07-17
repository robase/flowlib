/**
 * Static fallback catalogues for the picker UIs. **Neither constant in
 * this file is the source of truth for available models** — both are
 * last-resort lists used when a live lookup is unavailable. See the
 * doc comment on each for which live path supersedes it.
 *
 * Model string format follows the backend default (`'<vendor>/<model>'`)
 * — see `pkg/plugins/agents/src/backend/plugin.ts` for `defaultModel`.
 */
import type { AgentProviderId } from '../../shared/types';

export interface ModelOption {
  /** Backend-facing model string. */
  id: string;
  /** Human label rendered in the dropdown. */
  label: string;
  /** Optional short description (vendor/family). */
  description?: string;
}

export interface ProviderEntry {
  id: AgentProviderId;
  label: string;
  models: ModelOption[];
}

/**
 * **Fallback only.** The picker is backend-driven — `useProviderCatalogue()`
 * fetches `GET /agents/providers`, which returns the deployment's actual
 * registered providers + the model specs each declares (e.g. hosted's
 * `openrouter/*` specs). This constant is used only when that endpoint is
 * unavailable, so it lists the single `ai-sdk` provider the in-process
 * (Express/Node) example registers, with **direct-vendor** specs
 * (`<vendor>/<model>`) matching that example's direct credentials.
 *
 * Do NOT add deployment-specific models here (opencode/claude-code/openrouter
 * variants used to live here and caused picker/credential mismatches) —
 * declare them on the provider via `aiSdkProvider({ models })` instead, so
 * they flow through the backend-driven path and match that deployment's
 * credentials.
 */
export const PROVIDER_CATALOGUE: ProviderEntry[] = [
  {
    id: 'ai-sdk',
    label: 'Chat',
    models: [
      { id: 'anthropic/claude-opus-4-8', label: 'Claude Opus 4.8', description: 'Anthropic' },
      { id: 'anthropic/claude-sonnet-5', label: 'Claude Sonnet 5', description: 'Anthropic' },
      { id: 'openai/gpt-5.2', label: 'GPT-5.2', description: 'OpenAI' },
      { id: 'openai/gpt-5-mini', label: 'GPT-5 mini', description: 'OpenAI' },
      {
        id: 'google/gemini-3.5-flash',
        label: 'Gemini 3.5 Flash',
        description: 'Google',
      },
    ],
  },
];

/**
 * **Emergency fallback only — not the source of truth.**
 *
 * The picker is driven by the *live* vendor catalogue: the backend proxies
 * each vendor's own `/models` API (`GET /agents/credentials/:id/models`,
 * see `backend/providers/vendor-models.ts`) using the selected credential,
 * server-side. That path is the one that stays current.
 *
 * This constant is only reached when the live fetch genuinely can't run —
 * no fetcher for the vendor, no `apiKey` on the credential, or the vendor
 * API errored. When that happens the picker renders a visible notice
 * saying so (see `ProviderModelSelector`), because a silent fallback is
 * exactly how this list went stale enough to advertise models that no
 * longer exist.
 *
 * Keyed by the **LLM credential provider slug** (`anthropic` | `openai` |
 * `google` | `openrouter` | …) — what `useLlmCredentials()` reports.
 *
 * Each `id` is the full backend model string (`'<vendor>/<model>'`) stored
 * on `sessions.model` and forwarded to the provider. The vendor prefix must
 * match a key the deployment's `ai-sdk` vendors map knows.
 *
 * Keep this list SHORT — two or three current models per vendor. It exists
 * to keep the picker usable during an outage, not to mirror the catalogue.
 * The combobox accepts free-text, so an unlisted model still works.
 */
export interface VendorEntry {
  /** Credential provider slug; also the menu group key. */
  slug: string;
  label: string;
  models: ModelOption[];
}

export const VENDOR_MODEL_CATALOGUE: Record<string, VendorEntry> = {
  anthropic: {
    slug: 'anthropic',
    label: 'Anthropic',
    // Aliases, not dated snapshots — an alias keeps pointing at the current
    // snapshot, so this list ages more slowly when the live fetch is down.
    models: [
      { id: 'anthropic/claude-opus-4-8', label: 'Claude Opus 4.8' },
      { id: 'anthropic/claude-sonnet-5', label: 'Claude Sonnet 5' },
      { id: 'anthropic/claude-haiku-4-5', label: 'Claude Haiku 4.5' },
    ],
  },
  openai: {
    slug: 'openai',
    label: 'OpenAI',
    models: [
      { id: 'openai/gpt-5.2', label: 'GPT-5.2' },
      { id: 'openai/gpt-5.1', label: 'GPT-5.1' },
      { id: 'openai/gpt-5-mini', label: 'GPT-5 mini' },
    ],
  },
  google: {
    slug: 'google',
    label: 'Google',
    models: [
      { id: 'google/gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro' },
      { id: 'google/gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
    ],
  },
  openrouter: {
    slug: 'openrouter',
    label: 'OpenRouter',
    // OpenRouter is wired as its own dedicated vendor (`createOpenRouter`),
    // so model ids are OpenRouter's native `<vendor>/<model>` form — NOT
    // `openai/`-prefixed. The backend normaliser adds the `openrouter/`
    // routing prefix.
    //
    // ‼️ OpenRouter names Anthropic models with DOTS (`claude-opus-4.8`),
    // unlike the `anthropic` vendor above, which uses Anthropic's own
    // hyphenated ids (`claude-opus-4-8`). The two are not interchangeable —
    // a hyphenated id 404s at OpenRouter.
    models: [
      { id: 'anthropic/claude-opus-4.8', label: 'Claude Opus 4.8' },
      { id: 'openai/gpt-5.2', label: 'GPT-5.2' },
      { id: 'google/gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
    ],
  },
};

/** Collapse vendor aliases onto a canonical provider slug. */
export function normalizeProviderSlug(slug: string | null | undefined): string {
  if (!slug) {
    return 'custom';
  }
  if (slug === 'gemini') {
    return 'google';
  }
  return slug;
}

/** Human label for a credential provider slug. */
export function providerLabel(slug: string | null | undefined): string {
  const key = normalizeProviderSlug(slug);
  const known = VENDOR_MODEL_CATALOGUE[key];
  if (known) {
    return known.label;
  }
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/** Curated model suggestions for a credential provider slug (may be empty). */
export function modelsForProvider(slug: string | null | undefined): ModelOption[] {
  return VENDOR_MODEL_CATALOGUE[normalizeProviderSlug(slug)]?.models ?? [];
}

export function findProvider(providerId: string | null | undefined): ProviderEntry | undefined {
  return PROVIDER_CATALOGUE.find((p) => p.id === providerId);
}

export function findModel(
  providerId: string | null | undefined,
  modelId: string | null | undefined,
): ModelOption | undefined {
  const p = findProvider(providerId);
  if (!p) {
    return undefined;
  }
  return p.models.find((m) => m.id === modelId);
}
