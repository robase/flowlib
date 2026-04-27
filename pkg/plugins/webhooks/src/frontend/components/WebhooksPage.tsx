/**
 * WebhooksPage — Main webhook management page.
 *
 * Lists all webhook triggers with status, auth mode, linked flows, and last activity.
 * Click a row to open the detail dialog for editing, toggling, or deleting.
 */

import { useState, useRef, type FC } from 'react';
import { Globe, Plus, Search, Clock, Hash, ChevronRight, Loader2, Workflow } from 'lucide-react';
import { PageLayout, Dialog, DialogContent, useFlows } from '@flowlib/ui';
import { useWebhookTriggers } from '../hooks/useWebhookQueries';
import { CreateWebhookModal } from './CreateWebhookModal';
import { WebhookDetailPanel } from './WebhookDetailPanel';
import type { WebhookTrigger } from '../../shared/types';

// ─── Constants ──────────────────────────────────────────────────────

const AUTH_MODE_CONFIG: Record<string, { label: string; color: string }> = {
  generic: {
    label: 'Unauthenticated',
    color: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800/40 dark:text-zinc-400',
  },
  hmac: {
    label: 'HMAC',
    color: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
  },
  ip_whitelist: {
    label: 'IP Whitelist',
    color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  },
  signed: {
    label: 'Signed',
    color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  },
};

function getAuthModeConfig(trigger: WebhookTrigger) {
  if (trigger.provider !== 'generic') {
    return AUTH_MODE_CONFIG.signed;
  }
  if (trigger.hmacEnabled) {
    return AUTH_MODE_CONFIG.hmac;
  }
  if (trigger.allowedIps) {
    return AUTH_MODE_CONFIG.ip_whitelist;
  }
  return AUTH_MODE_CONFIG.generic;
}

// ─── Helpers ────────────────────────────────────────────────────────

function formatRelativeTime(iso?: string): string {
  if (!iso) {
    return 'Never';
  }
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) {
    return 'Just now';
  }
  if (mins < 60) {
    return `${mins}m ago`;
  }
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 30) {
    return `${days}d ago`;
  }
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ─── Webhook Row ────────────────────────────────────────────────────

