/**
 * AgentsPage — landing route at `/agents`.
 *
 * Shows the agent catalogue as a card grid. Empty state surfaces a
 * "Create your first agent" CTA. Stream M will deep-link from agent
 * cards into the chat surface.
 *
 * **CSS**: uses only `fl-*` theme tokens from `@flowlib/ui/styles`.
 * No `@flowlib/ui` runtime imports — keeps this layer decoupled from
 * the host UI package.
 */

import * as React from 'react';
import { Link } from 'react-router';
import type { AgentDefinition } from '../../shared/types';
import { useAgents } from '../hooks/useAgents';
import { useAgentsUiStore } from '../store/agents.store';

export interface AgentsPageProps {
  basePath: string;
}

export function AgentsPage({ basePath }: AgentsPageProps): React.ReactElement {
  const { data: agents, isLoading, error } = useAgents();
  const searchQuery = useAgentsUiStore((s) => s.searchQuery);
  const providerFilter = useAgentsUiStore((s) => s.providerFilter);
  const setSearchQuery = useAgentsUiStore((s) => s.setSearchQuery);
  const setProviderFilter = useAgentsUiStore((s) => s.setProviderFilter);

  const filtered = React.useMemo(() => {
    if (!agents) return [];
    return agents.filter((a) => {
      if (providerFilter !== 'all' && a.providerId !== providerFilter) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (
          !a.name.toLowerCase().includes(q) &&
          !(a.description ?? '').toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [agents, searchQuery, providerFilter]);

  const newAgentHref = `${stripTrailingSlash(basePath)}/agents/new`;

  return (
    <div
      className="fl-page w-full h-full min-h-0 overflow-y-auto bg-fl-background text-fl-foreground"
      data-testid="agents-page"
    >
      <header className="border-b border-fl-border px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Agents</h1>
          <p className="text-sm text-fl-muted-foreground mt-1">
            Configure code-editing AI agents and start chat sessions.
          </p>
        </div>
        <Link
          to={newAgentHref}
          className="inline-flex items-center rounded-md bg-fl-primary px-4 py-2 text-sm font-medium text-fl-primary-foreground hover:opacity-90"
          data-testid="agents-new-button"
        >
          New agent
        </Link>
      </header>

      <div className="px-6 py-4 flex flex-wrap gap-3 items-center border-b border-fl-border">
        <input
          type="search"
          placeholder="Search agents…"
          aria-label="Search agents"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="rounded-md border border-fl-border bg-fl-card px-3 py-1.5 text-sm text-fl-foreground placeholder:text-fl-muted-foreground"
          data-testid="agents-search-input"
        />
        <select
          aria-label="Filter by provider"
          value={providerFilter}
          onChange={(e) =>
            setProviderFilter(e.target.value as 'all' | AgentDefinition['providerId'])
          }
          className="rounded-md border border-fl-border bg-fl-card px-3 py-1.5 text-sm text-fl-foreground"
          data-testid="agents-provider-filter"
        >
          <option value="all">All providers</option>
          <option value="claude-code">Claude Code</option>
          <option value="opencode">opencode</option>
          <option value="raw-llm">Raw LLM</option>
        </select>
      </div>

      <div className="px-6 py-6">
        {isLoading ? (
          <LoadingState />
        ) : error ? (
          <ErrorState message={(error as Error).message} />
        ) : !agents || agents.length === 0 ? (
          <EmptyState newAgentHref={newAgentHref} />
        ) : filtered.length === 0 ? (
          <FilteredEmpty />
        ) : (
          <div
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
            data-testid="agents-grid"
          >
            {filtered.map((agent) => (
              <AgentCard key={agent.id} agent={agent} basePath={basePath} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────

interface AgentCardProps {
  agent: AgentDefinition;
  basePath: string;
}

function AgentCard({ agent, basePath }: AgentCardProps): React.ReactElement {
  const href = `${stripTrailingSlash(basePath)}/agents/${encodeURIComponent(agent.id)}`;
  return (
    <Link
      to={href}
      className="block rounded-lg border border-fl-border bg-fl-card p-4 hover:border-fl-primary transition-colors"
      data-testid={`agent-card-${agent.id}`}
    >
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-base font-semibold text-fl-foreground line-clamp-1">
          {agent.name}
        </h2>
        <span className="rounded-full bg-fl-muted px-2 py-0.5 text-xs text-fl-muted-foreground whitespace-nowrap">
          {agent.providerId}
        </span>
      </div>
      {agent.description && (
        <p className="text-sm text-fl-muted-foreground mt-2 line-clamp-2">
          {agent.description}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
        {agent.defaultModel && (
          <span className="rounded bg-fl-muted px-2 py-0.5 text-fl-muted-foreground">
            {agent.defaultModel}
          </span>
        )}
        <span className="rounded bg-fl-muted px-2 py-0.5 text-fl-muted-foreground">
          {agent.visibility}
        </span>
      </div>
    </Link>
  );
}

function EmptyState({ newAgentHref }: { newAgentHref: string }): React.ReactElement {
  return (
    <div
      className="flex flex-col items-center justify-center py-16 text-center"
      data-testid="agents-empty-state"
    >
      <div className="rounded-full bg-fl-muted p-4 mb-4">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="32"
          height="32"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="text-fl-muted-foreground"
          aria-hidden="true"
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </div>
      <h2 className="text-lg font-semibold text-fl-foreground">No agents yet</h2>
      <p className="text-sm text-fl-muted-foreground mt-1 max-w-sm">
        Agents are configured AI assistants that can read, edit, and run code. Start by
        creating your first one.
      </p>
      <Link
        to={newAgentHref}
        className="mt-6 inline-flex items-center rounded-md bg-fl-primary px-4 py-2 text-sm font-medium text-fl-primary-foreground hover:opacity-90"
        data-testid="agents-empty-cta"
      >
        Create your first agent
      </Link>
    </div>
  );
}

function FilteredEmpty(): React.ReactElement {
  return (
    <div className="py-12 text-center" data-testid="agents-filtered-empty">
      <p className="text-sm text-fl-muted-foreground">
        No agents match the current filters.
      </p>
    </div>
  );
}

function LoadingState(): React.ReactElement {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="agents-loading">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="rounded-lg border border-fl-border bg-fl-card p-4 animate-pulse h-28"
        />
      ))}
    </div>
  );
}

function ErrorState({ message }: { message: string }): React.ReactElement {
  return (
    <div
      className="rounded-md border border-fl-destructive/40 bg-fl-destructive/10 p-4 text-sm text-fl-destructive"
      data-testid="agents-error"
    >
      Failed to load agents: {message}
    </div>
  );
}

function stripTrailingSlash(p: string): string {
  return !p || p === '/' ? '' : p.replace(/\/$/, '');
}

export default AgentsPage;
