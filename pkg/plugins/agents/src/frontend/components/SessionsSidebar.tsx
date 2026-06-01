/**
 * SessionsSidebar — left rail listing chats, grouped by workspace.
 *
 * Cardinality model (see `docs/sessions-and-sandboxes.md`):
 *
 *   one workspace → one Cloudflare Sandbox
 *   one workspace → many sessions (chats)
 *
 * The sidebar surfaces both gestures explicitly:
 *
 *   - "+ New workspace" (top of sidebar, folder-plus icon) — provisions
 *     a fresh sandbox by creating a session with `workspaceId` omitted;
 *     the backend auto-creates a workspace row.
 *
 *   - "+ New chat" (per-workspace section, plus icon) — adds a session
 *     to the existing workspace, reusing its sandbox.
 *
 * Sessions whose `workspaceId` is `null` (legacy rows) are grouped
 * under an "Unassigned" header.
 */
import * as React from 'react';
import { Link } from 'react-router';
import {
  ChevronDown,
  ChevronRight,
  FolderPlus,
  MessageSquarePlus,
  MoreHorizontal,
  Server,
  Trash2,
} from 'lucide-react';
import type { AgentSession, AgentWorkspace } from '../../shared/types';
import { useDeleteSession } from '../hooks/useSessions';

export interface SessionsSidebarProps {
  basePath: string;
  sessions: AgentSession[];
  workspaces: AgentWorkspace[];
  isLoading?: boolean;
  activeSessionId?: string | null;
  /** "+ New workspace" — caller opens its dialog with `workspaceId: null`. */
  onNewWorkspace: () => void;
  /** "+ New chat in <workspace>" — caller opens its dialog with the given `workspaceId`. */
  onNewChat: (workspaceId: string) => void;
}

interface WorkspaceGroup {
  workspace: AgentWorkspace | null;
  sessions: AgentSession[];
}

function groupSessions(sessions: AgentSession[], workspaces: AgentWorkspace[]): WorkspaceGroup[] {
  const byId = new Map<string | '__none__', WorkspaceGroup>();
  // Seed the groups with all known workspaces in order so empty
  // workspaces still render a row (lets users start their first chat
  // in a fresh workspace they just created).
  for (const ws of workspaces) {
    byId.set(ws.id, { workspace: ws, sessions: [] });
  }
  for (const s of sessions) {
    const key = s.workspaceId ?? '__none__';
    const existing = byId.get(key);
    if (existing) {
      existing.sessions.push(s);
      continue;
    }
    if (s.workspaceId) {
      // Workspace row not in the list (deleted? cross-tenant?) — still
      // render the sessions under a placeholder.
      byId.set(s.workspaceId, {
        workspace: { id: s.workspaceId, name: 'Workspace' } as AgentWorkspace,
        sessions: [s],
      });
    } else {
      byId.set('__none__', { workspace: null, sessions: [s] });
    }
  }
  return Array.from(byId.values()).sort((a, b) => {
    // Workspaces with sessions first, by most-recent-message; then
    // empty workspaces; "Unassigned" always last.
    const aOrphan = a.workspace === null;
    const bOrphan = b.workspace === null;
    if (aOrphan !== bOrphan) {
      return aOrphan ? 1 : -1;
    }
    const aLast = lastMessageMs(a.sessions);
    const bLast = lastMessageMs(b.sessions);
    return bLast - aLast;
  });
}

function lastMessageMs(sessions: AgentSession[]): number {
  let max = 0;
  for (const s of sessions) {
    const t = s.lastMessageAt ?? s.updatedAt;
    if (!t) {
      continue;
    }
    const ms = new Date(t).getTime();
    if (ms > max) {
      max = ms;
    }
  }
  return max;
}

