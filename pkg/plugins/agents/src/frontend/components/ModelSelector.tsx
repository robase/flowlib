/**
 * ModelSelector — dropdown that surfaces the current session's
 * provider/model and lets the user switch.
 *
 * Visually mirrors assistant-ui's `ModelSelector` (chip-style trigger
 * with the active label, popover list grouped by provider) but is
 * wired to our PATCH /sessions/:id flow rather than assistant-ui's
 * `ModelContext` — the agents runtime tracks the model on the session
 * row, not in client state.
 *
 * Used in two places:
 *   1. ChatHeader — switch mid-session (the AgentChatDO re-reads the
 *      model on each turn).
 *   2. NewChatDialog — pick the model for a session being created.
 */
import * as React from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { PROVIDER_CATALOGUE, findModel, type ModelOption } from '../lib/provider-models';
import type { AgentProviderId } from '../../shared/types';

export interface ModelSelection {
  providerId: AgentProviderId;
  model: string;
}

export interface ModelSelectorProps {
  providerId: string | null | undefined;
  model: string | null | undefined;
  onChange: (next: ModelSelection) => void;
  disabled?: boolean;
  /** Visual variant: `header` is compact for the chat header; `block`
   *  is a wider trigger for dialogs / settings panels. */
  variant?: 'header' | 'block';
  /** Which side the popover opens toward. Defaults to `bottom`. */
  menuPlacement?: 'top' | 'bottom';
  className?: string;
  /** Optional id used to scope test selectors. */
  testIdPrefix?: string;
}

export function ModelSelector({
  providerId,
  model,
  onChange,
  disabled,
  variant = 'header',
  menuPlacement = 'bottom',
  className,
  testIdPrefix = 'agents-model-selector',
}: ModelSelectorProps): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) {
      return;
    }
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const activeModel = findModel(providerId, model);
  const activeLabel = activeModel?.label ?? model ?? 'Select a model';
  const activeProviderLabel = PROVIDER_CATALOGUE.find((p) => p.id === providerId)?.label;

  const handlePick = (pickedProvider: AgentProviderId, pickedModel: ModelOption) => {
    setOpen(false);
    if (pickedProvider === providerId && pickedModel.id === model) {
      return;
    }
    onChange({ providerId: pickedProvider, model: pickedModel.id });
  };

  const triggerClass =
    variant === 'header'
      ? 'inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-xs font-medium hover:bg-muted/40 disabled:opacity-50 disabled:cursor-not-allowed'
      : 'flex w-full items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm hover:bg-muted/40 disabled:opacity-50 disabled:cursor-not-allowed';

  return (
    <div ref={rootRef} className={`relative ${className ?? ''}`}>
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        disabled={disabled}
        className={triggerClass}
        aria-haspopup="listbox"
        aria-expanded={open}
        data-testid={`${testIdPrefix}-trigger`}
      >
        <span className="truncate">
          {activeProviderLabel ? (
            <span className="text-muted-foreground">{activeProviderLabel} · </span>
          ) : null}
          {activeLabel}
        </span>
        <ChevronDown className="size-3.5 shrink-0 opacity-70" />
      </button>

      {open ? (
        <div
          className={`absolute right-0 z-40 min-w-[240px] max-h-80 overflow-y-auto rounded-md border border-border bg-card text-card-foreground shadow-lg ${
            menuPlacement === 'top' ? 'bottom-full mb-1' : 'mt-1'
          }`}
          role="listbox"
          data-testid={`${testIdPrefix}-menu`}
        >
          {PROVIDER_CATALOGUE.map((provider) => (
            <div key={provider.id} className="py-1">
              <div className="px-3 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {provider.label}
              </div>
              {provider.models.map((m) => {
                const isActive = provider.id === providerId && m.id === model;
                return (
                  <button
                    key={`${provider.id}:${m.id}`}
                    type="button"
                    onClick={() => handlePick(provider.id, m)}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-muted/40 ${
                      isActive ? 'bg-muted/30' : ''
                    }`}
                    role="option"
                    aria-selected={isActive}
                    data-testid={`${testIdPrefix}-option-${provider.id}-${m.id}`}
                  >
                    <Check
                      className={`size-3 shrink-0 ${isActive ? 'opacity-100' : 'opacity-0'}`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{m.label}</div>
                      {m.description ? (
                        <div className="truncate text-[10px] text-muted-foreground">
                          {m.description}
                        </div>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
