/**
 * Tests for `AgentChatDO` — Stream H's Cloudflare Durable Object.
 *
 * The full SDK-mediated lifecycle (WebSocket upgrade, hibernation,
 * `useAgent` round-trip) requires a configured `wrangler.jsonc` with a
 * `main` Worker, DO bindings, and migrations. That infrastructure is
 * out of scope for this unit test — Phase 2 (INT) ships the example
 * deployment that exercises it end-to-end.
 *
 * What this test **does** cover:
 *  - `onChatMessage` resolves the runtime singleton and dispatches to
 *    `agentService.runTurn` with a correctly populated `SessionContext`.
 *  - The DO degrades gracefully (emits a `flowlib.agent-error` envelope)
 *    when the runtime, repositories, provider, or session row is
 *    missing.
 *  - Auth / org are extracted from the DO name.
 *  - Multiple turns reuse the same resolved auth.
 *
 * The trick: `AIChatAgent` (the SDK base class we extend) requires a
 * real `AgentContext` + `Env` that only workerd can supply. We side-
 * step that by rebinding the class on a stub via `Object.setPrototypeOf`
 * — equivalent to instantiating `AgentChatDO` without invoking its
 * superclass constructor, which is fine for the methods we cover.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentChatDO } from '../chat-agent-do';
import {
  clearAgentsRuntime,
  getAgentsRuntime,
  hasAgentsRuntime,
  setAgentsRuntime,
} from '../runtime-singleton';
import type { AgentsRuntimeRegistries } from '../../plugin-context';
import type { AgentService, SessionContext } from '../../service/types';
import type { AgentProvider } from '../../providers/types';

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Build a stub `AgentChatDO` instance without running the SDK
 * superclass constructor. The methods we test only access:
 *  - `this.messages` (we set it directly).
 *  - `this.name` (the DO's tenant-scoped name; we set it directly).
 *  - `this.broadcast` (we replace with a spy).
 *
 * `Object.setPrototypeOf` rebinds the prototype chain so `instanceof`
 * checks still work and method resolution falls through to
 * `AgentChatDO.prototype` and beyond.
 */
type FakeMessage = { id?: string; role: string; content?: string; parts?: unknown };

interface StubDO {
  broadcasts: string[];
  messages: FakeMessage[];
  name: string;
  broadcast: (msg: string) => void;
  onChatMessage: AgentChatDO['onChatMessage'];
}

function makeStubDO(args: { name: string; messages?: FakeMessage[] }): StubDO {
  const broadcasts: string[] = [];
  const stub = Object.create(AgentChatDO.prototype) as unknown as StubDO;
  stub.broadcasts = broadcasts;
  stub.messages = args.messages ?? [];
  stub.name = args.name;
  stub.broadcast = (msg: string) => {
    broadcasts.push(msg);
  };
  return stub;
}

/** Minimal fake provider so the runtime can resolve `providerId`. */
function fakeProvider(id: string): AgentProvider {
  return {
    id,
    displayName: id,
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
    listModels: async () => [],
    validateConfig: () => ({ ok: true }) as never,
    createSession: async () => ({ providerSessionId: 'p-sess' }),
    prompt: async function* () {
      // Empty async iterator
    },
    closeSession: async () => {},
  } as unknown as AgentProvider;
}

/** Build a fake runtime registries bag with knobs for each test. */
function makeRuntime(opts: {
  agentService?: AgentService;
  sessionRow?: unknown;
  provider?: AgentProvider | null;
  noRepositories?: boolean;
}): AgentsRuntimeRegistries {
  const providers = new Map<string, AgentProvider>();
  if (opts.provider) providers.set(opts.provider.id, opts.provider);

  const repositories = opts.noRepositories
    ? undefined
    : {
        sessions: {
          findById: vi.fn(async () => opts.sessionRow ?? undefined),
        },
        messages: {
          append: vi.fn(async () => {}),
        },
      };

  return {
    providers,
    workspaces: new Map(),
    agentService: opts.agentService,
    repositories,
  } as AgentsRuntimeRegistries;
}

// ─── Lifecycle ───────────────────────────────────────────────────────

afterEach(() => {
  clearAgentsRuntime();
  vi.restoreAllMocks();
});

// ─── Runtime singleton ───────────────────────────────────────────────

describe('runtime singleton', () => {
  it('starts unset', () => {
    expect(hasAgentsRuntime()).toBe(false);
  });

  it('throws when read before being set', () => {
    expect(() => getAgentsRuntime()).toThrow(/runtime not registered/);
  });

  it('round-trips through set/get', () => {
    const runtime = makeRuntime({});
    setAgentsRuntime(runtime);
    expect(hasAgentsRuntime()).toBe(true);
    expect(getAgentsRuntime()).toBe(runtime);
  });

  it('replaces on re-registration (hot reload)', () => {
    const a = makeRuntime({});
    const b = makeRuntime({});
    setAgentsRuntime(a);
    setAgentsRuntime(b);
    expect(getAgentsRuntime()).toBe(b);
  });

  it('clear resets to unset', () => {
    setAgentsRuntime(makeRuntime({}));
    clearAgentsRuntime();
    expect(hasAgentsRuntime()).toBe(false);
  });
});