const WebhookRow: FC<{
  trigger: WebhookTrigger;
  flowName?: string;
  onClick: () => void;
}> = ({ trigger, flowName, onClick }) => {
  const authModeConfig = getAuthModeConfig(trigger);

  return (
    <button
      className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 transition-colors"
      onClick={onClick}
    >
      {/* Icon */}
      <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-muted/60 shrink-0">
        <Globe className="w-4 h-4 text-muted-foreground" />
      </div>

      {/* Name + subtitle */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{trigger.name}</span>
          <span
            className={`w-1.5 h-1.5 rounded-full shrink-0 ${
              trigger.isEnabled ? 'bg-emerald-500' : 'bg-muted-foreground/40'
            }`}
          />
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          {flowName ? (
            <span className="text-xs text-muted-foreground flex items-center gap-1 truncate">
              <Workflow className="w-3 h-3 shrink-0" />
              {flowName}
            </span>
          ) : trigger.description ? (
            <span className="text-xs text-muted-foreground truncate">{trigger.description}</span>
          ) : (
            <span className="text-xs text-muted-foreground/50">No flow linked</span>
          )}
        </div>
      </div>

      {/* Auth badge */}
      <span
        className={`hidden sm:inline-flex items-center rounded-full border border-transparent px-2 py-0.5 text-[10px] font-medium ${authModeConfig.color}`}
      >
        {authModeConfig.label}
      </span>

      {/* Stats */}
      <div className="hidden md:flex items-center gap-4 text-xs text-muted-foreground shrink-0">
        <span className="flex items-center gap-1" title="Total triggers">
          <Hash className="w-3 h-3" />
          {trigger.triggerCount}
        </span>
        <span className="flex items-center gap-1 w-16 justify-end" title="Last triggered">
          <Clock className="w-3 h-3" />
          {formatRelativeTime(trigger.lastTriggeredAt)}
        </span>
      </div>

      <ChevronRight className="w-4 h-4 text-muted-foreground/50 shrink-0" />
    </button>
  );
};

// ─── Main Page ──────────────────────────────────────────────────────

export const WebhooksPage: FC<{ basePath: string }> = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedTrigger, setSelectedTrigger] = useState<WebhookTrigger | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'enabled' | 'disabled'>('all');

  const { data: triggers, isLoading, error } = useWebhookTriggers();
  const { data: flowsResponse } = useFlows();

  // Build flow name lookup
  const flowNameMap = new Map<string, string>();
  for (const flow of flowsResponse?.data ?? []) {
    flowNameMap.set(flow.id, flow.name);
  }

  // Filter
  const filtered = (triggers ?? []).filter((t) => {
    if (statusFilter === 'enabled' && !t.isEnabled) {
      return false;
    }
    if (statusFilter === 'disabled' && t.isEnabled) {
      return false;
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const nameMatch = t.name.toLowerCase().includes(q);
      const flowMatch = t.flowId
        ? (flowNameMap.get(t.flowId) ?? '').toLowerCase().includes(q)
        : false;
      if (!nameMatch && !flowMatch) {
        return false;
      }
    }
    return true;
  });

  const enabledCount = (triggers ?? []).filter((t) => t.isEnabled).length;
  const disabledCount = (triggers ?? []).filter((t) => !t.isEnabled).length;

  // Keep detail dialog in sync with list data
  const liveTrigger = selectedTrigger
    ? ((triggers ?? []).find((t) => t.id === selectedTrigger.id) ?? selectedTrigger)
    : null;

  return (
    <PageLayout
      title="Webhooks"
      subtitle="Receive events from external systems and route them into your flows."
      icon={Globe}
      actions={
        <button
          onClick={() => setCreateOpen(true)}
          className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium h-9 px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Webhook
        </button>
      }
    >
      <div ref={containerRef}>
        {/* Search + Filters */}
        <div className="flex flex-col gap-3 mb-4 sm:flex-row sm:items-center">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 pointer-events-none text-muted-foreground" />
            <input
              type="text"
              placeholder="Search webhooks…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-lg border border-border bg-transparent py-2 pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground focus:border-primary/50"
            />
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            {[
              { key: 'all' as const, label: `All (${triggers?.length ?? 0})` },
              { key: 'enabled' as const, label: `Enabled (${enabledCount})` },
              { key: 'disabled' as const, label: `Disabled (${disabledCount})` },
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setStatusFilter(key)}
                className={`px-2.5 py-1 text-xs font-medium rounded-full border transition-colors ${
                  statusFilter === key
                    ? 'bg-foreground text-background border-foreground'
                    : 'bg-card text-muted-foreground border-border hover:border-foreground/30'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading webhooks…
          </div>
        ) : error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30 p-4 text-sm text-red-600 dark:text-red-400">
            Failed to load webhooks: {(error as Error).message}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-center">
            <div className="rounded-full bg-muted p-3 mb-4">
              <Globe className="w-6 h-6 text-muted-foreground" />
            </div>
            <h3 className="text-sm font-semibold mb-1">
              {triggers?.length === 0 ? 'No webhooks yet' : 'No webhooks match your filter'}
            </h3>
            <p className="max-w-sm text-sm text-muted-foreground mb-4">
              {triggers?.length === 0
                ? 'Create a generic webhook endpoint to receive events from external systems.'
                : 'Try adjusting your search or filter criteria.'}
            </p>
            {triggers?.length === 0 && (
              <button
                onClick={() => setCreateOpen(true)}
                className="inline-flex items-center gap-2 rounded-md text-sm font-medium h-9 px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Create Webhook
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border bg-card">
            <div className="divide-y">
              {filtered.map((trigger) => (
                <WebhookRow
                  key={trigger.id}
                  trigger={trigger}
                  flowName={trigger.flowId ? flowNameMap.get(trigger.flowId) : undefined}
                  onClick={() => setSelectedTrigger(trigger)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Detail Dialog */}
      <Dialog
        open={!!selectedTrigger}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedTrigger(null);
          }
        }}
      >
        <DialogContent
          container={containerRef.current}
          className="max-w-2xl h-[32rem] flex flex-col gap-0 p-0 overflow-hidden"
          showCloseButton
        >
          {liveTrigger && (
            <WebhookDetailPanel
              trigger={liveTrigger}
              flowName={liveTrigger.flowId ? flowNameMap.get(liveTrigger.flowId) : undefined}
              onClose={() => setSelectedTrigger(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Create Modal */}
      <CreateWebhookModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        containerRef={containerRef}
      />
    </PageLayout>
  );
};
