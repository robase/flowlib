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
import { ProviderModelSelector, type ProviderModelSelection } from './ProviderModelSelector';
import { modelsForProvider, normalizeProviderSlug } from '../lib/provider-models';
import { useProviderCatalogue } from '../hooks/useSessions';

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
  // The agent runtime provider (e.g. `ai-sdk`) is a deployment concern,
  // separate from the LLM *vendor* the user picks via their credential.
  // The picker below selects the credential + model; the runtime provider
  // is the deployment default.
  const { defaultProviderId } = useProviderCatalogue();
  const [credentialId, setCredentialId] = React.useState<string | null>(null);
  const [model, setModel] = React.useState<string>('');

  // Auto-select the first active credential (and a starter model from the
  // static catalogue) when the dialog opens, so the user can usually press
  // Start without touching the dropdowns. Live models load in once the
  // credential is chosen and refine the list.
  React.useEffect(() => {
    if (!open) {
      return;
    }
    setCredentialId((prev) => {
      if (prev && credentials.some((c) => c.id === prev && c.isActive)) {
        return prev;
      }
      const first = credentials.find((c) => c.isActive);
      if (!first) {
        return null;
      }
      const seeded = modelsForProvider(normalizeProviderSlug(first.provider))[0]?.id ?? '';
      setModel((m) => m || seeded);
      return first.id;
    });
  }, [open, credentials]);

  if (!open) {
    return null;
  }

  const handleSelectionChange = (next: ProviderModelSelection) => {
    setCredentialId(next.credentialId);
    setModel(next.model);
  };

  const handleUseDefault = () => {
    setCredentialId(null);
    setModel('');
  };

  const handleStart = () => {
    onStart({
      credentialId,
      providerId: defaultProviderId as AgentProviderId | undefined,
      model: model || undefined,
    });
  };

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
        className="w-full max-w-md rounded-lg border border-border bg-card text-card-foreground shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-border">
          <h2 id="new-chat-dialog-title" className="text-lg font-semibold">
            Start a new chat
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Pick the LLM credential this chat should use. You can change it later from the chat
            settings.
          </p>
          {targetLabel ? (
            <p className="text-xs text-muted-foreground mt-2" data-testid="new-chat-target">
              {targetLabel}
            </p>
          ) : null}
        </div>

        <div className="px-5 py-4 border-b border-border">
          {isLoading ? (
            <div className="text-sm text-muted-foreground">Loading credentials…</div>
          ) : error ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              Failed to load credentials: {error.message}
            </div>
          ) : credentials.length === 0 ? (
            <EmptyHint />
          ) : (
            <>
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1.5">
                Provider &amp; model
              </div>
              <ProviderModelSelector
                credentialId={credentialId}
                model={model}
                onChange={handleSelectionChange}
                menuPlacement="bottom"
                testIdPrefix="new-chat-provider-model"
              />
              <p className="mt-2 text-xs text-muted-foreground">
                {credentialId
                  ? 'Models are fetched live from the selected provider. You can change this later from chat settings.'
                  : 'No provider selected — the chat will use the deployment default credential and model.'}
              </p>
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-border flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={handleUseDefault}
            className="text-xs text-muted-foreground hover:underline disabled:opacity-50"
            disabled={credentialId === null || isStarting}
            data-testid="new-chat-clear-credential"
          >
            Use deployment default
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={isStarting}
              className="rounded-md px-3 py-1.5 text-sm font-medium hover:bg-muted/30 disabled:opacity-50"
              data-testid="new-chat-cancel"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleStart}
              disabled={isStarting}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
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
    <div className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
      <p>No LLM credentials yet.</p>
      <p className="mt-1">
        Add one from the Credentials page (type: <span className="font-mono">llm</span>) and the
        chat will use it.
      </p>
    </div>
  );
}

