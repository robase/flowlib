/**
 * AgentProviderPicker — used during agent creation to pick a provider.
 *
 * v1 ships with `claude-code` and `opencode`. The list lives here as a
 * hardcoded constant; Stream L's AgentForm could equally fetch
 * `/plugins/agents/providers` if we add that endpoint later.
 *
 * Stream L owns the agent-creation form; this component is exported so
 * either Stream L's form or the chat header (for "switch provider")
 * can reuse it.
 */
import * as React from 'react';
import type { AgentProviderId } from '../../shared/types';

export interface ProviderOption {
  id: AgentProviderId;
  label: string;
  description?: string;
}

export const DEFAULT_PROVIDERS: ProviderOption[] = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    description: 'Anthropic Claude with code-editing skills.',
  },
  {
    id: 'opencode',
    label: 'opencode',
    description: 'opencode terminal agent.',
  },
];

export interface AgentProviderPickerProps {
  value: AgentProviderId | null;
  onChange: (providerId: AgentProviderId) => void;
  providers?: ProviderOption[];
  disabled?: boolean;
}

export const AgentProviderPicker: React.FC<AgentProviderPickerProps> = ({
  value,
  onChange,
  providers,
  disabled,
}) => {
  const list = providers ?? DEFAULT_PROVIDERS;
  return (
    <div role="radiogroup" aria-label="Provider" className="flex flex-col gap-2">
      {list.map((p) => {
        const checked = value === p.id;
        return (
          <label
            key={p.id}
            className={`cursor-pointer rounded border px-3 py-2 text-sm flex flex-col gap-0.5 ${
              checked
                ? 'border-fl-primary bg-fl-primary/10'
                : 'border-fl-border bg-fl-card hover:bg-fl-muted'
            } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <span className="flex items-center gap-2">
              <input
                type="radio"
                name="agent-provider"
                value={p.id}
                checked={checked}
                disabled={disabled}
                className="accent-fl-primary"
                onChange={() => onChange(p.id)}
              />
              <span className="font-medium text-fl-foreground">{p.label}</span>
            </span>
            {p.description ? (
              <span className="text-xs text-fl-muted-foreground pl-6">
                {p.description}
              </span>
            ) : null}
          </label>
        );
      })}
    </div>
  );
};

AgentProviderPicker.displayName = 'AgentProviderPicker';
