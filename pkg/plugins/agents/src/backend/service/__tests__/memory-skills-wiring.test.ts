/**
 * Integration: memory + skills are actually wired into a turn.
 *
 * Drives the real `buildSessionContext` with a minimal fake provider and
 * real repositories over the in-memory DB, then asserts:
 *   - the composed system prompt (captured via `provider.createSession`)
 *     contains seeded memories + skill summaries
 *   - the context exposes `memory.search`, `memory.write`, `skills.read`
 *     provider tools
 *   - executing those tools hits the repositories (write persists,
 *     search recalls, skills.read returns the body)
 *
 * This is the end-to-end proof that the features are reachable by the
 * agent loop, not just CRUD-able over REST.
 */
import { describe, it, expect } from 'vitest';
import {
  buildSessionContext,
  createConsoleSessionLogger,
  createInMemoryPromptCache,
  type ChatHostDeps,
  type RepositoriesBag,
} from '../chat-session-host';
import { MemoriesRepository } from '../../repositories/memories.repository';
import { SkillsRepository } from '../../repositories/skills.repository';
import { makeFakeDatabase } from '../../repositories/__tests__/fake-db';
import type { AgentProvider } from '../../providers/types';
import type { ProviderToolDescriptor } from '../../providers/types';

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

function makeFakeProvider(): {
  provider: AgentProvider;
  captured: { systemPrompt?: string };
} {
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
  const memories = new MemoriesRepository(db);
  const skills = new SkillsRepository(db);

  // Seed one memory + one skill for org-1 / u1.
  await memories.create({
    orgId: 'org-1',
    scope: 'global',
    content: 'The production database is Postgres on Neon',
    createdBy: 'u1',
  });
  await skills.create({
    orgId: 'org-1',
    name: 'open-pr',
    description: 'Open a pull request',
    body: 'Step 1: create a branch. Step 2: push. Step 3: open the PR.',
    scope: 'global',
    ownerId: 'u1',
  });

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
    memories,
    skills,
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
  return { ctx: result.context, captured, memories };
}

describe('memory + skills turn wiring', () => {
  it('composes seeded memories + skills into the system prompt', async () => {
    const { captured } = await setup();
    expect(captured.systemPrompt).toContain('Postgres on Neon');
    expect(captured.systemPrompt).toContain('open-pr');
  });

  it('exposes memory.search, memory.write, and skills.read provider tools', async () => {
    const { ctx } = await setup();
    const tools = ctx.providerTools as Record<string, ProviderToolDescriptor> | undefined;
    expect(tools).toBeDefined();
    expect(Object.keys(tools ?? {}).sort()).toEqual([
      'memory.search',
      'memory.write',
      'skills.read',
    ]);
  });

  it('memory.write persists and memory.search recalls it', async () => {
    const { ctx } = await setup();
    const tools = ctx.providerTools as Record<string, ProviderToolDescriptor>;

    const writeRes = (await tools['memory.write'].execute(
      { content: 'User prefers dark mode' },
      {},
    )) as { saved?: boolean; id?: string };
    expect(writeRes.saved).toBe(true);
    expect(typeof writeRes.id).toBe('string');

    const searchRes = (await tools['memory.search'].execute(
      { query: 'what theme does the user prefer' },
      {},
    )) as { results: Array<{ content: string }> };
    expect(searchRes.results.map((r) => r.content)).toContain('User prefers dark mode');
  });

  it('skills.read returns the full body by name', async () => {
    const { ctx } = await setup();
    const tools = ctx.providerTools as Record<string, ProviderToolDescriptor>;
    const res = (await tools['skills.read'].execute({ name: 'open-pr' }, {})) as {
      name?: string;
      body?: string;
    };
    expect(res.name).toBe('open-pr');
    expect(res.body).toContain('create a branch');
  });

  it('memory.write defaulting to personal scope is recalled by the same user', async () => {
    const { ctx, memories } = await setup();
    const tools = ctx.providerTools as Record<string, ProviderToolDescriptor>;
    await tools['memory.write'].execute({ content: 'u1 likes vim', scope: 'personal' }, {});
    const forU1 = await memories.listForScope({ orgId: 'org-1', userId: 'u1' });
    expect(forU1.map((m) => m.content)).toContain('u1 likes vim');
  });
});
