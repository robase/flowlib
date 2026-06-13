/**
 * Integration: the session plan (TodoWrite-style) is wired into a turn.
 *
 * Drives `buildSessionContext` with a real `SessionPlansRepository`, then:
 *   - a pre-seeded plan renders into the system prompt ("## Session plan")
 *   - the context exposes the `update_plan` tool
 *   - executing it persists the new checkpoint list
 */
import { describe, it, expect } from 'vitest';
import {
  buildSessionContext,
  createConsoleSessionLogger,
  createInMemoryPromptCache,
  type ChatHostDeps,
  type RepositoriesBag,
} from '../chat-session-host';
import { SessionPlansRepository } from '../../repositories/session-plans.repository';
import { makeFakeDatabase } from '../../repositories/__tests__/fake-db';
import type { AgentProvider, ProviderToolDescriptor } from '../../providers/types';

const CAPABILITIES = {
  streaming: true,
  toolUse: true,
  mcpServers: false,
  parallelToolCalls: true,
  fileEdits: false,
  resumableStream: false,
  workspaceRequired: false,
  permissionPrompts: false,
} as AgentProvider['capabilities'];

function makeFakeProvider(): { provider: AgentProvider; captured: { systemPrompt?: string } } {
  const captured: { systemPrompt?: string } = {};
  const provider = {
    id: 'test',
    name: 'Test',
    capabilities: CAPABILITIES,
    validateConfig: (c: unknown) => c as Record<string, unknown>,
    async createSession(input: { systemPrompt?: string }) {
      captured.systemPrompt = input.systemPrompt;
      return { providerSessionId: 'ps-1' };
    },
    // eslint-disable-next-line require-yield
    async *prompt() {
      return;
    },
  } as unknown as AgentProvider;
  return { provider, captured };
}

async function setup() {
  const db = makeFakeDatabase('sqlite');
  const sessionPlans = new SessionPlansRepository(db);
  // Seed an existing plan so it renders into the prompt.
  await sessionPlans.upsert('s1', 'org-1', [
    { label: 'Investigate the bug', status: 'done' },
    { label: 'Write the fix', status: 'doing' },
    { label: 'Add a test', status: 'todo' },
  ]);

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
    sessionPlans,
  } as unknown as RepositoriesBag;

  const { provider, captured } = makeFakeProvider();
  const deps: ChatHostDeps = {
    sessionId: 's1',
    orgId: 'org-1',
    auth: { userId: 'u1', orgId: 'org-1', role: 'user' } as ChatHostDeps['auth'],
    providers: new Map([['test', provider]]),
    repositories,
    emit: () => {},
    logger: createConsoleSessionLogger('[test]'),
    abortSignal: new AbortController().signal,
    promptCache: createInMemoryPromptCache(),
  };

  const result = await buildSessionContext(deps);
  if ('error' in result) {
    throw new Error(`buildSessionContext failed: ${result.error.message}`);
  }
  return { ctx: result.context, captured, sessionPlans };
}

describe('session plan turn wiring', () => {
  it('renders the seeded plan into the system prompt', async () => {
    const { captured } = await setup();
    expect(captured.systemPrompt).toContain('## Session plan');
    expect(captured.systemPrompt).toContain('Investigate the bug');
    expect(captured.systemPrompt).toContain('[x]'); // done checkbox
    expect(captured.systemPrompt).toContain('[~]'); // doing checkbox
  });

  it('exposes update_plan and persists a new checklist', async () => {
    const { ctx, sessionPlans } = await setup();
    const tools = ctx.providerTools as Record<string, ProviderToolDescriptor>;
    expect(Object.keys(tools)).toContain('update_plan');

    const res = (await tools['update_plan'].execute(
      {
        checkpoints: [
          { label: 'step one', status: 'done' },
          { label: 'step two', status: 'doing' },
        ],
      },
      {},
    )) as { checkpoints: Array<{ label: string; status: string }> };
    expect(res.checkpoints.map((c) => c.label)).toEqual(['step one', 'step two']);

    // Persisted: re-read replaces the seeded plan.
    const saved = await sessionPlans.get('s1', 'org-1');
    expect(saved?.checkpoints.map((c) => c.label)).toEqual(['step one', 'step two']);
    expect(saved?.checkpoints[1].status).toBe('doing');
  });

  it('drops checkpoints with empty labels', async () => {
    const { ctx, sessionPlans } = await setup();
    const tools = ctx.providerTools as Record<string, ProviderToolDescriptor>;
    await tools['update_plan'].execute({ checkpoints: [{ label: 'keep' }, { label: '' }] }, {});
    const saved = await sessionPlans.get('s1', 'org-1');
    expect(saved?.checkpoints.map((c) => c.label)).toEqual(['keep']);
  });
});
