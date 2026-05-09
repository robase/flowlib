/**
 * AgentFormPage — `/agents/new` (and edit, in the future).
 *
 * Multi-step create form covering provider, model, persona, workspace,
 * and MCP servers. The draft is persisted in the Zustand UI store so
 * the user can navigate between steps without losing input.
 *
 * Submits via `useCreateAgent` (React Query → POST /plugins/agents/agents).
 */

import * as React from 'react';
import { Link, useNavigate } from 'react-router';
import type { AgentProviderId } from '../../shared/types';
import type { CreateAgentInput } from '../api/agents.api';
import { useCreateAgent } from '../hooks/useAgents';
import { useWorkspaces } from '../hooks/useWorkspaces';
import { useAgentsUiStore } from '../store/agents.store';

export interface AgentFormPageProps {
  basePath: string;
}

const STEPS = ['Provider', 'Model', 'Persona', 'Workspace', 'MCPs'] as const;

interface ProviderOption {
  id: AgentProviderId;
  label: string;
  description: string;
  defaultModel: string;
}

const PROVIDERS: readonly ProviderOption[] = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    description: 'Anthropic Claude with code-aware tools.',
    defaultModel: 'claude-sonnet-4-0',
  },
  {
    id: 'opencode',
    label: 'opencode',
    description: 'Open-source code agent runtime.',
    defaultModel: 'gpt-4o',
  },
  {
    id: 'raw-llm',
    label: 'Raw LLM',
    description: 'Direct chat completion (no code tools).',
    defaultModel: 'gpt-4o-mini',
  },
];

