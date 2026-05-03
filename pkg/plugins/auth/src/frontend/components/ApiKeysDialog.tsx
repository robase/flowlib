/**
 * ApiKeysDialog — Admin dialog for managing API keys.
 *
 * Displays a list of API keys with the ability to:
 * - Create new API keys (name, optional expiry)
 * - Copy newly created keys
 * - Delete existing keys
 *
 * Only functional when the auth plugin has API keys enabled.
 */

import { useState, useCallback, type FormEvent } from 'react';
import { Copy, Check, Trash2, Plus, Key, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@flowlib/ui';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

interface ApiKey {
  id: string;
  name?: string | null;
  start?: string | null;
  prefix?: string | null;
  enabled?: boolean;
  expiresAt?: string | null;
  createdAt?: string;
  userId?: string;
  referenceId?: string;
}

export interface ApiKeysDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  apiBaseUrl: string;
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function isExpired(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) {
    return false;
  }
  return new Date(expiresAt) < new Date();
}

// ─────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────

export function ApiKeysDialog({ open, onOpenChange, apiBaseUrl }: ApiKeysDialogProps) {
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasFetched, setHasFetched] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null);
  const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const authApiBase = `${apiBaseUrl}/plugins/auth`;

  // ── Fetch API Keys ─────────────────────────────────────────

  const fetchApiKeys = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`${authApiBase}/api-keys`, { credentials: 'include' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Failed to fetch API keys' }));
        throw new Error(data.error || data.message || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setApiKeys(data.apiKeys ?? []);
      setHasFetched(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch API keys');
    } finally {
      setIsLoading(false);
    }
  }, [authApiBase]);

  // ── Delete API Key ─────────────────────────────────────────

  const deleteApiKey = useCallback(
    async (keyId: string) => {
      try {
        const res = await fetch(`${authApiBase}/api-keys/${keyId}`, {
          method: 'DELETE',
          credentials: 'include',
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        setApiKeys((prev) => prev.filter((k) => k.id !== keyId));
        setPendingDeleteId(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete API key');
        setPendingDeleteId(null);
      }
    },
    [authApiBase],
  );

  // ── Copy to Clipboard ─────────────────────────────────────

  const copyToClipboard = useCallback(async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKeyId(id);
      setTimeout(() => setCopiedKeyId(null), 2000);
    } catch {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopiedKeyId(id);
      setTimeout(() => setCopiedKeyId(null), 2000);
    }
  }, []);

  // ── Auto-fetch on open ────────────────────────────────────

  if (open && !hasFetched && !isLoading) {
    fetchApiKeys();
  }

  // Reset state on close
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setShowCreateForm(false);
      setNewlyCreatedKey(null);
      setError(null);
      setPendingDeleteId(null);
      setHasFetched(false);
    }
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg border-fl-border bg-fl-background text-fl-foreground sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
            <Key className="h-4 w-4" />
            API Keys
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {/* Newly created key banner */}
          {newlyCreatedKey && (
            <div className="rounded-md border border-green-500/30 bg-green-50 p-3 dark:bg-green-950/20">
              <p className="mb-1.5 text-xs font-medium text-green-700 dark:text-green-400">
                API key created! Copy it now — it won't be shown again.
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded bg-green-100 px-2 py-1 text-xs font-mono text-green-800 dark:bg-green-900/30 dark:text-green-300 break-all">
                  {newlyCreatedKey}
                </code>
                <button
                  type="button"
                  onClick={() => copyToClipboard(newlyCreatedKey, 'new-key')}
                  className="shrink-0 rounded-md border border-green-300 p-1.5 text-green-700 hover:bg-green-100 dark:border-green-700 dark:text-green-400 dark:hover:bg-green-900/40"
                >
                  {copiedKeyId === 'new-key' ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-md bg-red-50 p-2 text-xs text-red-600 dark:bg-red-950/20 dark:text-red-400">
              {error}
              <button
                type="button"
                onClick={() => setError(null)}
                className="ml-2 underline hover:no-underline"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Create form toggle */}
          {!showCreateForm && (
            <button
              type="button"
              onClick={() => setShowCreateForm(true)}
              className="flex items-center gap-1.5 rounded-lg border border-fl-border px-3 py-1.5 text-xs font-medium text-fl-muted-foreground transition-colors hover:border-fl-primary/50 hover:text-fl-foreground"
            >
              <Plus className="h-3.5 w-3.5" /> Create API Key
            </button>
          )}

          {/* Create form inline */}
          {showCreateForm && (
            <CreateApiKeyForm
              apiBaseUrl={authApiBase}
              onCreated={(key, fullKey) => {
                setApiKeys((prev) => [key, ...prev]);
                setNewlyCreatedKey(fullKey);
                setShowCreateForm(false);
              }}
              onCancel={() => setShowCreateForm(false)}
            />
          )}

          {/* API Keys list */}
          <div className="max-h-[300px] space-y-1.5 overflow-y-auto">
            {isLoading && !hasFetched && (
              <div className="flex items-center justify-center py-8 text-xs text-fl-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading…
              </div>
            )}

            {hasFetched && apiKeys.length === 0 && (
              <div className="py-8 text-center text-xs text-fl-muted-foreground">
                No API keys yet. Create one to get started.
              </div>
            )}

            {apiKeys.map((key) => {
              const expired = isExpired(key.expiresAt);
              return (
                <div
                  key={key.id}
                  className={`flex items-center justify-between rounded-lg border px-3 py-2.5 ${
                    expired
                      ? 'border-red-300/50 bg-red-50/50 dark:border-red-800/30 dark:bg-red-950/10'
                      : 'border-fl-border bg-fl-muted/10'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-fl-foreground truncate">
                        {key.name || 'Unnamed key'}
                      </span>
                      {expired && (
                        <span className="shrink-0 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
                          Expired
                        </span>
                      )}
                      {key.enabled === false && (
                        <span className="shrink-0 rounded-full bg-yellow-100 px-1.5 py-0.5 text-[10px] font-medium text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
                          Disabled
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-[11px] text-fl-muted-foreground">
                      {key.start && (
                        <span className="font-mono">
                          {key.prefix ? `${key.prefix}_` : ''}
                          {key.start}…
                        </span>
                      )}
                      {key.createdAt && <span>Created {formatDate(key.createdAt)}</span>}
                      {key.expiresAt && !expired && (
                        <span>Expires {formatDate(key.expiresAt)}</span>
                      )}
                    </div>
                  </div>

                  {pendingDeleteId === key.id ? (
                    <div className="flex items-center gap-1.5 shrink-0 ml-2">
                      <button
                        type="button"
                        onClick={() => deleteApiKey(key.id)}
                        className="rounded-md bg-red-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-red-700"
                      >
                        Confirm
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingDeleteId(null)}
                        className="rounded-md border border-fl-border px-2 py-1 text-[11px] hover:bg-fl-muted"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setPendingDeleteId(key.id)}
                      className="shrink-0 ml-2 rounded-md p-1.5 text-fl-muted-foreground transition-colors hover:bg-fl-destructive/10 hover:text-fl-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={() => handleOpenChange(false)}
            className="rounded-md border border-fl-border px-3 py-1.5 text-sm hover:bg-fl-muted"
          >
            Close
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────
// Internal: Create API Key Form
// ─────────────────────────────────────────────────────────────

function CreateApiKeyForm({
  apiBaseUrl,
  onCreated,
  onCancel,
}: {
  apiBaseUrl: string;
  onCreated: (key: ApiKey, fullKey: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [expiresIn, setExpiresIn] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const EXPIRY_OPTIONS = [
    { value: '', label: 'No expiry' },
    { value: '86400', label: '1 day' },
    { value: '604800', label: '7 days' },
    { value: '2592000', label: '30 days' },
    { value: '7776000', label: '90 days' },
    { value: '31536000', label: '1 year' },
  ];

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const body: Record<string, unknown> = {};
      if (name.trim()) {
        body.name = name.trim();
      }
      if (expiresIn) {
        body.expiresIn = parseInt(expiresIn, 10);
      }

      const res = await fetch(`${apiBaseUrl}/api-keys`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || data.message || `HTTP ${res.status}`);
      }
      // The response contains the full key value (only time it's visible)
      const fullKey = data.key ?? data.apiKey?.key ?? '';
      const keyRecord: ApiKey = {
        id: data.id ?? data.apiKey?.id ?? '',
        name: data.name ?? data.apiKey?.name ?? (name.trim() || null),
        start: data.start ?? data.apiKey?.start ?? null,
        prefix: data.prefix ?? data.apiKey?.prefix ?? null,
        enabled: data.enabled ?? data.apiKey?.enabled ?? true,
        expiresAt: data.expiresAt ?? data.apiKey?.expiresAt ?? null,
        createdAt: data.createdAt ?? data.apiKey?.createdAt ?? new Date().toISOString(),
      };
      onCreated(keyRecord, fullKey);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create API key');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-3 rounded-lg border border-fl-border bg-fl-muted/10 p-3"
    >
      <div className="text-xs font-medium text-fl-foreground">Create API Key</div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-fl-foreground">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Production API"
            className="w-full rounded-md border border-fl-border bg-fl-background px-3 py-1.5 text-sm placeholder:text-fl-muted-foreground focus:border-fl-primary/50 focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-fl-foreground">Expiry</label>
          <select
            value={expiresIn}
            onChange={(e) => setExpiresIn(e.target.value)}
            className="w-full rounded-md border border-fl-border bg-fl-background px-3 py-1.5 text-sm focus:border-fl-primary/50 focus:outline-none"
          >
            {EXPIRY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 p-2 text-xs text-red-600 dark:bg-red-950/20 dark:text-red-400">
          {error}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-fl-border px-3 py-1.5 text-xs hover:bg-fl-muted"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-md bg-fl-primary px-3 py-1.5 text-xs font-semibold text-fl-primary-foreground hover:bg-fl-primary/90 disabled:opacity-50"
        >
          {isSubmitting ? 'Creating…' : 'Create'}
        </button>
      </div>
    </form>
  );
}
