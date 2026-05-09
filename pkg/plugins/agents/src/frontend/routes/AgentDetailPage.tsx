/**
 * AgentDetailPage — `/agents/:agentId`.
 *
 * Surfaces:
 *  - Header with the agent name, provider, default model
 *  - Sessions list (uses `useSessions(agentId)`)
 *  - Settings tabs scaffold (filled in by later phases)
 *
 * **New-chat CTA** links to `/agents/:agentId/sessions/new` — Stream M
 * owns the chat route and will wire the actual session-creation
 * handshake.
 */

import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { AgentSession } from '../../shared/types';
import { useAgent, useDeleteAgent } from '../hooks/useAgents';
import { useSessions } from '../hooks/useSessions';
import { useAgentsUiStore } from '../store/agents.store';

export interface AgentDetailPageProps {
  basePath: string;
}

export function AgentDetailPage({ basePath }: AgentDetailPageProps): React.ReactElement {
  const params = useParams();
  const agentId = params.agentId ?? '';
  const navigate = useNavigate();

  const { data: agent, isLoading, error } = useAgent(agentId);
  const sessionsQuery = useSessions(agentId);
  const deleteAgent = useDeleteAgent();

  const detailTab = useAgentsUiStore((s) => s.detailTab);
  const setDetailTab = useAgentsUiStore((s) => s.setDetailTab);

  const newChatHref = `${stripTrailingSlash(basePath)}/agents/${encodeURIComponent(agentId)}/sessions/new`;

  if (isLoading) {
    return (
      <div className="fl-page p-6 text-fl-muted-foreground" data-testid="agent-detail-loading">
        Loading agent…
      </div>
    );
  }

  if (error || !agent) {
    return (
      <div
        className="fl-page p-6 text-fl-destructive"
        role="alert"
        data-testid="agent-detail-error"
      >
        Failed to load agent: {error instanceof Error ? error.message : 'not found'}
      </div>
    );
  }

  const handleDelete = async () => {
    if (typeof window !== 'undefined') {
      const ok = window.confirm(`Delete agent "${agent.name}"? This cannot be undone.`);
      if (!ok) return;
    }
    try {
      await deleteAgent.mutateAsync(agent.id);
      navigate(`${stripTrailingSlash(basePath)}/agents`);
    } catch {
      // Mutation surfaces error via React Query state; UI ignores here.
    }
  };

  return (
    <div
      className="fl-page w-full h-full min-h-0 overflow-y-auto bg-fl-background text-fl-foreground"
      data-testid="agent-detail-page"
    >
      <header className="border-b border-fl-border px-6 py-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Link
              to={`${stripTrailingSlash(basePath)}/agents`}
              className="text-xs text-fl-muted-foreground hover:text-fl-foreground"
            >
              ← All agents
            </Link>
            <h1 className="text-2xl font-semibold mt-1">{agent.name}</h1>
            <div className="mt-1 flex items-center gap-2 text-sm text-fl-muted-foreground">
              <span>{agent.providerId}</span>
              {agent.defaultModel && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{agent.defaultModel}</span>
                </>
              )}
              <span aria-hidden="true">·</span>
              <span>{agent.visibility}</span>
            </div>
            {agent.description && (
              <p className="mt-2 text-sm text-fl-muted-foreground max-w-2xl">
                {agent.description}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleteAgent.isPending}
              className="rounded-md border border-fl-border px-3 py-2 text-sm text-fl-destructive hover:bg-fl-destructive/10 disabled:opacity-50"
              data-testid="agent-detail-delete"
            >
              Delete
            </button>
            <Link
              to={newChatHref}
              className="rounded-md bg-fl-primary px-4 py-2 text-sm font-medium text-fl-primary-foreground hover:opacity-90"
              data-testid="agent-detail-new-chat"
            >
              New chat
            </Link>
          </div>
        </div>
      </header>

      <nav
        className="px-6 border-b border-fl-border"
        aria-label="Agent detail tabs"
        data-testid="agent-detail-tabs"
      >
        <ul className="flex gap-4 text-sm">
          {(['sessions', 'settings', 'permissions'] as const).map((tab) => (
            <li key={tab}>
              <button
                type="button"
                onClick={() => setDetailTab(tab)}
                aria-current={detailTab === tab ? 'page' : undefined}
                className={`-mb-px border-b-2 py-3 capitalize ${
                  detailTab === tab
                    ? 'border-fl-primary text-fl-foreground font-medium'
                    : 'border-transparent text-fl-muted-foreground hover:text-fl-foreground'
                }`}
                data-testid={`agent-detail-tab-${tab}`}
              >
                {tab}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="px-6 py-6">
        {detailTab === 'sessions' && (
          <SessionsTab
            agentId={agent.id}
            basePath={basePath}
            newChatHref={newChatHref}
            sessions={sessionsQuery.data}
            isLoading={sessionsQuery.isLoading}
            error={sessionsQuery.error}
          />
        )}
        {detailTab === 'settings' && <SettingsTab agentName={agent.name} />}
        {detailTab === 'permissions' && <PermissionsTab />}
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────

interface SessionsTabProps {
  agentId: string;
  basePath: string;
  newChatHref: string;
  sessions: AgentSession[] | undefined;
  isLoading: boolean;
  error: unknown;
}

function SessionsTab({
  basePath,
  newChatHref,
  sessions,
  isLoading,
  error,
}: SessionsTabProps): React.ReactElement {
  if (isLoading) {
    return <div className="text-sm text-fl-muted-foreground">Loading sessions…</div>;
  }
  if (error) {
    return (
      <div className="text-sm text-fl-destructive" role="alert">
        Failed to load sessions:{' '}
        {error instanceof Error ? error.message : String(error)}
      </div>
    );
  }
  if (!sessions || sessions.length === 0) {
    return (
      <div
        className="rounded-lg border border-dashed border-fl-border p-8 text-center"
        data-testid="agent-detail-sessions-empty"
      >
        <h2 className="text-base font-semibold text-fl-foreground">No sessions yet</h2>
        <p className="mt-1 text-sm text-fl-muted-foreground max-w-md mx-auto">
          Start a new chat to begin a session with this agent.
        </p>
        <Link
          to={newChatHref}
          className="mt-4 inline-flex rounded-md bg-fl-primary px-4 py-2 text-sm font-medium text-fl-primary-foreground hover:opacity-90"
        >
          Start a chat
        </Link>
      </div>
    );
  }

  return (
    <ul className="space-y-2" data-testid="agent-detail-sessions-list">
      {sessions.map((session) => {
        const href = `${stripTrailingSlash(basePath)}/agents/${encodeURIComponent(
          session.agentId,
        )}/sessions/${encodeURIComponent(session.id)}`;
        return (
          <li key={session.id}>
            <Link
              to={href}
              className="block rounded-md border border-fl-border bg-fl-card px-4 py-3 hover:border-fl-primary"
              data-testid={`agent-detail-session-${session.id}`}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-fl-foreground line-clamp-1">
                  {session.title || 'Untitled session'}
                </span>
                <span className="text-xs text-fl-muted-foreground whitespace-nowrap">
                  {session.lastMessageAt
                    ? new Date(session.lastMessageAt).toLocaleString()
                    : new Date(session.createdAt).toLocaleString()}
                </span>
              </div>
              <div className="mt-1 flex items-center gap-3 text-xs text-fl-muted-foreground">
                <span>{session.messageCount} messages</span>
                <span>{session.status}</span>
                {session.model && <span>{session.model}</span>}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function SettingsTab({ agentName }: { agentName: string }): React.ReactElement {
  return (
    <div
      className="rounded-md border border-fl-border bg-fl-card p-4 text-sm text-fl-muted-foreground"
      data-testid="agent-detail-settings-tab"
    >
      <p>
        Settings for <span className="font-medium text-fl-foreground">{agentName}</span> —
        the editable form lands in a follow-up. For now, recreate the agent with the
        desired configuration.
      </p>
    </div>
  );
}

function PermissionsTab(): React.ReactElement {
  return (
    <div
      className="rounded-md border border-fl-border bg-fl-card p-4 text-sm text-fl-muted-foreground"
      data-testid="agent-detail-permissions-tab"
    >
      <p>
        Per-role tool permissions are configured globally on the Permissions page (Stream
        J). Per-agent overrides are scheduled for a follow-up.
      </p>
    </div>
  );
}

function stripTrailingSlash(p: string): string {
  return !p || p === '/' ? '' : p.replace(/\/$/, '');
}

export default AgentDetailPage;