export function AgentFormPage({ basePath }: AgentFormPageProps): React.ReactElement {
  const navigate = useNavigate();
  // Step is local React state — zustand v5's `useSyncExternalStore`
  // SSR snapshot returns the *initial* store state on first render
  // (`getServerSnapshot = () => selector(getInitialState())`), which
  // breaks snapshot tests. Local `useState` reads the current store
  // state once at mount and stays in sync via the setter callback.
  const [formStep, setFormStep] = React.useState(() => useAgentsUiStore.getState().formStep);
  const draft = useAgentsUiStore((s) => s.formDraft);
  const updateDraft = useAgentsUiStore((s) => s.updateFormDraft);
  const resetDraft = useAgentsUiStore((s) => s.resetFormDraft);

  // Mirror local step into the store so navigations away from the form
  // can pick up where the user left off.
  React.useEffect(() => {
    useAgentsUiStore.getState().setFormStep(formStep);
  }, [formStep]);

  const create = useCreateAgent();
  const { data: workspaces } = useWorkspaces();

  const [submitError, setSubmitError] = React.useState<string | null>(null);

  const canAdvance = React.useMemo(() => {
    switch (formStep) {
      case 0:
        return Boolean(draft.providerId);
      case 1:
        return Boolean(draft.defaultModel);
      case 2:
        return draft.name.trim().length > 0;
      case 3:
      case 4:
        return true;
      default:
        return false;
    }
  }, [formStep, draft]);

  const isLast = formStep === STEPS.length - 1;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitError(null);

    let mcpServers: Record<string, unknown> = {};
    if (draft.mcpServersText.trim()) {
      try {
        const parsed = JSON.parse(draft.mcpServersText);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          mcpServers = parsed as Record<string, unknown>;
        } else {
          throw new Error('MCP servers must be a JSON object.');
        }
      } catch (err) {
        setSubmitError(
          err instanceof Error ? `Invalid MCP servers JSON: ${err.message}` : 'Invalid MCP servers JSON',
        );
        return;
      }
    }

    if (!draft.providerId) {
      setSubmitError('Pick a provider before saving.');
      return;
    }

    const input: CreateAgentInput = {
      name: draft.name.trim() || 'Untitled agent',
      description: draft.description.trim() || null,
      providerId: draft.providerId,
      defaultModel: draft.defaultModel || null,
      personaText: draft.personaText.trim() || null,
      workspaceId: draft.workspaceId,
      mcpServers,
      visibility: 'private',
    };

    try {
      const created = await create.mutateAsync(input);
      resetDraft();
      navigate(
        `${stripTrailingSlash(basePath)}/agents/${encodeURIComponent(created.id)}`,
      );
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to create agent.');
    }
  };

  return (
    <div
      className="fl-page w-full h-full min-h-0 overflow-y-auto bg-fl-background text-fl-foreground"
      data-testid="agent-form-page"
    >
      <header className="border-b border-fl-border px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">New agent</h1>
          <p className="text-sm text-fl-muted-foreground mt-1">
            Step {formStep + 1} of {STEPS.length} · {STEPS[formStep]}
          </p>
        </div>
        <Link
          to={`${stripTrailingSlash(basePath)}/agents`}
          className="text-sm text-fl-muted-foreground hover:text-fl-foreground"
          data-testid="agent-form-cancel"
        >
          Cancel
        </Link>
      </header>

      <ol
        className="flex gap-2 px-6 py-3 border-b border-fl-border"
        aria-label="Form progress"
        data-testid="agent-form-stepper"
      >
        {STEPS.map((label, idx) => (
          <li key={label} className="flex items-center gap-2 text-xs">
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full ${
                idx === formStep
                  ? 'bg-fl-primary text-fl-primary-foreground'
                  : idx < formStep
                    ? 'bg-fl-muted text-fl-foreground'
                    : 'bg-fl-muted text-fl-muted-foreground'
              }`}
              aria-current={idx === formStep ? 'step' : undefined}
            >
              {idx + 1}
            </span>
            <span
              className={
                idx === formStep
                  ? 'text-fl-foreground font-medium'
                  : 'text-fl-muted-foreground'
              }
            >
              {label}
            </span>
            {idx < STEPS.length - 1 && (
              <span className="text-fl-muted-foreground" aria-hidden="true">
                ›
              </span>
            )}
          </li>
        ))}
      </ol>

      <form onSubmit={handleSubmit} className="px-6 py-6 max-w-2xl">
        {formStep === 0 && (
          <fieldset data-testid="agent-form-step-provider">
            <legend className="text-base font-semibold mb-3">Pick a provider</legend>
            <div className="space-y-2">
              {PROVIDERS.map((p) => (
                <label
                  key={p.id}
                  className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 ${
                    draft.providerId === p.id
                      ? 'border-fl-primary bg-fl-primary/10'
                      : 'border-fl-border bg-fl-card'
                  }`}
                >
                  <input
                    type="radio"
                    name="providerId"
                    value={p.id}
                    checked={draft.providerId === p.id}
                    onChange={() =>
                      updateDraft({
                        providerId: p.id,
                        defaultModel: draft.defaultModel || p.defaultModel,
                      })
                    }
                    className="mt-1"
                  />
                  <div>
                    <div className="font-medium text-fl-foreground">{p.label}</div>
                    <div className="text-sm text-fl-muted-foreground">{p.description}</div>
                  </div>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {formStep === 1 && (
          <fieldset data-testid="agent-form-step-model">
            <legend className="text-base font-semibold mb-3">Default model</legend>
            <label className="block">
              <span className="text-sm text-fl-foreground">Model id</span>
              <input
                type="text"
                value={draft.defaultModel}
                onChange={(e) => updateDraft({ defaultModel: e.target.value })}
                placeholder="claude-sonnet-4-0"
                className="mt-1 w-full rounded-md border border-fl-border bg-fl-card px-3 py-2 text-sm text-fl-foreground"
                data-testid="agent-form-model-input"
              />
              <span className="text-xs text-fl-muted-foreground mt-1 block">
                Per-session overrides are configurable later from the chat header.
              </span>
            </label>
          </fieldset>
        )}

        {formStep === 2 && (
          <fieldset data-testid="agent-form-step-persona">
            <legend className="text-base font-semibold mb-3">Identity & persona</legend>
            <label className="block mb-3">
              <span className="text-sm text-fl-foreground">Name</span>
              <input
                type="text"
                value={draft.name}
                onChange={(e) => updateDraft({ name: e.target.value })}
                placeholder="My code reviewer"
                required
                className="mt-1 w-full rounded-md border border-fl-border bg-fl-card px-3 py-2 text-sm text-fl-foreground"
                data-testid="agent-form-name-input"
              />
            </label>
            <label className="block mb-3">
              <span className="text-sm text-fl-foreground">Description</span>
              <input
                type="text"
                value={draft.description}
                onChange={(e) => updateDraft({ description: e.target.value })}
                placeholder="Optional one-liner shown on the card."
                className="mt-1 w-full rounded-md border border-fl-border bg-fl-card px-3 py-2 text-sm text-fl-foreground"
                data-testid="agent-form-description-input"
              />
            </label>
            <label className="block">
              <span className="text-sm text-fl-foreground">Persona prompt</span>
              <textarea
                value={draft.personaText}
                onChange={(e) => updateDraft({ personaText: e.target.value })}
                rows={6}
                placeholder="You are a meticulous code reviewer focused on…"
                className="mt-1 w-full rounded-md border border-fl-border bg-fl-card px-3 py-2 text-sm text-fl-foreground font-mono"
                data-testid="agent-form-persona-input"
              />
            </label>
          </fieldset>
        )}

        {formStep === 3 && (
          <fieldset data-testid="agent-form-step-workspace">
            <legend className="text-base font-semibold mb-3">Workspace</legend>
            <p className="text-sm text-fl-muted-foreground mb-3">
              Optional. Bind this agent to a workspace so it can edit files. You can change
              this later.
            </p>
            <label className="block">
              <span className="text-sm text-fl-foreground">Workspace</span>
              <select
                value={draft.workspaceId ?? ''}
                onChange={(e) =>
                  updateDraft({ workspaceId: e.target.value === '' ? null : e.target.value })
                }
                className="mt-1 w-full rounded-md border border-fl-border bg-fl-card px-3 py-2 text-sm text-fl-foreground"
                data-testid="agent-form-workspace-select"
              >
                <option value="">No workspace</option>
                {workspaces?.map((ws) => (
                  <option key={ws.id} value={ws.id}>
                    {ws.name} ({ws.workspaceProviderId})
                  </option>
                ))}
              </select>
            </label>
          </fieldset>
        )}

        {formStep === 4 && (
          <fieldset data-testid="agent-form-step-mcps">
            <legend className="text-base font-semibold mb-3">MCP servers</legend>
            <p className="text-sm text-fl-muted-foreground mb-3">
              Optional. Paste an MCP servers JSON object — keys are server ids, values are
              the standard MCP launch config. Leave empty to start with no MCP servers.
            </p>
            <label className="block">
              <span className="text-sm text-fl-foreground">MCP servers (JSON)</span>
              <textarea
                value={draft.mcpServersText}
                onChange={(e) => updateDraft({ mcpServersText: e.target.value })}
                rows={8}
                placeholder='{\n  "github": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"] }\n}'
                className="mt-1 w-full rounded-md border border-fl-border bg-fl-card px-3 py-2 text-sm text-fl-foreground font-mono"
                data-testid="agent-form-mcps-input"
              />
            </label>
          </fieldset>
        )}

        {submitError && (
          <p
            className="mt-4 text-sm text-fl-destructive"
            role="alert"
            data-testid="agent-form-submit-error"
          >
            {submitError}
          </p>
        )}

        <div className="mt-6 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setFormStep(Math.max(0, formStep - 1))}
            disabled={formStep === 0}
            className="rounded-md border border-fl-border px-4 py-2 text-sm font-medium text-fl-foreground disabled:opacity-50"
            data-testid="agent-form-back"
          >
            Back
          </button>
          {!isLast ? (
            <button
              type="button"
              onClick={() => canAdvance && setFormStep(formStep + 1)}
              disabled={!canAdvance}
              className="rounded-md bg-fl-primary px-4 py-2 text-sm font-medium text-fl-primary-foreground disabled:opacity-50"
              data-testid="agent-form-next"
            >
              Next
            </button>
          ) : (
            <button
              type="submit"
              disabled={create.isPending || !draft.providerId || !draft.name.trim()}
              className="rounded-md bg-fl-primary px-4 py-2 text-sm font-medium text-fl-primary-foreground disabled:opacity-50"
              data-testid="agent-form-submit"
            >
              {create.isPending ? 'Creating…' : 'Create agent'}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

function stripTrailingSlash(p: string): string {
  return !p || p === '/' ? '' : p.replace(/\/$/, '');
}

export default AgentFormPage;
