/**
 * Static catalogue of known providers and the model strings each
 * accepts. The agents plugin doesn't currently expose a backend
 * endpoint listing providers + models, so we maintain the list here
 * for the picker UIs (ChatHeader, NewChatDialog).
 *
 * Adding a new model: append to the relevant provider's `models`
 * array. The `id` is the exact string the backend stores in
 * `sessions.model` and the provider forwards to the LLM.
 *
 * Model string format follows the backend default
 * (`'<vendor>/<model>'`) — see `pkg/plugins/agents/src/backend/plugin.ts`
 * for `defaultModel`.
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
      { id: 'anthropic/claude-sonnet-4-5', label: 'Claude Sonnet 4.5', description: 'Anthropic' },
      { id: 'anthropic/claude-opus-4-1', label: 'Claude Opus 4.1', description: 'Anthropic' },
      { id: 'openai/gpt-4o', label: 'GPT-4o', description: 'OpenAI' },
      { id: 'openai/gpt-4o-mini', label: 'GPT-4o mini', description: 'OpenAI' },
      {
        id: 'google/gemini-2.0-flash-exp',
        label: 'Gemini 2.0 Flash',
        description: 'Google',
      },
    ],
  },
];

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
