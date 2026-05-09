/**
 * AgentDetailPage component tests.
 *
 * See `AgentsPage.test.tsx` for the rationale around using
 * `react-dom/server`. The detail page reads `agentId` from the route
 * params, so each test renders inside a `MemoryRouter` configured with
 * the right path.
 */

import { describe, expect, it } from 'vitest';
import * as React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AgentDefinition, AgentSession } from '../../shared/types';
import { AgentsApiProvider, type AgentsApiClients } from '../api/context';
import type { AgentsApiClient } from '../api/agents.api';
import type { SessionsApiClient } from '../api/sessions.api';
import type { WorkspacesApiClient } from '../api/workspaces.api';
import { AgentDetailPage } from '../routes/AgentDetailPage';

const baseAgent: AgentDefinition = {
  id: 'agent_42',
  orgId: null,
  name: 'My reviewer',
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

function makeClients(opts: {
  agent?: AgentDefinition | null;
  sessions?: AgentSession[];
  agentError?: Error;
  sessionsError?: Error;
} = {}): AgentsApiClients {
  const agents = {
    getAgent: async () => {
      if (opts.agentError) throw opts.agentError;
      if (opts.agent === null) throw new Error('not found');
      return opts.agent ?? baseAgent;
    },
    deleteAgent: async () => undefined,
  } as unknown as AgentsApiClient;
  const sessions = {
    listSessionsForAgent: async () => {
      if (opts.sessionsError) throw opts.sessionsError;
      return opts.sessions ?? [];
    },
  } as unknown as SessionsApiClient;
  const workspaces = {} as unknown as WorkspacesApiClient;
  return { agents, sessions, workspaces };
}

function wrap(clients: AgentsApiClients, basePath = '/', initialPath = '/agents/agent_42') {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return (
    <QueryClientProvider client={qc}>
      <AgentsApiProvider value={clients}>
        <MemoryRouter initialEntries={[initialPath]}>
          <Routes>
            <Route
              path="/agents/:agentId"
              element={<AgentDetailPage basePath={basePath} />}
            />
          </Routes>
        </MemoryRouter>
      </AgentsApiProvider>
    </QueryClientProvider>
  );
}

describe('AgentDetailPage', () => {
  it('renders a loading state before the agent resolves', () => {
    const clients = makeClients({});
    const html = renderToString(wrap(clients));
    // The first paint is `isLoading` because react-query hasn't run.
    expect(html).toContain('agent-detail-loading');
  });

  it('uses fl-* theme tokens in loading state', () => {
    const html = renderToString(wrap(makeClients({})));
    expect(html).toContain('text-fl-muted-foreground');
    expect(html).not.toMatch(/#[0-9a-fA-F]{6}/);
  });

  it('builds the new-chat href against the supplied basePath and agentId', () => {
    // Pre-seed the cache by querying through the wrap helper, then
    // assert the href format the component will produce. We can't
    // wait on react-query in renderToString, so we test the URL helper
    // by stubbing the agent in the cache directly.
    const clients = makeClients({});
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    qc.setQueryData(['agents', 'agents', 'detail', 'agent_42'], baseAgent);
    qc.setQueryData(['agents', 'sessions', 'agent', 'agent_42'], []);

    const html = renderToString(
      <QueryClientProvider client={qc}>
        <AgentsApiProvider value={clients}>
          <MemoryRouter initialEntries={['/agents/agent_42']}>
            <Routes>
              <Route
                path="/agents/:agentId"
                element={<AgentDetailPage basePath="/flowlib" />}
              />
            </Routes>
          </MemoryRouter>
        </AgentsApiProvider>
      </QueryClientProvider>,
    );

    expect(html).toContain('href="/flowlib/agents/agent_42/sessions/new"');
    expect(html).toContain('agent-detail-page');
    expect(html).toContain('My reviewer');
    expect(html).toContain('claude-code');
  });

  it('renders the empty sessions state', () => {
    const clients = makeClients({});
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    qc.setQueryData(['agents', 'agents', 'detail', 'agent_42'], baseAgent);
    qc.setQueryData(['agents', 'sessions', 'agent', 'agent_42'], []);

    const html = renderToString(
      <QueryClientProvider client={qc}>
        <AgentsApiProvider value={clients}>
          <MemoryRouter initialEntries={['/agents/agent_42']}>
            <Routes>
              <Route
                path="/agents/:agentId"
                element={<AgentDetailPage basePath="/" />}
              />
            </Routes>
          </MemoryRouter>
        </AgentsApiProvider>
      </QueryClientProvider>,
    );

    expect(html).toContain('agent-detail-sessions-empty');
    expect(html).toContain('No sessions yet');
    expect(html).toContain('Start a chat');
  });

  it('renders the populated sessions list', () => {
    const session: AgentSession = {
      id: 'sess_1',
      orgId: null,
      agentId: 'agent_42',
      providerSessionId: 'ps_1',
      title: 'Session about refactoring',
      model: 'claude-sonnet-4-0',
      permissionMode: null,
      workspaceId: null,
      enabledTools: null,
      extraDenied: null,
      createdBy: 'u1',
      visibility: 'private',
      status: 'active',
      lastMessageAt: '2026-01-02T00:00:00Z',
      messageCount: 12,
      inputTokensTotal: 1000,
      outputTokensTotal: 500,
      costUsd: '0.05',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-02T00:00:00Z',
    };
    const clients = makeClients({});
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    qc.setQueryData(['agents', 'agents', 'detail', 'agent_42'], baseAgent);
    qc.setQueryData(['agents', 'sessions', 'agent', 'agent_42'], [session]);

    const html = renderToString(
      <QueryClientProvider client={qc}>
        <AgentsApiProvider value={clients}>
          <MemoryRouter initialEntries={['/agents/agent_42']}>
            <Routes>
              <Route
                path="/agents/:agentId"
                element={<AgentDetailPage basePath="/" />}
              />
            </Routes>
          </MemoryRouter>
        </AgentsApiProvider>
      </QueryClientProvider>,
    );

    expect(html).toContain('agent-detail-sessions-list');
    expect(html).toContain('Session about refactoring');
    // React inserts SSR comment markers between adjacent text nodes
    // (`12<!-- --> messages`) so we match around that boundary.
    expect(html).toMatch(/12.*?messages/);
    expect(html).toContain(`agent-detail-session-sess_1`);
    expect(html).toMatch(/href="\/?agents\/agent_42\/sessions\/sess_1"/);
  });
});
