/**
 * SessionsSidebar — left rail listing chat sessions as a flat,
 * searchable list.
 *
 * Workspaces are an implementation detail: each chat is backed by its
 * own sandbox/workspace, but the user never sees or picks one. "+ New
 * chat" creates a session with `workspaceId` omitted; the backend
 * auto-provisions a fresh workspace + sandbox transparently. The list is
 * therefore flat — one row per chat — with no workspace grouping.
 */
import * as React from 'react';
import { Link, useNavigate } from 'react-router';
import { Plus, Search, Sparkles, Trash2 } from 'lucide-react';
import type { AgentSession } from '../../shared/types';
import { useDeleteSession } from '../hooks/useSessions';
import { StatusDot, type SessionStatus } from './StatusDot';
import { cn } from '../lib/cn';

export interface SessionsSidebarProps {
  basePath: string;
  sessions: AgentSession[];
  isLoading?: boolean;
  activeSessionId?: string | null;
  /** "+ New chat" — creates a session; backend auto-provisions a workspace. */
  onNewChat: () => void;
}

function sessionStatus(session: AgentSession): SessionStatus {
  return session.status === 'archived' ? 'idle' : 'active';
}

export function SessionsSidebar({
  basePath,
  sessions,
  isLoading,
  activeSessionId,
  onNewChat,
}: SessionsSidebarProps): React.ReactElement {
  const [query, setQuery] = React.useState('');

  const filtered = React.useMemo(() => {
    const active = sessions.filter((s) => s.status === 'active');
    const q = query.trim().toLowerCase();
    const matched = q ? active.filter((s) => s.title.toLowerCase().includes(q)) : active;
    return [...matched].sort((a, b) => lastActivityMs(b) - lastActivityMs(a));
  }, [sessions, query]);

  return (
    <div
      className="flex h-full min-h-0 w-full flex-col bg-sidebar"
      data-testid="agents-sessions-sidebar"
    >
      {/* Brand + new chat */}
      <div className="flex items-center justify-between gap-2 border-b border-sidebar-border px-4 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/15 text-primary">
            <Sparkles className="h-4 w-4" />
          </span>
          <span className="truncate text-sm font-semibold tracking-tight">Agents</span>
        </div>
        <button
          type="button"
          onClick={onNewChat}
          title="New chat"
          aria-label="New chat"
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          data-testid="agents-new-chat-button"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats…"
            aria-label="Search chats"
            className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
      </div>

      {/* Sessions */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-0.5 px-2 pb-4">
          {isLoading ? (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">Loading…</p>
          ) : filtered.length === 0 ? (
            <EmptyState query={query} onNewChat={onNewChat} />
          ) : (
            filtered.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                basePath={basePath}
                isActive={session.id === activeSessionId}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function SessionRow({
  session,
  basePath,
  isActive,
}: {
  session: AgentSession;
  basePath: string;
  isActive: boolean;
}): React.ReactElement {
  const deleteSession = useDeleteSession();

  const handleDelete = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (deleteSession.isPending) {
      return;
    }
    const ok = window.confirm(
      `Delete "${session.title || 'this chat'}"? Messages are archived; the chat is removed from the list.`,
    );
    if (!ok) {
      return;
    }
    deleteSession.mutate({ id: session.id });
  };

  return (
    <Link
      to={`${stripTrailingSlash(basePath)}/agents/sessions/${encodeURIComponent(session.id)}`}
      aria-current={isActive ? 'true' : undefined}
      className={cn(
        'group flex w-full items-center gap-2 rounded-md px-3 py-2 text-left transition-colors',
        isActive ? 'bg-sidebar-accent' : 'hover:bg-accent/60',
      )}
      data-testid={`agents-session-row-${session.id}`}
    >
      <StatusDot status={sessionStatus(session)} />
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-sm',
          isActive ? 'font-medium text-sidebar-accent-foreground' : 'text-foreground',
        )}
      >
        {session.title}
      </span>
      <button
        type="button"
        onClick={handleDelete}
        disabled={deleteSession.isPending}
        title="Delete chat"
        aria-label="Delete chat"
        className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 focus:opacity-100 disabled:opacity-50"
        data-testid={`agents-session-delete-${session.id}`}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </Link>
  );
}

function EmptyState({
  query,
  onNewChat,
}: {
  query: string;
  onNewChat: () => void;
}): React.ReactElement {
  if (query.trim()) {
    return <p className="px-2 py-6 text-center text-xs text-muted-foreground">No chats match.</p>;
  }
  return (
    <div className="px-2 py-6 text-center">
      <p className="text-sm text-muted-foreground">No chats yet.</p>
      <button
        type="button"
        onClick={onNewChat}
        className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
      >
        <Plus className="h-3.5 w-3.5" />
        New chat
      </button>
    </div>
  );
}

function lastActivityMs(session: AgentSession): number {
  const t = session.lastMessageAt ?? session.updatedAt;
  return t ? new Date(t).getTime() : 0;
}

function stripTrailingSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}
