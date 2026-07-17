/**
 * ProviderModelSelector — the two-dropdown model picker used in the chat
 * composer, mirroring the Flow UI's assistant-chat selectors:
 *
 *   [ Provider ▾ ] [ Model (searchable) ▾ ]
 *
 *   1. **Provider** — the LLM providers the org has credentials for
 *      (`anthropic`, `openai`, `openrouter`, …), derived from
 *      `useLlmCredentials()`. Picking one attaches that provider's
 *      credential to the session (so the credential vendor always
 *      matches the model vendor — no more "credential not found"
 *      mismatches). A footer row links to the Credentials page to add a
 *      new provider.
 *   2. **Model** — a searchable combobox of that provider's models. The
 *      list is a curated convenience set (`VENDOR_MODEL_CATALOGUE`); the
 *      search box also accepts free-text, so any model id works.
 *
 * Self-contained (no `@flowlib/ui` runtime imports — that would create a
 * dependency cycle): the dropdowns + combobox are hand-rolled, matching
 * the existing `ModelSelector` styling. CSS uses theme tokens only.
 */
import * as React from 'react';
import { Link, useLocation } from 'react-router';
import { AlertTriangle, Check, ChevronDown, Plus, Search } from 'lucide-react';
import { useCredentialModels, useLlmCredentials } from '../hooks/useCredentials';
import type { AgentCredentialOption } from '../api/credentials.api';
import {
  modelsForProvider,
  normalizeProviderSlug,
  providerLabel,
  type ModelOption,
} from '../lib/provider-models';

export interface ProviderModelSelection {
  /** Credential to attach (provider's representative credential). */
  credentialId: string | null;
  /** Full backend model string (`'<vendor>/<model>'`). */
  model: string;
}

export interface ProviderModelSelectorProps {
  credentialId: string | null | undefined;
  model: string | null | undefined;
  onChange: (next: ProviderModelSelection) => void;
  disabled?: boolean;
  /** Which side the popovers open toward. Defaults to `bottom`. */
  menuPlacement?: 'top' | 'bottom';
  testIdPrefix?: string;
}

interface ProviderOption {
  slug: string;
  label: string;
  /** Representative credential for this provider (first active one). */
  credential: AgentCredentialOption;
}

