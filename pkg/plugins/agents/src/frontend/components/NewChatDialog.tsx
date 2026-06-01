/**
 * `NewChatDialog` — small modal that gathers the credential (and
 * implicitly the provider) for a new chat session.
 *
 * UX: opens when the user clicks "+ New chat". Lists every active LLM
 * credential the org has. Selecting one + clicking "Start chat"
 * triggers `POST /sessions { credentialId }`. The user can also pick
 * "no credential" — useful for sessions backed by a factory-default
 * credential or by outbound-Workers auth (Phase 2) where the
 * credential is bound by the host, not by the chat row.
 *
 * **CSS**: only `fl-*` theme tokens — `@flowlib/ui/styles` ships these
 * as tokens at the root, so the dialog renders correctly even when
 * mounted outside the main `.fl-shell` scope (e.g. inside a portal).
 */

import * as React from 'react';
import type { AgentCredentialOption } from '../api/credentials.api';
import type { AgentProviderId } from '../../shared/types';
import { ModelSelector, type ModelSelection } from './ModelSelector';
import { PROVIDER_CATALOGUE } from '../lib/provider-models';

export interface NewChatDialogProps {
  open: boolean;
  credentials: AgentCredentialOption[];
  isLoading: boolean;
  error: Error | null;
  isStarting: boolean;
  onCancel: () => void;
  onStart: (input: {
    credentialId: string | null;
    providerId?: AgentProviderId;
    model?: string;
  }) => void;
  /**
   * Optional one-line context shown above the credential list — e.g.
   * "Adding to workspace: My Project" or "Starting a new workspace".
   * Purely informational; the caller binds the workspaceId at the API
   * call site.
   */
  targetLabel?: string;
}

export function NewChatDialog({
  open,
  credentials,
  isLoading,
  error,
  isStarting,
  onCancel,
  onStart,
  targetLabel,
}: NewChatDialogProps): React.ReactElement | null {
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [selectedModel, setSelectedModel] = React.useState<ModelSelection>(() => {
    const fallback = PROVIDER_CATALOGUE[0];
    const fallbackModel = fallback?.models[0];
    if (!fallback || !fallbackModel) {
      throw new Error('NewChatDialog: PROVIDER_CATALOGUE is empty');
    }
    return { providerId: fallback.id, model: fallbackModel.id };
  });

  // Auto-select the first active credential when the dialog opens so
  // the user can usually press Enter without picking from a list.
  React.useEffect(() => {
    if (!open) {
      return;
    }
    setSelectedId((prev) => {
      if (prev && credentials.some((c) => c.id === prev)) {
        return prev;
      }
      return credentials.find((c) => c.isActive)?.id ?? null;
    });
  }, [open, credentials]);

  if (!open) {
    return null;
  }

  const handleStart = () => {
    onStart({
      credentialId: selectedId,
      providerId: selectedModel.providerId,
      model: selectedModel.model,
    });
  };

  const grouped = groupByProvider(credentials);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-chat-dialog-title"
      onClick={onCancel}
      data-testid="new-chat-dialog"
    >
      <div
        className="w-full max-w-md rounded-lg border border-fl-border bg-fl-card text-fl-card-foreground shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-fl-border">
          <h2 id="new-chat-dialog-title" className="text-lg font-semibold">
            Start a new chat
          </h2>
          <p className="text-sm text-fl-muted-foreground mt-1">
            Pick the LLM credential this chat should use. You can change it later from the chat
            settings.
          </p>
          {targetLabel ? (
            <p className="text-xs text-fl-muted-foreground mt-2" data-testid="new-chat-target">
              {targetLabel}
            </p>
          ) : null}
        </div>

        <div className="px-5 py-3 border-b border-fl-border">
          <div className="text-xs font-medium uppercase tracking-wide text-fl-muted-foreground mb-1.5">
            Model
          </div>
          <ModelSelector
            providerId={selectedModel.providerId}
            model={selectedModel.model}
            onChange={setSelectedModel}
            variant="block"
            testIdPrefix="new-chat-model-selector"
          />
        </div>

        <div className="px-5 py-4 max-h-[420px] overflow-y-auto">
          {isLoading ? (
            <div className="text-sm text-fl-muted-foreground">Loading credentials…</div>
          ) : error ? (
            <div className="rounded-md border border-fl-destructive/40 bg-fl-destructive/10 px-3 py-2 text-sm text-fl-destructive">
              Failed to load credentials: {error.message}
            </div>
          ) : credentials.length === 0 ? (
            <EmptyHint />
          ) : (
            <ul className="space-y-3" data-testid="credential-list">
              {Object.entries(grouped).map(([provider, items]) => (
                <li key={provider}>
                  <div className="text-xs font-medium uppercase tracking-wide text-fl-muted-foreground mb-1">
                    {provider}
                  </div>
                  <ul className="space-y-1">
                    {items.map((c) => (
                      <li key={c.id}>
                        <label
                          className={`flex items-center gap-3 rounded-md border px-3 py-2 cursor-pointer transition-colors ${
                            selectedId === c.id
                              ? 'border-fl-primary bg-fl-primary/5'
                              : 'border-fl-border hover:bg-fl-muted/30'
                          } ${c.isActive ? '' : 'opacity-60 cursor-not-allowed'}`}
                          data-testid={`credential-option-${c.id}`}
                        >
                          <input
                            type="radio"
                            name="credential"
                            value={c.id}
                            checked={selectedId === c.id}
                            disabled={!c.isActive}
                            onChange={() => setSelectedId(c.id)}
                            className="accent-fl-primary"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="font-medium truncate">{c.name}</div>
                            {c.description ? (
                              <div className="text-xs text-fl-muted-foreground truncate">
                                {c.description}
                              </div>
                            ) : null}
                          </div>
                          {!c.isActive ? (
                            <span className="text-xs text-fl-muted-foreground">inactive</span>
                          ) : null}
                        </label>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="px-5 py-3 border-t border-fl-border flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setSelectedId(null)}
            className="text-xs text-fl-muted-foreground hover:underline disabled:opacity-50"
            disabled={selectedId === null || isStarting}
            data-testid="new-chat-clear-credential"
          >
            Use deployment default
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={isStarting}
              className="rounded-md px-3 py-1.5 text-sm font-medium hover:bg-fl-muted/30 disabled:opacity-50"
              data-testid="new-chat-cancel"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleStart}
              disabled={isStarting}
              className="rounded-md bg-fl-primary px-3 py-1.5 text-sm font-medium text-fl-primary-foreground hover:opacity-90 disabled:opacity-50"
              data-testid="new-chat-start"
            >
              {isStarting ? 'Starting…' : 'Start chat'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyHint(): React.ReactElement {
  return (
    <div className="rounded-md border border-dashed border-fl-border px-4 py-6 text-center text-sm text-fl-muted-foreground">
      <p>No LLM credentials yet.</p>
      <p className="mt-1">
        Add one from the Credentials page (type: <span className="font-mono">llm</span>) and the
        chat will use it.
      </p>
    </div>
  );
}

function groupByProvider(creds: AgentCredentialOption[]): Record<string, AgentCredentialOption[]> {
  const out: Record<string, AgentCredentialOption[]> = {};
  for (const c of creds) {
    const key = c.provider || 'custom';
    if (!out[key]) {
      out[key] = [];
    }
    out[key].push(c);
  }
  return out;
}
