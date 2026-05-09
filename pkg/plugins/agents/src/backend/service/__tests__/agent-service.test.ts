/**
 * `AgentService` — class-level smoke tests.
 *
 * The interesting orchestration logic lives in `runTurn` (see
 * `run-turn.test.ts`). These tests cover the thin surface:
 *  - the class implements the `AgentService` contract
 *  - `createAgentService()` returns a usable instance
 *  - `register(ctx)` populates `ctx.registries.agentService`
 */
import { describe, it, expect, vi } from 'vitest';
import { AgentService, createAgentService } from '../agent-service';
import { registerService } from '../register';
import type { PluginContext } from '../../plugin-context';
import type { AgentProvider, PromptInput } from '../../providers/types';
import type { AgentEvent } from '../../../shared/events';
import type { AgentsAuthContext } from '../../../shared/auth-context';
import type { SessionContext } from '../types';
import { noopHookPipeline } from '../../hooks/types';
import { allowAllResolver } from '../../permissions/types';

const auth: AgentsAuthContext = {
  userId: 'u',
  orgId: 'o',
  role: 'user',
  teamIds: [],
};

function trivialProvider(events: AgentEvent[]): AgentProvider {
  return {
    id: 'trivial',
    name: 'Trivial',
    capabilities: {
      streaming: true,
      toolUse: false,
      mcpServers: false,
      parallelToolCalls: false,
      fileEdits: false,
      resumableStream: false,
      workspaceRequired: false,
      permissionPrompts: false,
    },
    validateConfig: (c) => c as Record<string, unknown>,
    async createSession() {
      return { providerSessionId: 'p' };
    },
    async *prompt(): AsyncGenerator<AgentEvent> {
      for (const e of events) {yield e;}
    },
  };
}

function buildSessionCtx(provider: AgentProvider): { ctx: SessionContext; emitted: AgentEvent[]; abort: AbortController } {
  const emitted: AgentEvent[] = [];
  const abort = new AbortController();
  const noop = async () => {};
  const ctx: SessionContext = {
    sessionId: 's',
    providerSessionId: 'p',
    auth,
    provider,
    hooks: noopHookPipeline,
    permissions: allowAllResolver,
    logger: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    },
    callbacks: {
      onMessageStart: noop,
      onTextDelta: noop,
      onToolCall: noop,
      onToolResult: noop,
      onFileEdit: noop,
      onMessageComplete: noop,
      onTurnEnd: noop,
    },
    emit: (e) => {
      emitted.push(e);
    },
    abortSignal: abort.signal,
  };
  return { ctx, emitted, abort };
}

const prompt = (signal: AbortSignal): PromptInput => ({
  providerSessionId: 'p',
  parts: [{ type: 'text', text: 'hi' }],
  abortSignal: signal,
});

describe('AgentService', () => {
  it('is constructable and exposes runTurn', () => {
    const svc = new AgentService();
    expect(svc.runTurn).toBeTypeOf('function');
  });

  it('createAgentService() returns an AgentService instance', () => {
    const svc = createAgentService();
    expect(svc).toBeInstanceOf(AgentService);
  });

  it('runTurn drives the kernel end-to-end', async () => {
    const provider = trivialProvider([
      { type: 'text-delta', messageId: 'm', text: 'hi' },
      { type: 'message-complete', messageId: 'm', usage: { inputTokens: 2, outputTokens: 1 } },
    ]);
    const { ctx, emitted } = buildSessionCtx(provider);
    const svc = createAgentService();

    const result = await svc.runTurn(ctx, prompt(ctx.abortSignal));

    expect(result.reason).toBe('completed');
    expect(result.messageCount).toBe(1);
    expect(result.outputTokensTotal).toBe(1);
    expect(emitted.map((e) => e.type)).toContain('text-delta');
  });
});

describe('registerService', () => {
  it('assigns a fresh AgentService to ctx.registries.agentService', () => {
    const ctx = {
      options: { staticOrgId: 'default-org', orgScope: 'optional' },
      flowlib: {} as unknown,
      actionRegistry: {} as unknown,
      registries: {
        providers: new Map(),
        workspaces: new Map(),
      },
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    } as unknown as PluginContext;

    expect(ctx.registries.agentService).toBeUndefined();
    registerService(ctx);
    expect(ctx.registries.agentService).toBeInstanceOf(AgentService);
  });

  it('is idempotent — re-registering replaces the previous instance', () => {
    const ctx = {
      options: { staticOrgId: 'default-org', orgScope: 'optional' },
      flowlib: {} as unknown,
      actionRegistry: {} as unknown,
      registries: {
        providers: new Map(),
        workspaces: new Map(),
      },
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    } as unknown as PluginContext;

    registerService(ctx);
    const first = ctx.registries.agentService;
    registerService(ctx);
    const second = ctx.registries.agentService;

    expect(first).toBeInstanceOf(AgentService);
    expect(second).toBeInstanceOf(AgentService);
    expect(first).not.toBe(second);
  });
});
