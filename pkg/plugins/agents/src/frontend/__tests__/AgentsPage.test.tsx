/**
 * AgentsPage component tests.
 *
 * **Environment note**: the agents plugin's vitest config uses
 * `@cloudflare/vitest-pool-workers`, which runs tests in workerd. That
 * environment doesn't ship a DOM, and the project doesn't depend on
 * `jsdom` or `happy-dom`, so we can't use `@testing-library/react`'s
 * `render()` directly. Instead, these tests use `react-dom/server`'s
 * `renderToString` (works without a DOM) and seed React Query's cache
 * with `setQueryData` so the component renders against synchronous
 * snapshot data instead of the loading state.
 *
 * The default `pnpm --filter @flowlib/agents test` glob is `*.test.ts`
 * (not `.tsx`), so this file is **not** picked up by the workers pool.
 * Run via the dedicated frontend config:
 *
 *   pnpm --filter @flowlib/agents exec vitest run -c vitest.frontend.config.ts
 *
 * The frontend config uses `environment: 'node'` and skips the workers
 * pool entirely. When jsdom or happy-dom lands in the workspace, swap
 * it in to unlock interactive RTL `render()` tests.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import * as React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AgentDefinition } from '../../shared/types';
import { AgentsApiProvider, type AgentsApiClients } from '../api/context';
import type { AgentsApiClient } from '../api/agents.api';
import type { SessionsApiClient } from '../api/sessions.api';
import type { WorkspacesApiClient } from '../api/workspaces.api';
import { AgentsPage } from '../routes/AgentsPage';
import { agentsKeys } from '../hooks/useAgents';
import { useAgentsUiStore } from '../store/agents.store';

function makeClients(): AgentsApiClients {
  const agents = {
    listAgents: async () => [],
  } as unknown as AgentsApiClient;
  const sessions = {} as unknown as SessionsApiClient;
  const workspaces = {} as unknown as WorkspacesApiClient;
  return { agents, sessions, workspaces };
}

function makeQc(seed?: { agents?: AgentDefinition[] }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  if (seed?.agents !== undefined) {
    qc.setQueryData(agentsKeys.list(), seed.agents);
  }
  return qc;
}

function wrap(children: React.ReactNode, qc: QueryClient, clients: AgentsApiClients) {
  return (
    <QueryClientProvider client={qc}>
      <AgentsApiProvider value={clients}>
        <MemoryRouter>{children}</MemoryRouter>
      </AgentsApiProvider>
    </QueryClientProvider>
  );
}

const sampleAgent: AgentDefinition = {
  id: 'agent_1',
  orgId: null,
  name: 'Reviewer',
  description: 'Reviews PRs.',
  providerId: 'claude-code',
  providerConfig: {},
  workspaceId: null,
  personaId: null,
  personaText: null,
  defaultModel: 'claude-sonnet-4-0',
  mcpServers: {},
  enabledTools: null,
  denyList: null,
  exposeFlowlibActions: false,
  toolOutputBudget: { lines: 200, bytes: 32_000 },
  createdBy: 'u1',
  visibility: 'private',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};

describe('AgentsPage', () => {
  beforeEach(() => {
    // Store leaks across tests by design (zustand singleton). Reset
    // anything the page reads from it.
    useAgentsUiStore.setState({ searchQuery: '', providerFilter: 'all' });
  });

  it('renders the empty-state CTA when the API returns zero agents', () => {
    const qc = makeQc({ agents: [] });
    const html = renderToString(
      wrap(<AgentsPage basePath="/" />, qc, makeClients()),
    );
    expect(html).toContain('No agents yet');
    expect(html).toContain('Create your first agent');
    expect(html).toContain('agents-empty-state');
    expect(html).toMatch(/href="\/?agents\/new"/);
  });

  it('renders a populated grid with one card per agent', () => {
    const qc = makeQc({ agents: [sampleAgent] });
    const html = renderToString(
      wrap(<AgentsPage basePath="/" />, qc, makeClients()),
    );
    expect(html).toContain('agents-grid');
    expect(html).toContain('agent-card-agent_1');
    expect(html).toContain('Reviewer');
    expect(html).toContain('claude-code');
    expect(html).not.toContain('agents-empty-state');
  });

  it('renders the loading skeleton when the query is in flight', () => {
    // No setQueryData seed — `isLoading` is true on first render.
    const qc = makeQc();
    const html = renderToString(
      wrap(<AgentsPage basePath="/" />, qc, makeClients()),
    );
    expect(html).toContain('agents-loading');
  });

  it('renders the new-agent header CTA at the configured basePath', () => {
    const qc = makeQc({ agents: [] });
    const html = renderToString(
      wrap(<AgentsPage basePath="/flowlib" />, qc, makeClients()),
    );
    expect(html).toContain('href="/flowlib/agents/new"');
    expect(html).toContain('New agent');
  });

  it('renders the search and provider filter controls with proper aria labels', () => {
    const qc = makeQc({ agents: [] });
    const html = renderToString(
      wrap(<AgentsPage basePath="/" />, qc, makeClients()),
    );
    expect(html).toContain('agents-search-input');
    expect(html).toContain('agents-provider-filter');
    expect(html).toContain('aria-label="Search agents"');
    expect(html).toContain('aria-label="Filter by provider"');
  });

  it('uses fl-* theme tokens, no raw hex colors', () => {
    const qc = makeQc({ agents: [] });
    const html = renderToString(
      wrap(<AgentsPage basePath="/" />, qc, makeClients()),
    );
    expect(html).toContain('bg-fl-background');
    expect(html).toContain('text-fl-foreground');
    expect(html).not.toMatch(/#[0-9a-fA-F]{6}/);
  });
});