export function ProviderModelSelector({
  credentialId,
  model,
  onChange,
  disabled,
  menuPlacement = 'bottom',
  testIdPrefix = 'agents-provider-model',
}: ProviderModelSelectorProps): React.ReactElement {
  const { data: credentials, isLoading } = useLlmCredentials();
  const location = useLocation();

  // The agents UI is always mounted under `${basePath}/agents` — derive
  // the host's Credentials route from the current path so "Add provider"
  // works without threading `basePath` through every layer.
  const addProviderHref = React.useMemo(() => {
    const idx = location.pathname.indexOf('/agents');
    const root = idx >= 0 ? location.pathname.slice(0, idx) : '';
    return `${root}/credentials`;
  }, [location.pathname]);

  // One row per provider (deduped), each backed by its first active
  // credential — matches the user's "anthropic / openai / openrouter"
  // mental model rather than listing raw credential rows.
  const providers = React.useMemo<ProviderOption[]>(() => {
    const map = new Map<string, ProviderOption>();
    for (const c of credentials ?? []) {
      if (!c.isActive) {
        continue;
      }
      const slug = normalizeProviderSlug(c.provider);
      if (!map.has(slug)) {
        map.set(slug, { slug, label: providerLabel(c.provider), credential: c });
      }
    }
    return [...map.values()];
  }, [credentials]);

  const selectedCredential = React.useMemo(
    () => (credentials ?? []).find((c) => c.id === credentialId) ?? null,
    [credentials, credentialId],
  );
  const selectedSlug = selectedCredential
    ? normalizeProviderSlug(selectedCredential.provider)
    : null;

  // Live vendor catalogue for the selected credential; fall back to the
  // static list while loading or when the vendor has no live fetcher.
  const { data: liveModels, isLoading: modelsLoading } = useCredentialModels(credentialId);
  const isLive = Boolean(
    liveModels && liveModels.source === 'live' && liveModels.models.length > 0,
  );
  const modelOptions = React.useMemo<ModelOption[]>(() => {
    if (liveModels && liveModels.source === 'live' && liveModels.models.length > 0) {
      return liveModels.models;
    }
    return modelsForProvider(selectedSlug);
  }, [liveModels, selectedSlug]);
  const selectedModelOption = modelOptions.find((m) => m.id === model);

  // When the live lookup can't run we show the static catalogue — which is a
  // handful of models frozen at whatever was current when someone last edited
  // the file. Say so, and say why: an unannounced fallback looks identical to
  // a working picker, so a stale list survives indefinitely.
  const staleNotice =
    !modelsLoading && liveModels && !isLive
      ? (liveModels.error ??
        `Couldn't load the live ${liveModels.vendor} model list.`)
      : null;

  const handleProviderPick = (provider: ProviderOption) => {
    if (provider.credential.id === credentialId) {
      return;
    }
    // Reset to the new provider's first suggested model so we never carry
    // a model string from the old vendor into the new credential.
    //
    // `modelsForProvider` only knows the vendors in the static
    // catalogue (anthropic/openai/google/openrouter) and returns `[]`
    // for anything else — a Groq/Mistral/Azure/custom credential used to
    // fall through to `''`, which got PATCHed onto the session and made
    // the next message fail at the provider while the chip just read
    // "Select model". When there's no suggestion, keep the current model
    // rather than persisting an empty one: the combobox loads this
    // credential's live catalogue once it's selected, and accepts
    // free-text besides, so the user can correct it from a working
    // state.
    const suggested = modelsForProvider(provider.slug)[0]?.id;
    onChange({
      credentialId: provider.credential.id,
      model: suggested ?? model ?? '',
    });
  };

  const handleModelPick = (nextModel: string) => {
    if (nextModel === model) {
      return;
    }
    onChange({ credentialId: credentialId ?? null, model: nextModel });
  };

  const providerTriggerLabel = selectedCredential
    ? providerLabel(selectedCredential.provider)
    : isLoading
      ? 'Loading…'
      : providers.length === 0
        ? 'No providers'
        : 'Select provider';

  const modelTriggerLabel = selectedModelOption?.label ?? model ?? 'Select model';

  return (
    <div className="inline-flex items-center gap-1.5">
      <Dropdown
        disabled={disabled || isLoading}
        menuPlacement={menuPlacement}
        testId={`${testIdPrefix}-provider`}
        trigger={
          <>
            {selectedSlug ? <ProviderBadge slug={selectedSlug} /> : null}
            <span className="truncate">{providerTriggerLabel}</span>
          </>
        }
      >
        {(close) => (
          <div className="py-1" role="listbox" data-testid={`${testIdPrefix}-provider-menu`}>
            {providers.length === 0 ? (
              <div className="px-3 py-2 text-xs text-muted-foreground">No LLM credentials yet.</div>
            ) : (
              providers.map((p) => {
                const isActive = p.credential.id === credentialId;
                return (
                  <button
                    key={p.slug}
                    type="button"
                    onClick={() => {
                      handleProviderPick(p);
                      close();
                    }}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-muted/40 ${
                      isActive ? 'bg-muted/30' : ''
                    }`}
                    role="option"
                    aria-selected={isActive}
                    data-testid={`${testIdPrefix}-provider-option-${p.slug}`}
                  >
                    <ProviderBadge slug={p.slug} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{p.label}</div>
                      <div className="truncate text-[10px] text-muted-foreground">
                        {p.credential.name}
                      </div>
                    </div>
                    <Check
                      className={`size-3 shrink-0 ${isActive ? 'opacity-100' : 'opacity-0'}`}
                    />
                  </button>
                );
              })
            )}
            <div className="my-1 border-t border-border" />
            <Link
              to={addProviderHref}
              onClick={() => close()}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted/40"
              data-testid={`${testIdPrefix}-add-provider`}
            >
              <Plus className="size-3.5 shrink-0" />
              <span>Add a provider…</span>
            </Link>
          </div>
        )}
      </Dropdown>

      <ModelCombobox
        disabled={disabled || !selectedCredential}
        menuPlacement={menuPlacement}
        testId={`${testIdPrefix}-model`}
        triggerLabel={modelTriggerLabel}
        model={model ?? null}
        options={modelOptions}
        loading={modelsLoading}
        staleNotice={staleNotice}
        onPick={handleModelPick}
      />
    </div>
  );
}

// ─── Model combobox (searchable) ────────────────────────────────────────

function ModelCombobox({
  disabled,
  menuPlacement,
  testId,
  triggerLabel,
  model,
  options,
  loading,
  staleNotice,
  onPick,
}: {
  disabled?: boolean;
  menuPlacement: 'top' | 'bottom';
  testId: string;
  triggerLabel: string;
  model: string | null;
  options: ModelOption[];
  loading?: boolean;
  /** Set when `options` is the frozen static list rather than the live one. */
  staleNotice?: string | null;
  onPick: (model: string) => void;
}): React.ReactElement {
  const [query, setQuery] = React.useState('');

  const q = query.trim().toLowerCase();
  const filtered = q
    ? options.filter((m) => m.label.toLowerCase().includes(q) || m.id.toLowerCase().includes(q))
    : options;
  const hasExact = options.some((m) => m.id === query.trim());
  const showCustom = query.trim().length > 0 && !hasExact;

  return (
    <Dropdown
      disabled={disabled}
      menuPlacement={menuPlacement}
      testId={testId}
      onClose={() => setQuery('')}
      trigger={<span className="truncate">{triggerLabel}</span>}
    >
      {(close) => (
        <div role="listbox" data-testid={`${testId}-menu`}>
          <div className="flex items-center gap-2 border-b border-border px-2.5 py-1.5">
            <Search className="size-3.5 shrink-0 opacity-60" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search models…"
              className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
              data-testid={`${testId}-search`}
            />
          </div>
          {staleNotice ? (
            <div
              className="flex items-start gap-2 border-b border-border bg-muted/30 px-2.5 py-2"
              data-testid={`${testId}-stale-notice`}
            >
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 opacity-70" />
              <div className="min-w-0 text-[10px] leading-relaxed text-muted-foreground">
                <div className="font-medium">Showing cached defaults</div>
                <div className="truncate" title={staleNotice}>
                  {staleNotice}
                </div>
                <div>This list may be out of date — you can type any model id below.</div>
              </div>
            </div>
          ) : null}
          <div className="max-h-72 overflow-y-auto py-1">
            {loading ? (
              <div
                className="px-3 py-2 text-xs text-muted-foreground"
                data-testid={`${testId}-loading`}
              >
                Loading models…
              </div>
            ) : null}
            {filtered.map((m) => {
              const isActive = m.id === model;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    onPick(m.id);
                    close();
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-muted/40 ${
                    isActive ? 'bg-muted/30' : ''
                  }`}
                  role="option"
                  aria-selected={isActive}
                  data-testid={`${testId}-option-${m.id}`}
                >
                  <Check className={`size-3 shrink-0 ${isActive ? 'opacity-100' : 'opacity-0'}`} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{m.label}</div>
                    <div className="truncate text-[10px] text-muted-foreground">{m.id}</div>
                  </div>
                </button>
              );
            })}
            {filtered.length === 0 && !showCustom ? (
              <div className="px-3 py-2 text-xs text-muted-foreground">No models found.</div>
            ) : null}
            {showCustom ? (
              <button
                type="button"
                onClick={() => {
                  onPick(query.trim());
                  close();
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-muted/40"
                data-testid={`${testId}-custom`}
              >
                <Plus className="size-3 shrink-0" />
                <span>
                  Use “<span className="font-mono">{query.trim()}</span>”
                </span>
              </button>
            ) : null}
          </div>
        </div>
      )}
    </Dropdown>
  );
}

// ─── Shared dropdown shell ──────────────────────────────────────────────

function Dropdown({
  trigger,
  children,
  disabled,
  menuPlacement,
  testId,
  onClose,
}: {
  trigger: React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  disabled?: boolean;
  menuPlacement: 'top' | 'bottom';
  testId: string;
  onClose?: () => void;
}): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);

  const close = React.useCallback(() => {
    setOpen(false);
    onClose?.();
  }, [onClose]);

  React.useEffect(() => {
    if (!open) {
      return;
    }
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) {
        close();
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        close();
      }
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        disabled={disabled}
        className="inline-flex max-w-[180px] items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-xs font-medium hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-50"
        aria-haspopup="listbox"
        aria-expanded={open}
        data-testid={`${testId}-trigger`}
      >
        {trigger}
        <ChevronDown className="size-3.5 shrink-0 opacity-70" />
      </button>

      {open ? (
        <div
          className={`absolute left-0 z-40 min-w-[240px] rounded-md border border-border bg-card text-card-foreground shadow-lg ${
            menuPlacement === 'top' ? 'bottom-full mb-1' : 'mt-1'
          }`}
        >
          {children(close)}
        </div>
      ) : null}
    </div>
  );
}

/** Small brand-agnostic letter badge for a provider slug. */
function ProviderBadge({ slug }: { slug: string }): React.ReactElement {
  return (
    <span
      className="flex size-4 shrink-0 items-center justify-center rounded bg-muted text-[9px] font-semibold uppercase text-muted-foreground"
      aria-hidden="true"
    >
      {slug.charAt(0)}
    </span>
  );
}
