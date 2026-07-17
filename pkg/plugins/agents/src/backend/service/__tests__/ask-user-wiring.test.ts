/**
 * Integration: `ask_user` is wired into a turn and blocks on the decision
 * gate until the transport resolves the human-input request.
 */
import { describe, it, expect } from 'vitest';
import {
  buildSessionContext,
  createConsoleSessionLogger,
  createDecisionGate,
  createInMemoryPromptCache,
  type ChatHostDeps,
  type RepositoriesBag,
} from '../chat-session-host';
import type { AgentEvent } from '../../../shared/events';
import type { AgentProvider, ProviderToolDescriptor } from '../../providers/types';

const CAPABILITIES = {
  streaming: true,
  toolUse: true,
  mcpServers: false,
  parallelToolCalls: true,
  fileEdits: false,
  resumableStream: false,
  workspaceRequired: false,
  permissionPrompts: true,
} as AgentProvider['capabilities'];

function fakeProvider(): AgentProvider {
  return {
    id: 'test',
    name: 'Test',
    capabilities: CAPABILITIES,
    validateConfig: (c: unknown) => c as Record<string, unknown>,
    async createSession() {
      return { providerSessionId: 'ps-1' };
    },
    // eslint-disable-next-line require-yield
    async *prompt() {
      return;
    },
  } as unknown as AgentProvider;
}

async function setup(withGate: boolean) {
  const events: AgentEvent[] = [];
  const gate = createDecisionGate();
  const sessionRow = {
    providerId: 'test',
    providerSessionId: 'ps-1',
    orgId: 'org-1',
    model: 'anthropic/claude-sonnet-4-5',
    systemPrompt: null,
    denyList: null,
    enabledTools: null,
    credentialId: null,
    workspaceId: undefined,
  };
  const repositories = {
    sessions: { findById: async () => sessionRow },
    messages: { append: async () => {} },
  } as unknown as RepositoriesBag;

  const deps: ChatHostDeps = {
    sessionId: 's1',
    orgId: 'org-1',
    auth: { userId: 'u1', orgId: 'org-1', role: 'user' } as ChatHostDeps['auth'],
    providers: new Map([['test', fakeProvider()]]),
    repositories,
    emit: (e) => {
      events.push(e);
    },
    logger: createConsoleSessionLogger('[test]'),
    abortSignal: new AbortController().signal,
    promptCache: createInMemoryPromptCache(),
    ...(withGate ? { decisionGate: gate } : {}),
  };

  const result = await buildSessionContext(deps);
  if ('error' in result) {
    throw new Error(`buildSessionContext failed: ${result.error.message}`);
  }
  return { ctx: result.context, events, gate };
}

describe('ask_user turn wiring', () => {
  it('is absent when no decision gate is configured', async () => {
    const { ctx } = await setup(false);
    const tools = (ctx.providerTools ?? {}) as Record<string, ProviderToolDescriptor>;
    expect(Object.keys(tools)).not.toContain('ask_user');
  });

  it('emits a human-input-request and resolves with the user’s answer', async () => {
    const { ctx, events, gate } = await setup(true);
    const tools = ctx.providerTools as Record<string, ProviderToolDescriptor>;
    expect(Object.keys(tools)).toContain('ask_user');

    const pending = tools['ask_user'].execute({ question: 'Deploy to prod?' }, {}) as Promise<{
      answer: unknown;
    }>;

    // Let the emit fire, then act as the transport resolving the request.
    await Promise.resolve();
    const req = events.find((e) => e.type === 'human-input-request') as
      | { id: string; prompt: string }
      | undefined;
    expect(req).toBeDefined();
    expect(req?.prompt).toBe('Deploy to prod?');

    gate.resolveHumanInput(req!.id, 'yes, go ahead');
    const res = await pending;
    expect(res.answer).toBe('yes, go ahead');
  });

  it('rejects an empty question without blocking', async () => {
    const { ctx } = await setup(true);
    const tools = ctx.providerTools as Record<string, ProviderToolDescriptor>;
    const res = (await tools['ask_user'].execute({ question: '   ' }, {})) as { error?: string };
    expect(res.error).toMatch(/required/);
  });
});
