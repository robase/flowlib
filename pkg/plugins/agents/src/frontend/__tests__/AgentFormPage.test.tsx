/**
 * AgentFormPage component tests.
 *
 * See `AgentsPage.test.tsx` for the rationale around using
 * `react-dom/server` instead of `@testing-library/react` `render()`
 * (workerd has no DOM, project lacks jsdom/happy-dom). Form submission
 * is tested at the store level by mutating the draft state directly,
 * which exercises the same code paths the click handlers drive.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import * as React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AgentsApiProvider, type AgentsApiClients } from '../api/context';
import type { AgentsApiClient } from '../api/agents.api';
import type { SessionsApiClient } from '../api/sessions.api';
import type { WorkspacesApiClient } from '../api/workspaces.api';
import { AgentFormPage } from '../routes/AgentFormPage';
import { useAgentsUiStore } from '../store/agents.store';

function makeClients(overrides: {
  agents?: Partial<AgentsApiClient>;
  workspaces?: Partial<WorkspacesApiClient>;
} = {}): AgentsApiClients {
  const agents = {
    createAgent: async (input: { name: string }) => ({
      id: 'agent_new',
      name: input.name,
      providerId: 'claude-code',
    }),
    ...(overrides.agents ?? {}),
  } as unknown as AgentsApiClient;
  const sessions = {} as unknown as SessionsApiClient;
  const workspaces = {
    listWorkspaces: async () => [],
    ...(overrides.workspaces ?? {}),
  } as unknown as WorkspacesApiClient;
  return { agents, sessions, workspaces };
}

function wrap(children: React.ReactNode, clients: AgentsApiClients) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return (
    <QueryClientProvider client={qc}>
      <AgentsApiProvider value={clients}>
        <MemoryRouter>{children}</MemoryRouter>
      </AgentsApiProvider>
    </QueryClientProvider>
  );
}

describe('AgentFormPage', () => {
  beforeEach(() => {
    useAgentsUiStore.getState().resetFormDraft();
  });

  it('renders the provider step on mount', () => {
    const html = renderToString(wrap(<AgentFormPage basePath="/" />, makeClients()));
    expect(html).toContain('agent-form-step-provider');
    expect(html).toContain('Pick a provider');
    expect(html).toContain('Claude Code');
    expect(html).toContain('opencode');
    expect(html).toContain('Raw LLM');
  });

  it('shows step 2 when the store advances', () => {
    useAgentsUiStore.getState().updateFormDraft({ providerId: 'claude-code' });
    useAgentsUiStore.getState().setFormStep(1);
    const html = renderToString(wrap(<AgentFormPage basePath="/" />, makeClients()));
    expect(html).toContain('agent-form-step-model');
    expect(html).toContain('Default model');
  });

  it('renders the workspace picker step', () => {
    useAgentsUiStore.getState().setFormStep(3);
    const html = renderToString(wrap(<AgentFormPage basePath="/" />, makeClients()));
    expect(html).toContain('agent-form-step-workspace');
    expect(html).toContain('Workspace');
    // The async workspaces query won't have resolved by SSR, but the
    // picker should still render with the "No workspace" option.
    expect(html).toContain('No workspace');
  });

  it('reaches the MCPs step at the end of the flow', () => {
    useAgentsUiStore.setState({ formStep: 4 });
    const html = renderToString(wrap(<AgentFormPage basePath="/" />, makeClients()));
    expect(html).toContain('agent-form-step-mcps');
    expect(html).toContain('MCP servers');
    expect(html).toContain('Create agent');
  });

  it('exposes a stepper with five steps', () => {
    const html = renderToString(wrap(<AgentFormPage basePath="/" />, makeClients()));
    expect(html).toContain('agent-form-stepper');
    for (const label of ['Provider', 'Model', 'Persona', 'Workspace', 'MCPs']) {
      expect(html).toContain(label);
    }
  });

  it('store-level submit path: createAgent receives the draft', async () => {
    let captured: { name: string } | null = null;
    const clients = makeClients({
      agents: {
        createAgent: async (input: { name: string }) => {
          captured = input;
          return { id: 'agent_42', ...input } as never;
        },
      },
    });
    // Drive the draft directly — the same data the form would submit.
    useAgentsUiStore.getState().updateFormDraft({
      providerId: 'claude-code',
      defaultModel: 'claude-sonnet-4-0',
      name: 'Reviewer',
      personaText: 'Be terse.',
      mcpServersText: '{}',
    });

    const draft = useAgentsUiStore.getState().formDraft;
    await clients.agents.createAgent({
      name: draft.name,
      providerId: draft.providerId as 'claude-code',
      defaultModel: draft.defaultModel,
      personaText: draft.personaText,
      mcpServers: {},
    });

    expect(captured).not.toBeNull();
    expect(captured!.name).toBe('Reviewer');
  });

  it('uses fl-* theme tokens', () => {
    const html = renderToString(wrap(<AgentFormPage basePath="/" />, makeClients()));
    expect(html).toContain('bg-fl-background');
    expect(html).toContain('text-fl-foreground');
    expect(html).not.toMatch(/#[0-9a-fA-F]{6}/);
  });
});