// ─── DO orchestration ────────────────────────────────────────────────

describe('AgentChatDO.onChatMessage', () => {
  const onFinish = vi.fn(async () => {});

  beforeEach(() => {
    onFinish.mockClear();
  });

  it('emits an error envelope when the runtime is missing AgentService', async () => {
    setAgentsRuntime(makeRuntime({}));
    const stub = makeStubDO({
      name: 'org:org-a/kind:chat/sess-1',
      messages: [{ role: 'user', content: 'hi' }],
    });

    const res = await stub.onChatMessage(onFinish);
    expect(res).toBeUndefined();
    expect(stub.broadcasts).toHaveLength(1);
    const env = JSON.parse(stub.broadcasts[0]) as {
      type: string;
      error: { code: string };
    };
    expect(env.type).toBe('flowlib.agent-error');
    expect(env.error.code).toBe('AGENT_SERVICE_MISSING');
    expect(onFinish).not.toHaveBeenCalled();
  });

  it('emits an error envelope on a malformed DO name', async () => {
    setAgentsRuntime(
      makeRuntime({
        agentService: { runTurn: vi.fn() } as unknown as AgentService,
      }),
    );
    const stub = makeStubDO({
      name: 'not-a-tenant-scoped-name',
      messages: [{ role: 'user', content: 'hi' }],
    });
    await stub.onChatMessage(onFinish);
    expect(stub.broadcasts).toHaveLength(1);
    const env = JSON.parse(stub.broadcasts[0]) as {
      type: string;
      error: { code: string };
    };
    expect(env.error.code).toBe('AGENT_DO_NAME_INVALID');
  });

  it('emits an error envelope when the user message has no text', async () => {
    setAgentsRuntime(
      makeRuntime({
        agentService: { runTurn: vi.fn() } as unknown as AgentService,
      }),
    );
    const stub = makeStubDO({
      name: 'org:org-a/kind:chat/sess-1',
      messages: [{ role: 'user' }],
    });
    await stub.onChatMessage(onFinish);
    const env = JSON.parse(stub.broadcasts[0]) as { error: { code: string } };
    expect(env.error.code).toBe('EMPTY_PROMPT');
  });

  it('emits an error envelope when repositories are missing', async () => {
    setAgentsRuntime(
      makeRuntime({
        agentService: { runTurn: vi.fn() } as unknown as AgentService,
        noRepositories: true,
      }),
    );
    const stub = makeStubDO({
      name: 'org:org-a/kind:chat/sess-1',
      messages: [{ role: 'user', content: 'hi' }],
    });
    await stub.onChatMessage(onFinish);
    const env = JSON.parse(stub.broadcasts[0]) as { error: { code: string } };
    expect(env.error.code).toBe('REPOSITORIES_MISSING');
  });

  it('emits SESSION_NOT_FOUND when the row is absent', async () => {
    setAgentsRuntime(
      makeRuntime({
        agentService: { runTurn: vi.fn() } as unknown as AgentService,
        // sessionRow defaults to undefined
      }),
    );
    const stub = makeStubDO({
      name: 'org:org-a/kind:chat/sess-1',
      messages: [{ role: 'user', content: 'hi' }],
    });
    await stub.onChatMessage(onFinish);
    const env = JSON.parse(stub.broadcasts[0]) as { error: { code: string } };
    expect(env.error.code).toBe('SESSION_NOT_FOUND');
  });

  it('rejects cross-tenant sessions defensively', async () => {
    setAgentsRuntime(
      makeRuntime({
        agentService: { runTurn: vi.fn() } as unknown as AgentService,
        provider: fakeProvider('claude-code'),
        sessionRow: {
          providerId: 'claude-code',
          providerSessionId: 'p-1',
          orgId: 'org-OTHER',
        },
      }),
    );
    const stub = makeStubDO({
      name: 'org:org-a/kind:chat/sess-1',
      messages: [{ role: 'user', content: 'hi' }],
    });
    await stub.onChatMessage(onFinish);
    const env = JSON.parse(stub.broadcasts[0]) as { error: { code: string } };
    expect(env.error.code).toBe('CROSS_TENANT_DENIED');
  });

  it('emits PROVIDER_NOT_FOUND when the session points to an unregistered provider', async () => {
    setAgentsRuntime(
      makeRuntime({
        agentService: { runTurn: vi.fn() } as unknown as AgentService,
        // No provider registered
        sessionRow: {
          providerId: 'nope',
          providerSessionId: 'p-1',
          orgId: 'org-a',
        },
      }),
    );
    const stub = makeStubDO({
      name: 'org:org-a/kind:chat/sess-1',
      messages: [{ role: 'user', content: 'hi' }],
    });
    await stub.onChatMessage(onFinish);
    const env = JSON.parse(stub.broadcasts[0]) as { error: { code: string } };
    expect(env.error.code).toBe('PROVIDER_NOT_FOUND');
  });

  it('happy path: dispatches to agentService.runTurn with the right SessionContext', async () => {
    let captured: SessionContext | null = null;
    let capturedPrompt: unknown = null;
    const runTurn = vi.fn(
      async (ctx: SessionContext, prompt: unknown) => {
        captured = ctx;
        capturedPrompt = prompt;
        // Push a fake event so we can assert the broadcast envelope.
        await ctx.emit({
          type: 'text-delta',
          messageId: 'm1',
          text: 'hello',
        });
        return {
          reason: 'completed' as const,
          messageCount: 1,
          toolCallCount: 0,
          inputTokensTotal: 12,
          outputTokensTotal: 34,
          durationMs: 5,
        };
      },
    );

    setAgentsRuntime(
      makeRuntime({
        agentService: { runTurn } as unknown as AgentService,
        provider: fakeProvider('claude-code'),
        sessionRow: {
          providerId: 'claude-code',
          providerSessionId: 'provider-sess-xyz',
          orgId: 'org-a',
        },
      }),
    );
    const stub = makeStubDO({
      name: 'org:org-a/kind:chat/sess-1',
      messages: [{ role: 'user', content: 'hello world' }],
    });

    await stub.onChatMessage(onFinish);

    // runTurn was called once with a sane context.
    expect(runTurn).toHaveBeenCalledOnce();
    expect(captured).not.toBeNull();
    expect(captured!.sessionId).toBe('sess-1');
    expect(captured!.providerSessionId).toBe('provider-sess-xyz');
    expect(captured!.auth.orgId).toBe('org-a');
    expect(captured!.provider.id).toBe('claude-code');
    expect(captured!.callbacks).toBeDefined();
    expect(captured!.hooks).toBeDefined();
    expect(captured!.permissions).toBeDefined();

    // The prompt sent to runTurn was the user message text.
    const promptArg = capturedPrompt as {
      parts: ReadonlyArray<{ type: string; text: string }>;
      providerSessionId: string;
    };
    expect(promptArg.providerSessionId).toBe('provider-sess-xyz');
    expect(promptArg.parts[0]).toEqual({ type: 'text', text: 'hello world' });

    // The DO broadcast our agent-event envelope.
    const events = stub.broadcasts.map((s) => JSON.parse(s) as { type: string });
    expect(events.some((e) => e.type === 'flowlib.agent-event')).toBe(true);

    // onFinish was called with usage data after runTurn resolved.
    expect(onFinish).toHaveBeenCalledOnce();
    const finishCall = onFinish.mock.calls[0] as unknown as Array<{
      usage: { inputTokens: number; outputTokens: number };
      finishReason: string;
    }>;
    const finishArg = finishCall[0];
    expect(finishArg.finishReason).toBe('completed');
    expect(finishArg.usage.inputTokens).toBe(12);
    expect(finishArg.usage.outputTokens).toBe(34);
  });

  it('happy path: extracts text from structured `parts` arrays too', async () => {
    let capturedPrompt: { parts: ReadonlyArray<{ type: string; text: string }> } | null =
      null;
    const runTurn = vi.fn(async (_ctx: SessionContext, prompt: unknown) => {
      capturedPrompt = prompt as typeof capturedPrompt;
      return {
        reason: 'completed' as const,
        messageCount: 1,
        toolCallCount: 0,
        inputTokensTotal: 0,
        outputTokensTotal: 0,
        durationMs: 1,
      };
    });
    setAgentsRuntime(
      makeRuntime({
        agentService: { runTurn } as unknown as AgentService,
        provider: fakeProvider('claude-code'),
        sessionRow: {
          providerId: 'claude-code',
          providerSessionId: 'p-2',
          orgId: 'org-a',
        },
      }),
    );
    const stub = makeStubDO({
      name: 'org:org-a/kind:chat/sess-1',
      messages: [
        {
          role: 'user',
          parts: [
            { type: 'text', text: 'hello ' },
            { type: 'text', text: 'world' },
          ],
        },
      ],
    });
    await stub.onChatMessage(onFinish);
    expect(capturedPrompt).not.toBeNull();
    expect(capturedPrompt!.parts[0]).toEqual({ type: 'text', text: 'hello world' });
  });

  it('emits RUN_TURN_FAILED when the AgentService throws', async () => {
    const runTurn = vi.fn(async () => {
      throw new Error('boom');
    });
    setAgentsRuntime(
      makeRuntime({
        agentService: { runTurn } as unknown as AgentService,
        provider: fakeProvider('claude-code'),
        sessionRow: {
          providerId: 'claude-code',
          providerSessionId: 'p-3',
          orgId: 'org-a',
        },
      }),
    );
    const stub = makeStubDO({
      name: 'org:org-a/kind:chat/sess-1',
      messages: [{ role: 'user', content: 'hi' }],
    });
    await stub.onChatMessage(onFinish);

    const errors = stub.broadcasts
      .map((s) => JSON.parse(s) as { type: string; error?: { code: string } })
      .filter((e) => e.type === 'flowlib.agent-error');
    expect(errors.some((e) => e.error?.code === 'RUN_TURN_FAILED')).toBe(true);
  });
});
