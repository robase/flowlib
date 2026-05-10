/**
 * ModelPicker — per-session override of an agent's default model.
 *
 * v1 hardcodes a small list of well-known models per provider. The plan
 * is to swap this for a server-side enumeration via
 * `provider.listModels()` once Stream J ships the `/agents/models` (or
 * equivalent) endpoint. The hook signature accepts a `models` prop so
 * the consumer can inject a custom list in the meantime.
 *
 * TODO: server-side enumerate — replace the `DEFAULT_MODELS_BY_PROVIDER`
 * constant with a fetch from a Stream-J-owned endpoint.
 */
import * as React from 'react';
import type { AgentProviderId } from '../../shared/types';

export interface ModelOption {
  id: string;
  label: string;
  /** Optional provider id this model belongs to — used for filtering. */
  providerId?: AgentProviderId;
}

export interface ModelPickerProps {
  /** Currently selected model id. */
  value: string | null;
  onChange: (modelId: string) => void;
  /** Optional override list. Falls back to the provider defaults. */
  models?: ModelOption[];
  /** When set, defaults are filtered to this provider. */
  providerId?: AgentProviderId;
  /** Disabled while a turn is in flight. */
  disabled?: boolean;
}

export const DEFAULT_MODELS_BY_PROVIDER: Record<string, ModelOption[]> = {
  'claude-code': [
    {
      id: 'claude-sonnet-4-5',
      label: 'Claude Sonnet 4.5',
      providerId: 'claude-code',
    },
    {
      id: 'claude-opus-4-1',
      label: 'Claude Opus 4.1',
      providerId: 'claude-code',
    },
  ],
  opencode: [
    { id: 'gpt-5', label: 'GPT-5', providerId: 'opencode' },
    { id: 'gpt-4.1', label: 'GPT-4.1', providerId: 'opencode' },
  ],
  'raw-llm': [
    { id: 'gpt-4o-mini', label: 'GPT-4o mini', providerId: 'raw-llm' },
    { id: 'gpt-4o', label: 'GPT-4o', providerId: 'raw-llm' },
    { id: 'claude-3-5-sonnet', label: 'Claude 3.5 Sonnet', providerId: 'raw-llm' },
  ],
};

function defaultsFor(provider: AgentProviderId | undefined): ModelOption[] {
  if (provider && DEFAULT_MODELS_BY_PROVIDER[provider]) {
    return DEFAULT_MODELS_BY_PROVIDER[provider];
  }
  return Object.values(DEFAULT_MODELS_BY_PROVIDER).flat();
}

export const ModelPicker: React.FC<ModelPickerProps> = ({
  value,
  onChange,
  models,
  providerId,
  disabled = false,
}) => {
  const options = models && models.length > 0 ? models : defaultsFor(providerId);
  return (
    <select
      aria-label="Model"
      className="text-xs bg-fl-background text-fl-foreground border border-fl-border rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-fl-ring disabled:opacity-50"
      value={value ?? ''}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      data-testid="model-picker"
    >
      <option value="" disabled>
        Choose model…
      </option>
      {options.map((opt) => (
        <option key={opt.id} value={opt.id}>
          {opt.label}
        </option>
      ))}
    </select>
  );
};

ModelPicker.displayName = 'ModelPicker';
