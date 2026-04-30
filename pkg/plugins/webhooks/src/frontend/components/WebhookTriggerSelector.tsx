/**
 * WebhookTriggerSelector — Dropdown to pick an existing webhook trigger
 * or create a new one inline. Used in the trigger.webhook node's config panel.
 */

import { useState, type FC } from 'react';
import { Globe, Plus, ChevronDown, ExternalLink } from 'lucide-react';
import { useFrontendPath } from '@flowlib/ui';
import { useWebhookTriggers } from '../hooks/useWebhookQueries';
import { CreateWebhookModal } from './CreateWebhookModal';
import { CopyableField } from './CopyableField';
import type { WebhookTrigger } from '../../shared/types';

interface WebhookTriggerSelectorProps {
  selectedId?: string;
  onSelect: (trigger: WebhookTrigger) => void;
  flowId?: string;
  nodeId?: string;
}

export const WebhookTriggerSelector: FC<WebhookTriggerSelectorProps> = ({
  selectedId,
  onSelect,
  flowId,
  nodeId,
}) => {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const { data: triggers, isLoading } = useWebhookTriggers();
  const basePath = useFrontendPath();

  const selected = triggers?.find((t) => t.id === selectedId);

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">Webhook Trigger</label>

      {/* Dropdown */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setDropdownOpen(!dropdownOpen)}
          className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 text-sm shadow-xs hover:bg-accent/50 transition-colors"
        >
          <span className="flex items-center gap-2 truncate">
            <Globe className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            {selected ? (
              <>
                <span className="truncate">{selected.name}</span>
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    selected.isEnabled ? 'bg-emerald-500' : 'bg-muted-foreground/40'
                  }`}
                />
              </>
            ) : (
              <span className="text-muted-foreground">
                {isLoading ? 'Loading…' : 'Select a webhook trigger…'}
              </span>
            )}
          </span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        </button>

        {dropdownOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setDropdownOpen(false)} />

            <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-lg shadow-lg max-h-60 overflow-auto">
              {/* Create new */}
              <button
                onClick={() => {
                  setDropdownOpen(false);
                  setCreateOpen(true);
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-primary hover:bg-accent/50 border-b border-border transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
                Create New Webhook
              </button>

              {/* Existing triggers */}
              {(triggers ?? []).length === 0 ? (
                <div className="px-3 py-4 text-xs text-muted-foreground text-center">
                  No webhook triggers yet
                </div>
              ) : (
                (triggers ?? []).map((trigger) => (
                  <button
                    key={trigger.id}
                    onClick={() => {
                      onSelect(trigger);
                      setDropdownOpen(false);
                    }}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent/50 transition-colors ${
                      trigger.id === selectedId ? 'bg-accent' : ''
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        trigger.isEnabled ? 'bg-emerald-500' : 'bg-muted-foreground/40'
                      }`}
                    />
                    <span className="truncate">{trigger.name}</span>
                    <span className="text-xs text-muted-foreground ml-auto shrink-0">
                      {trigger.provider}
                    </span>
                  </button>
                ))
              )}
            </div>
          </>
        )}
      </div>

      {/* Selected trigger info */}
      {selected && (
        <div className="space-y-2 p-3 rounded-lg bg-muted/30 border">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{selected.name}</span>
            <span
              className={`inline-flex items-center rounded-full border border-transparent px-2 py-0.5 text-[10px] font-medium ${
                selected.isEnabled
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                  : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800/40 dark:text-zinc-400'
              }`}
            >
              {selected.isEnabled ? 'Active' : 'Disabled'}
            </span>
          </div>
          <CopyableField value={`/plugins/webhooks/receive/${selected.webhookPath}`} />
          <a
            href={`${basePath}/webhooks`}
            className="text-xs text-primary hover:underline inline-flex items-center gap-1"
          >
            Manage webhooks <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      )}

      <CreateWebhookModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        flowId={flowId}
        nodeId={nodeId}
      />
    </div>
  );
};