export function SessionsSidebar({
  basePath,
  sessions,
  workspaces,
  isLoading,
  activeSessionId,
  onNewWorkspace,
  onNewChat,
}: SessionsSidebarProps): React.ReactElement {
  const groups = React.useMemo(
    () =>
      groupSessions(
        sessions.filter((s) => s.status === 'active'),
        workspaces,
      ),
    [sessions, workspaces],
  );

  return (
    <aside
      className="w-72 shrink-0 flex flex-col h-full min-h-0 border-r border-fl-border bg-fl-card/30"
      data-testid="agents-sessions-sidebar"
    >
      <header className="flex items-center justify-between px-3 py-2.5 border-b border-fl-border">
        <div className="flex items-center gap-2 min-w-0">
          <Server className="size-4 text-fl-primary shrink-0" />
          <span className="text-sm font-semibold truncate">Chats</span>
        </div>
        <button
          type="button"
          onClick={onNewWorkspace}
          title="New workspace"
          aria-label="New workspace"
          className="p-1.5 rounded-md text-fl-muted-foreground hover:bg-fl-accent hover:text-fl-foreground"
          data-testid="agents-new-workspace-button"
        >
          <FolderPlus className="size-3.5" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto py-2">
        {isLoading ? (
          <div className="px-4 py-3 text-xs text-fl-muted-foreground">Loading…</div>
        ) : groups.length === 0 ? (
          <EmptyState onNewWorkspace={onNewWorkspace} />
        ) : (
          <ul className="space-y-1">
            {groups.map((group) => (
              <WorkspaceGroupRow
                key={group.workspace?.id ?? '__none__'}
                group={group}
                basePath={basePath}
                activeSessionId={activeSessionId ?? null}
                onNewChat={onNewChat}
              />
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

function WorkspaceGroupRow({
  group,
  basePath,
  activeSessionId,
  onNewChat,
}: {
  group: WorkspaceGroup;
  basePath: string;
  activeSessionId: string | null;
  onNewChat: (workspaceId: string) => void;
}): React.ReactElement {
  const [open, setOpen] = React.useState(true);
  const headerLabel = group.workspace?.name ?? 'Unassigned';
  const isOrphan = group.workspace === null;

  return (
    <li>
      <div className="group flex items-center gap-1 px-2">
        <button
          type="button"
          onClick={() => setOpen((s) => !s)}
          className="flex items-center gap-1 min-w-0 flex-1 px-1 py-1 text-xs font-medium uppercase tracking-wide text-fl-muted-foreground hover:text-fl-foreground"
          aria-expanded={open}
          data-testid={`agents-workspace-toggle-${group.workspace?.id ?? 'orphan'}`}
        >
          {open ? (
            <ChevronDown className="size-3 shrink-0" />
          ) : (
            <ChevronRight className="size-3 shrink-0" />
          )}
          <span className="truncate">{headerLabel}</span>
          <span className="text-fl-muted-foreground/70 ml-1">{group.sessions.length}</span>
        </button>
        {!isOrphan && group.workspace ? (
          <button
            type="button"
            onClick={() => onNewChat(group.workspace?.id ?? '')}
            title="New chat in this workspace"
            aria-label={`New chat in ${headerLabel}`}
            className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1 rounded text-fl-muted-foreground hover:bg-fl-accent hover:text-fl-foreground"
            data-testid={`agents-new-chat-button-${group.workspace.id}`}
          >
            <MessageSquarePlus className="size-3.5" />
          </button>
        ) : null}
      </div>
      {open ? (
        <ul className="mt-0.5 mb-1">
          {group.sessions.length === 0 ? (
            <li className="px-7 py-1.5 text-xs text-fl-muted-foreground">No chats yet.</li>
          ) : (
            group.sessions.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                basePath={basePath}
                isActive={session.id === activeSessionId}
              />
            ))
          )}
        </ul>
      ) : null}
    </li>
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
  return (
    <li
      className={`group flex items-stretch gap-1 px-2 ${
        isActive ? 'bg-fl-accent text-fl-accent-foreground' : 'hover:bg-fl-muted/40'
      } rounded-r-md`}
    >
      <Link
        to={`${stripTrailingSlash(basePath)}/agents/sessions/${encodeURIComponent(session.id)}`}
        className={`min-w-0 flex-1 py-1.5 pl-5 text-sm border-l-2 ${
          isActive ? 'border-fl-primary' : 'border-transparent text-fl-foreground'
        }`}
        data-testid={`agents-session-row-${session.id}`}
      >
        <div className="truncate">{session.title}</div>
        <div className="text-xs text-fl-muted-foreground truncate">
          {session.providerId}
          {session.model ? ` · ${session.model}` : ''}
          {session.messageCount > 0 ? ` · ${session.messageCount}` : ''}
        </div>
      </Link>
      <SessionRowActions sessionId={session.id} sessionTitle={session.title ?? ''} />
    </li>
  );
}

function SessionRowActions({
  sessionId,
  sessionTitle,
}: {
  sessionId: string;
  sessionTitle: string;
}): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const deleteSession = useDeleteSession();

  React.useEffect(() => {
    if (!open) {
      return;
    }
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const handleDelete = () => {
    if (deleteSession.isPending) {
      return;
    }
    const ok = window.confirm(
      `Delete "${sessionTitle || 'this chat'}"? Messages are archived; the session row is removed from the list.`,
    );
    if (!ok) {
      return;
    }
    deleteSession.mutate({ id: sessionId });
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative flex items-center">
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((s) => !s);
        }}
        className="opacity-0 group-hover:opacity-100 focus:opacity-100 size-6 inline-flex items-center justify-center rounded text-fl-muted-foreground hover:bg-fl-muted hover:text-fl-foreground"
        title="More actions"
        aria-label="More actions"
        data-testid={`agents-session-actions-${sessionId}`}
      >
        <MoreHorizontal className="size-3.5" />
      </button>
      {open ? (
        <div
          className="absolute right-0 top-full z-30 mt-1 min-w-[140px] rounded-md border border-fl-border bg-fl-card text-fl-card-foreground shadow-lg py-1"
          role="menu"
        >
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleteSession.isPending}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-fl-destructive hover:bg-fl-muted/40 disabled:opacity-50"
            role="menuitem"
            data-testid={`agents-session-delete-${sessionId}`}
          >
            <Trash2 className="size-3" />
            {deleteSession.isPending ? 'Deleting…' : 'Delete chat'}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function EmptyState({ onNewWorkspace }: { onNewWorkspace: () => void }): React.ReactElement {
  return (
    <div className="px-4 py-6 text-center">
      <p className="text-sm text-fl-muted-foreground">No chats yet.</p>
      <button
        type="button"
        onClick={onNewWorkspace}
        className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-fl-primary px-3 py-1.5 text-xs font-medium text-fl-primary-foreground hover:opacity-90"
      >
        <FolderPlus className="size-3.5" />
        Start a chat
      </button>
    </div>
  );
}

function stripTrailingSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}
