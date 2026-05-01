/**
 * ApiKeysCard — inline list + create flow for the user's API keys.
 *
 * Hits the auth plugin's REST endpoints under `${apiBaseUrl}/plugins/auth/api-keys`
 * (same as the legacy ApiKeysDialog) — those routes are wired by the
 * `@flowlib/user-auth` backend when the api-key option is enabled. When it
 * isn't enabled the list endpoint 404s and we render an inline notice.
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Check, Copy, Loader2, Plus, Trash2 } from 'lucide-react';
import { useAuth } from '../../providers/AuthProvider';
import { ErrorMessage, Field, TextInput } from '../ui/auth-form';

interface ApiKey {
  id: string;
  name?: string | null;
  start?: string | null;
  prefix?: string | null;
  enabled?: boolean;
  expiresAt?: string | null;
  createdAt?: string;
}

const EXPIRY_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '', label: 'No expiry' },
  { value: '86400', label: '1 day' },
  { value: '604800', label: '7 days' },
  { value: '2592000', label: '30 days' },
  { value: '7776000', label: '90 days' },
  { value: '31536000', label: '1 year' },
];

function formatDate(iso?: string | null): string {
  if (!iso) {
    return '';
  }
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function isExpired(expiresAt?: string | null): boolean {
  if (!expiresAt) {
    return false;
  }
  return new Date(expiresAt) < new Date();
}

export function ApiKeysCard() {
  const { baseUrl } = useAuth();
  const apiBase = `${baseUrl}/plugins/auth`;

  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [maxKeys, setMaxKeys] = useState<number>(10);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api-keys`, { credentials: 'include' });
      if (res.status === 404) {
        setUnavailable(true);
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || body.message || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setKeys(data.apiKeys ?? []);
      if (typeof data.maxKeysPerUser === 'number') {
        setMaxKeys(data.maxKeysPerUser);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load API keys');
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  const atLimit = keys.length >= maxKeys;

  useEffect(() => {
    load();
  }, [load]);

  const remove = async (id: string) => {
    try {
      const res = await fetch(`${apiBase}/api-keys/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setKeys((prev) => prev.filter((k) => k.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete API key');
    } finally {
      setPendingDelete(null);
    }
  };

  const copy = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // Clipboard API unavailable — silently ignore.
    }
  };

  if (unavailable) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
        API keys are not enabled for this Flowlib instance. Pass{' '}
        <code className="font-mono">apiKey: true</code> to the auth plugin to enable.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {newKey && (
        <div className="rounded-md border border-success/40 bg-success/10 p-3">
          <p className="mb-1.5 text-xs font-medium text-success">
            API key created — copy it now, it won&apos;t be shown again.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all rounded bg-card px-2 py-1 font-mono text-xs">
              {newKey}
            </code>
            <button
              type="button"
              onClick={() => copy(newKey, 'new')}
              className="shrink-0 rounded-md border border-border p-1.5 hover:bg-accent"
            >
              {copied === 'new' ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </button>
            <button
              type="button"
              onClick={() => setNewKey(null)}
              className="shrink-0 rounded-md border border-border px-2 py-1.5 text-xs hover:bg-accent"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <ErrorMessage>{error}</ErrorMessage>

      <div className="overflow-hidden rounded-lg border border-border">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold">Your API keys</h3>
            <p className="text-xs text-muted-foreground">
              {atLimit
                ? `You've reached the ${maxKeys}-key limit. Delete a key to create a new one.`
                : `Don't share keys publicly — they grant access to your account. (${keys.length}/${maxKeys})`}
            </p>
          </div>
          {!showCreate && (
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              disabled={atLimit}
              className="inline-flex h-8 text-sm items-center gap-2 rounded-md bg-primary px-3 font-medium text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
              New
            </button>
          )}
        </div>

        {showCreate && (
          <div className="border-b border-border bg-muted/30 p-4">
            <CreateApiKeyForm
              apiBase={apiBase}
              onCreated={(rec, full) => {
                setKeys((prev) => [rec, ...prev]);
                setNewKey(full);
                setShowCreate(false);
              }}
              onCancel={() => setShowCreate(false)}
            />
          </div>
        )}

        {loading && keys.length === 0 ? (
          <div className="flex items-center justify-center gap-2 px-4 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        ) : keys.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            No API keys yet. Create one to get started.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs font-medium text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Name</th>
                <th className="px-4 py-2 text-left font-medium">Status</th>
                <th className="px-4 py-2 text-left font-medium">Created</th>
                <th className="px-4 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => {
                const expired = isExpired(k.expiresAt);
                const status = expired
                  ? { label: 'expired', cls: 'bg-destructive/15 text-destructive' }
                  : k.enabled === false
                    ? { label: 'disabled', cls: 'bg-warning/15 text-warning' }
                    : { label: 'active', cls: 'bg-success/15 text-success' };
                return (
                  <tr key={k.id} className="border-t border-border">
                    <td className="px-4 py-3">{k.name || 'Unnamed key'}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${status.cls}`}
                      >
                        {status.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{formatDate(k.createdAt)}</td>
                    <td className="px-4 py-3 text-right">
                      {pendingDelete === k.id ? (
                        <span className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => remove(k.id)}
                            className="rounded-md bg-destructive px-2 py-1 text-xs font-medium text-destructive-foreground hover:bg-destructive/90"
                          >
                            Confirm
                          </button>
                          <button
                            type="button"
                            onClick={() => setPendingDelete(null)}
                            className="rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
                          >
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setPendingDelete(k.id)}
                          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                          aria-label="Delete API key"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── Internal: create form ───────────────────────────────────────

function CreateApiKeyForm({
  apiBase,
  onCreated,
  onCancel,
}: {
  apiBase: string;
  onCreated: (rec: ApiKey, fullKey: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [expiresIn, setExpiresIn] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {};
      if (name.trim()) {
        body.name = name.trim();
      }
      if (expiresIn) {
        body.expiresIn = parseInt(expiresIn, 10);
      }

      const res = await fetch(`${apiBase}/api-keys`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || data.message || `HTTP ${res.status}`);
      }
      const fullKey = data.key ?? data.apiKey?.key ?? '';
      const rec: ApiKey = {
        id: data.id ?? data.apiKey?.id ?? '',
        name: data.name ?? data.apiKey?.name ?? (name.trim() || null),
        start: data.start ?? data.apiKey?.start ?? null,
        prefix: data.prefix ?? data.apiKey?.prefix ?? null,
        enabled: data.enabled ?? data.apiKey?.enabled ?? true,
        expiresAt: data.expiresAt ?? data.apiKey?.expiresAt ?? null,
        createdAt: data.createdAt ?? data.apiKey?.createdAt ?? new Date().toISOString(),
      };
      onCreated(rec, fullKey);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create API key');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Name" htmlFor="api-key-name">
          <TextInput
            id="api-key-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Production API"
          />
        </Field>
        <Field label="Expires" htmlFor="api-key-expiry">
          <select
            id="api-key-expiry"
            value={expiresIn}
            onChange={(e) => setExpiresIn(e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {EXPIRY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <ErrorMessage>{error}</ErrorMessage>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="h-8 rounded-md border border-border px-3 text-xs hover:bg-accent"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex h-8 items-center gap-2 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
        >
          {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {submitting ? 'Creating…' : 'Create'}
        </button>
      </div>
    </form>
  );
}
