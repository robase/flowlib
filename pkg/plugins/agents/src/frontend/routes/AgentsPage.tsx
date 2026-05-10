/**
 * AgentsPage — landing route at `/agents`.
 *
 * Lists every chat session. Clicking "+ New chat" calls
 * `POST /sessions {}` and navigates straight to the chat — defaults are
 * filled in server-side (claude-code + claude-sonnet-4-5).
 *
 * No wizard. Per-chat config (model, MCPs, system prompt) is on the
 * chat surface itself.
 *
 * **CSS**: uses only `fl-*` theme tokens from `@flowlib/ui/styles`.
 */

import * as React from 'react';
import { Link, useNavigate } from 'react-router';
import type { AgentSession } from '../../shared/types';
import { useSessions, useCreateSession } from '../hooks/useSessions';
import { useLlmCredentials } from '../hooks/useCredentials';
import { NewChatDialog } from '../components/NewChatDialog';

export interface AgentsPageProps {
  basePath: string;
}

export function AgentsPage({ basePath }: AgentsPageProps): React.ReactElement {
  const { data: sessions, isLoading, error } = useSessions();
  const createSession = useCreateSession();
  const navigate = useNavigate();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const credentialsQuery = useLlmCredentials();

  const handleOpenDialog = React.useCallback(() => {
    setDialogOpen(true);
  }, []);

  const handleCancelDialog = React.useCallback(() => {
    if (createSession.isPending) {
      return;
    }
    setDialogOpen(false);
  }, [createSession.isPending]);

  const handleStart = React.useCallback(
    async ({ credentialId }: { credentialId: string | null }) => {
      const session = await createSession.mutateAsync({ credentialId });
      setDialogOpen(false);
      navigate(chatHref(basePath, session.id));
    },
    [basePath, createSession, navigate],
  );

  const visible = React.useMemo(
    () => (sessions ?? []).filter((s) => s.status === 'active'),
    [sessions],
  );

  return (
    <div
      className="fl-page w-full h-full min-h-0 overflow-y-auto bg-fl-background text-fl-foreground"
      data-testid="agents-page"
    >
      <header className="border-b border-fl-border px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Chats</h1>
          <p className="text-sm text-fl-muted-foreground mt-1">
            AI agent chat sessions. Each chat is configurable — pick a model, add MCP servers, set a
            system prompt.
          </p>
        </div>
        <button
          type="button"
          onClick={handleOpenDialog}
          disabled={createSession.isPending}
          className="inline-flex items-center rounded-md bg-fl-primary px-4 py-2 text-sm font-medium text-fl-primary-foreground hover:opacity-90 disabled:opacity-50"
          data-testid="agents-new-chat-button"
        >
          {createSession.isPending ? 'Starting…' : '+ New chat'}
        </button>
      </header>

      <div className="px-6 py-6">
        {isLoading ? (
          <LoadingState />
        ) : error ? (
          <ErrorState message={(error as Error).message} />
        ) : visible.length === 0 ? (
          <EmptyState onNewChat={handleOpenDialog} disabled={createSession.isPending} />
        ) : (
          <ul className="divide-y divide-fl-border" data-testid="sessions-list">
            {visible.map((session) => (
              <SessionRow key={session.id} session={session} basePath={basePath} />
            ))}
          </ul>
        )}
      </div>

      <NewChatDialog
        open={dialogOpen}
        credentials={credentialsQuery.data ?? []}
        isLoading={credentialsQuery.isLoading}
        error={(credentialsQuery.error as Error | null) ?? null}
        isStarting={createSession.isPending}
        onCancel={handleCancelDialog}
        onStart={handleStart}
      />
    </div>
  );
}

function SessionRow({
  session,
  basePath,
}: {
  session: AgentSession;
  basePath: string;
}): React.ReactElement {
  const updated = formatTimestamp(session.lastMessageAt ?? session.updatedAt);
  return (
    <li>
      <Link
        to={chatHref(basePath, session.id)}
        className="flex items-center justify-between gap-4 px-2 py-3 hover:bg-fl-card rounded-md"
        data-testid={`session-row-${session.id}`}
      >
        <div className="min-w-0 flex-1">
          <div className="font-medium truncate">{session.title}</div>
          <div className="text-xs text-fl-muted-foreground">
            {session.providerId}
            {session.model ? ` · ${session.model}` : ''}
            {session.messageCount > 0 ? ` · ${session.messageCount} msgs` : ''}
          </div>
        </div>
        <div className="text-xs text-fl-muted-foreground whitespace-nowrap">{updated}</div>
      </Link>
    </li>
  );
}

function LoadingState(): React.ReactElement {
  return (
    <div className="text-sm text-fl-muted-foreground" data-testid="agents-loading">
      Loading chats…
    </div>
  );
}

function ErrorState({ message }: { message: string }): React.ReactElement {
  return (
    <div className="rounded-md border border-fl-destructive/40 bg-fl-destructive/10 px-4 py-3 text-sm text-fl-destructive">
      Failed to load chats: {message}
    </div>
  );
}

function EmptyState({
  onNewChat,
  disabled,
}: {
  onNewChat: () => void;
  disabled: boolean;
}): React.ReactElement {
  return (
    <div className="rounded-md border border-dashed border-fl-border px-6 py-12 text-center">
      <p className="text-sm text-fl-muted-foreground">No chats yet.</p>
      <button
        type="button"
        onClick={onNewChat}
        disabled={disabled}
        className="mt-4 inline-flex items-center rounded-md bg-fl-primary px-4 py-2 text-sm font-medium text-fl-primary-foreground hover:opacity-90 disabled:opacity-50"
      >
        Start chatting
      </button>
    </div>
  );
}

function chatHref(basePath: string, sessionId: string): string {
  return `${stripTrailingSlash(basePath)}/agents/sessions/${encodeURIComponent(sessionId)}`;
}

function stripTrailingSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    const now = Date.now();
    const diff = now - d.getTime();
    if (diff < 60_000) {
      return 'just now';
    }
    if (diff < 3_600_000) {
      return `${Math.floor(diff / 60_000)}m ago`;
    }
    if (diff < 86_400_000) {
      return `${Math.floor(diff / 3_600_000)}h ago`;
    }
    if (diff < 7 * 86_400_000) {
      return `${Math.floor(diff / 86_400_000)}d ago`;
    }
    return d.toLocaleDateString();
  } catch {
    return iso;
  }
}

export default AgentsPage;
