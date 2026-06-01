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

export const PROVIDER_CATALOGUE: ProviderEntry[] = [
  {
    id: 'opencode',
    label: 'opencode',
    models: [
      // IMPORTANT: model ids here go to opencode → OpenRouter (or whichever
      // upstream provider the credential resolves to). Opencode looks up the
      // model id in its provider catalogue; OpenRouter publishes Anthropic
      // models with a **dot** in the version (`claude-sonnet-4.5`), NOT a
      // hyphen. Sending the hyphenated form makes opencode silently accept
      // the prompt, return HTTP 200 with empty body, and never make the
      // upstream LLM call — the chat appears to hang forever.
      //
      // Mismatch was confirmed via the local CF Sandbox SDK opencode
      // example: `anthropic/claude-haiku-4.5` returned a real `PONG`,
      // `anthropic/claude-haiku-4-5` silently dropped the prompt.
      {
        id: 'anthropic/claude-sonnet-4.5',
        label: 'Claude Sonnet 4.5',
        description: 'Anthropic',
      },
      {
        id: 'anthropic/claude-opus-4.1',
        label: 'Claude Opus 4.1',
        description: 'Anthropic',
      },
      {
        id: 'anthropic/claude-haiku-4.5',
        label: 'Claude Haiku 4.5',
        description: 'Anthropic',
      },
      { id: 'openai/gpt-4o', label: 'GPT-4o', description: 'OpenAI' },
      { id: 'openai/gpt-4o-mini', label: 'GPT-4o mini', description: 'OpenAI' },
      { id: 'openai/o3-mini', label: 'o3 mini', description: 'OpenAI' },
      {
        id: 'google/gemini-2.0-flash-exp',
        label: 'Gemini 2.0 Flash',
        description: 'Google',
      },
    ],
  },
  {
    id: 'claude-code',
    label: 'Claude Code',
    models: [
      { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
      { id: 'claude-opus-4-1', label: 'Claude Opus 4.1' },
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
    ],
  },
  {
    id: 'raw-llm',
    label: 'Raw LLM',
    models: [
      { id: 'anthropic/claude-sonnet-4.5', label: 'Claude Sonnet 4.5' },
      { id: 'anthropic/claude-opus-4.1', label: 'Claude Opus 4.1' },
      { id: 'openai/gpt-4o', label: 'GPT-4o' },
      { id: 'openai/gpt-4o-mini', label: 'GPT-4o mini' },
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
