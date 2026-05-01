/**
 * SessionsList — active sessions for the current user. Shown inside the
 * Security card on the profile page.
 */

import { Loader2, MonitorSmartphone } from 'lucide-react';
import { useListSessions, useRevokeSession } from '../hooks';

interface BetterAuthSession {
  id: string;
  token: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt: string;
  expiresAt: string;
}

export function SessionsList() {
  const sessions = useListSessions();
  const revoke = useRevokeSession();

  if (sessions.isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border bg-background p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading sessions…
      </div>
    );
  }

  // `useListSessions` wires `throw: true` so `data` is the array directly.
  const list = (sessions.data ?? []) as unknown as BetterAuthSession[];

  if (!Array.isArray(list) || list.length === 0) {
    return (
      <p className="rounded-md border border-border bg-background p-4 text-sm text-muted-foreground">
        No active sessions.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {list.map((s) => {
        const ua = parseUserAgent(s.userAgent ?? undefined);
        const created = formatRelative(s.createdAt);
        return (
          <li
            key={s.id}
            className="flex items-center justify-between gap-3 rounded-md border border-border bg-background p-3"
          >
            <div className="flex min-w-0 items-center gap-3">
              <MonitorSmartphone className="h-5 w-5 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{ua}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {s.ipAddress || 'Unknown IP'} · started {created}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={async () => {
                await revoke.mutateAsync({ token: s.token });
              }}
              disabled={revoke.isPending}
              className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-medium hover:bg-accent disabled:opacity-50"
            >
              Sign out
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function parseUserAgent(ua: string | undefined): string {
  if (!ua) {
    return 'Unknown device';
  }
  const m = ua.match(/(Chrome|Firefox|Safari|Edge)\/[\d.]+/);
  const browser = m?.[1] ?? 'Browser';
  if (/Mac/.test(ua)) {
    return `${browser} · macOS`;
  }
  if (/Windows/.test(ua)) {
    return `${browser} · Windows`;
  }
  if (/Linux/.test(ua)) {
    return `${browser} · Linux`;
  }
  if (/iPhone|iPad/.test(ua)) {
    return `${browser} · iOS`;
  }
  if (/Android/.test(ua)) {
    return `${browser} · Android`;
  }
  return browser;
}

function formatRelative(iso: string | undefined): string {
  if (!iso) {
    return 'recently';
  }
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) {
    return 'recently';
  }
  const diff = Date.now() - ts;
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) {
    return 'just now';
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}
