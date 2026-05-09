/**
 * `runTurn` — the kernel orchestration loop.
 *
 * These tests exercise the loop end-to-end against a mock
 * `AgentProvider` that yields a fixed event sequence. We verify:
 *
 *  - text-delta + message-complete pass-through and trigger the right
 *    persistence callbacks
 *  - tool-call → preToolUse fires → tool-call emitted → tool-result →
 *    postToolUse fires → tool-result emitted (in that order)
 *  - preToolUse `{ continue: false }` synthesises an error tool-result
 *    and suppresses the provider's real one
 *  - preToolUse `{ terminate: true }` ends the loop with reason 'error'
 *  - postToolUse `{ terminate: true }` ends the loop with reason 'error'
 *  - `ctx.abortSignal` aborting mid-stream ends with reason 'stopped'
 *  - provider-emitted `session-end` is honoured + not duplicated
 *  - persistence callback exceptions don't crash the loop
 */
import { describe, it, expect, vi } from 'vitest';
import type { AgentEvent } from '../../../shared/events';
import type { AgentsAuthContext } from '../../../shared/auth-context';
import type { AgentProvider, PromptInput } from '../../providers/types';
import type { HookPipeline } from '../../hooks/types';
import { allowAllResolver } from '../../permissions/types';
import { noopHookPipeline } from '../../hooks/types';

/**
 * Helper that builds a `HookPipeline` from two simple async fns. The
 * pipeline interface is generic over `TInput` / `TOutput` for type
 * safety in production code; tests use `unknown` everywhere and rely
 * on a single cast here to keep call sites tidy.
 */
function makeHooks(
  pre: (ctx: unknown) => Promise<unknown>,
  post: (ctx: unknown) => Promise<unknown>,
): HookPipeline {
  return {
    runPreToolUse: pre as HookPipeline['runPreToolUse'],
    runPostToolUse: post as HookPipeline['runPostToolUse'],
  };
}
import { runTurn } from '../run-turn';
import type {
  PersistenceCallbacks,
  SessionContext,
  SessionLogger,
} from '../types';

// ─── Helpers ──────────────────────────────────────────────────────────

const auth: AgentsAuthContext = {
  userId: 'user-1',
  orgId: 'org-1',
  role: 'user',
  teamIds: [],
};

function makeLogger(): SessionLogger & { entries: Array<{ level: string; msg: string; meta?: unknown }> } {
  const entries: Array<{ level: string; msg: string; meta?: unknown }> = [];
  const log = (level: string) => (msg: string, meta?: Record<string, unknown>) => {
    entries.push({ level, msg, meta });
  };
  return {
    debug: log('debug'),
    info: log('info'),
    warn: log('warn'),
    error: log('error'),
    entries,
  };
}

function makePersistence(): PersistenceCallbacks & { calls: Array<{ name: string; arg: unknown }> } {
  const calls: Array<{ name: string; arg: unknown }> = [];
  const record = <T>(name: keyof PersistenceCallbacks) => async (arg: T) => {
    calls.push({ name, arg });
  };
  return {
    onMessageStart: record('onMessageStart'),
    onTextDelta: record('onTextDelta'),
    onToolCall: record('onToolCall'),
    onToolResult: record('onToolResult'),
    onFileEdit: record('onFileEdit'),
    onMessageComplete: record('onMessageComplete'),
    onTurnEnd: record('onTurnEnd'),
    calls,
  };
}

function makeMockProvider(events: AgentEvent[], opts?: { onPrompt?: (input: PromptInput) => void; throwOnPrompt?: Error }): AgentProvider {
  return {
    id: 'mock',
    name: 'Mock',
    capabilities: {
      streaming: true,
      toolUse: true,
      mcpServers: false,
      parallelToolCalls: false,
      fileEdits: true,
      resumableStream: false,
      workspaceRequired: false,
      permissionPrompts: false,
    },
    validateConfig: (c) => c as Record<string, unknown>,
    async createSession() {
      return { providerSessionId: 'mock-session' };
    },
    prompt(input) {
      opts?.onPrompt?.(input);
      if (opts?.throwOnPrompt) throw opts.throwOnPrompt;
      // Return an async generator that yields the fixed events.
      // Honour the input.abortSignal so abort tests can short-circuit.
      return (async function* () {
        for (const e of events) {
          if (input.abortSignal.aborted) return;
          yield e;
        }
      })();
    },
  };
}

interface BuiltCtx {
  ctx: SessionContext;
  emitted: AgentEvent[];
  persistence: ReturnType<typeof makePersistence>;
  logger: ReturnType<typeof makeLogger>;
  abortController: AbortController;
}

function buildCtx(opts: {
  provider: AgentProvider;
  hooks?: HookPipeline;
}): BuiltCtx {
  const persistence = makePersistence();
  const logger = makeLogger();
  const emitted: AgentEvent[] = [];
  const abortController = new AbortController();

  const ctx: SessionContext = {
    sessionId: 'sess-1',
    providerSessionId: 'mock-session',
    auth,
    provider: opts.provider,
    hooks: opts.hooks ?? noopHookPipeline,
    permissions: allowAllResolver,
    logger,
    callbacks: persistence,
    emit: (e) => {
      emitted.push(e);
    },
    abortSignal: abortController.signal,
  };

  return { ctx, emitted, persistence, logger, abortController };
}

function defaultPrompt(signal: AbortSignal): PromptInput {
  return {
    providerSessionId: 'mock-session',
    parts: [{ type: 'text', text: 'hello' }],
    abortSignal: signal,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────

describe('runTurn — text-delta + message-complete', () => {
  it('passes text-delta and message-complete through emit + persistence', async () => {
    const events: AgentEvent[] = [
      { type: 'text-delta', messageId: 'm1', text: 'Hel' },
      { type: 'text-delta', messageId: 'm1', text: 'lo' },
      {
        type: 'message-complete',
        messageId: 'm1',
        usage: { inputTokens: 10, outputTokens: 4 },
      },
    ];
    const provider = makeMockProvider(events);
    const built = buildCtx({ provider });

    const result = await runTurn(built.ctx, defaultPrompt(built.ctx.abortSignal));

    // Three provider events forwarded + a synthetic session-end.
    expect(built.emitted.map((e) => e.type)).toEqual([
      'text-delta',
      'text-delta',
      'message-complete',
      'session-end',
    ]);

    const callNames = built.persistence.calls.map((c) => c.name);
    expect(callNames).toEqual([
      'onMessageStart', // first text-delta opens the message
      'onTextDelta',
      'onTextDelta',
      'onMessageComplete',
      'onTurnEnd',
    ]);

    expect(result.reason).toBe('completed');
    expect(result.messageCount).toBe(1);
    expect(result.inputTokensTotal).toBe(10);
    expect(result.outputTokensTotal).toBe(4);
    expect(result.error).toBeUndefined();
  });
});

describe('runTurn — tool flow', () => {
  it('fires preToolUse before emit, postToolUse before tool-result emit', async () => {
    const events: AgentEvent[] = [
      { type: 'tool-call', messageId: 'm1', id: 't1', name: 'gmail_send', input: { to: 'a@b.com' } },
      { type: 'tool-result', messageId: 'm1', id: 't1', output: { ok: true } },
    ];
    const provider = makeMockProvider(events);

    const callOrder: string[] = [];
    const preSpy = vi.fn(async () => {
      callOrder.push('pre');
      return { continue: true };
    });
    const postSpy = vi.fn(async () => {
      callOrder.push('post');
      return { continue: true };
    });
    const hooks = makeHooks(preSpy, postSpy);

    const built = buildCtx({ provider, hooks });
    // Patch emit to record the order alongside hook calls.
    const baseEmit = built.ctx.emit;
    built.ctx.emit = (e: AgentEvent) => {
      callOrder.push(`emit:${e.type}`);
      return baseEmit(e);
    };

    await runTurn(built.ctx, defaultPrompt(built.ctx.abortSignal));

    // pre runs before tool-call emit; post runs before tool-result emit.
    expect(callOrder).toEqual([
      'pre',
      'emit:tool-call',
      'post',
      'emit:tool-result',
      'emit:session-end',
    ]);
    expect(preSpy).toHaveBeenCalledTimes(1);
    expect(postSpy).toHaveBeenCalledTimes(1);
  });

  it('preToolUse modifiedInput rewrites tool-call input on emit + persistence', async () => {
    const events: AgentEvent[] = [
      { type: 'tool-call', messageId: 'm1', id: 't1', name: 'tool', input: { secret: 'plain' } },
      { type: 'tool-result', messageId: 'm1', id: 't1', output: 'ok' },
    ];
    const provider = makeMockProvider(events);
    const hooks = makeHooks(
      async () => ({ continue: true, modifiedInput: { secret: 'REDACTED' } }),
      async () => ({ continue: true }),
    );
    const built = buildCtx({ provider, hooks });

    await runTurn(built.ctx, defaultPrompt(built.ctx.abortSignal));

    const toolCallEmit = built.emitted.find((e) => e.type === 'tool-call')! as Extract<AgentEvent, { type: 'tool-call' }>;
    expect(toolCallEmit.input).toEqual({ secret: 'REDACTED' });

    const persistedToolCall = built.persistence.calls.find((c) => c.name === 'onToolCall');
    expect(persistedToolCall?.arg).toMatchObject({ input: { secret: 'REDACTED' } });
  });

  it('preToolUse { continue: false } synthesises error tool-result and suppresses provider result', async () => {
    const events: AgentEvent[] = [
      { type: 'tool-call', messageId: 'm1', id: 't1', name: 'dangerous', input: { cmd: 'rm -rf /' } },
      { type: 'tool-result', messageId: 'm1', id: 't1', output: 'should be suppressed' },
    ];
    const provider = makeMockProvider(events);
    const postSpy = vi.fn(async () => ({ continue: true }));
    const hooks = makeHooks(
      async () => ({ continue: false, reason: 'denied: dangerous' }),
      postSpy,
    );
    const built = buildCtx({ provider, hooks });

    const result = await runTurn(built.ctx, defaultPrompt(built.ctx.abortSignal));

    const toolResultEvents = built.emitted.filter((e) => e.type === 'tool-result') as Array<Extract<AgentEvent, { type: 'tool-result' }>>;
    expect(toolResultEvents).toHaveLength(1);
    expect(toolResultEvents[0].isError).toBe(true);
    expect(toolResultEvents[0].output).toEqual({ error: 'denied: dangerous' });

    // Post-hook MUST NOT fire for the blocked call (provider's
    // real tool-result is suppressed before reaching post).
    expect(postSpy).not.toHaveBeenCalled();

    // Turn still completes — soft block doesn't error the turn.
    expect(result.reason).toBe('completed');
    expect(result.toolCallCount).toBe(1);
  });

  it('preToolUse { terminate: true } ends the loop with reason "error"', async () => {
    const events: AgentEvent[] = [
      { type: 'tool-call', messageId: 'm1', id: 't1', name: 'evil', input: {} },
      // Anything past here should never be processed.
      { type: 'text-delta', messageId: 'm1', text: 'unreachable' },
    ];
    const provider = makeMockProvider(events);
    const hooks = makeHooks(
      async () => ({ terminate: true, reason: 'kill switch' }),
      async () => ({ continue: true }),
    );
    const built = buildCtx({ provider, hooks });

    const result = await runTurn(built.ctx, defaultPrompt(built.ctx.abortSignal));

    expect(result.reason).toBe('error');
    expect(result.error).toBe('kill switch');

    // Last emitted event is session-end with reason 'error'.
    const last = built.emitted[built.emitted.length - 1];
    expect(last).toMatchObject({ type: 'session-end', reason: 'error', error: 'kill switch' });

    // Synthetic tool-result for the killed call was emitted.
    expect(built.emitted.some((e) => e.type === 'tool-result')).toBe(true);

    // The unreachable text-delta never fired.
    expect(built.emitted.some((e) => e.type === 'text-delta')).toBe(false);
  });

  it('postToolUse { terminate: true } ends the loop with reason "error" after emitting result', async () => {
    const events: AgentEvent[] = [
      { type: 'tool-call', messageId: 'm1', id: 't1', name: 'tool', input: {} },
      { type: 'tool-result', messageId: 'm1', id: 't1', output: 'sensitive' },
      // Should not be reached.
      { type: 'text-delta', messageId: 'm1', text: 'after' },
    ];
    const provider = makeMockProvider(events);
    const hooks = makeHooks(
      async () => ({ continue: true }),
      async () => ({ terminate: true, reason: 'leaked secret' }),
    );
    const built = buildCtx({ provider, hooks });

    const result = await runTurn(built.ctx, defaultPrompt(built.ctx.abortSignal));

    expect(result.reason).toBe('error');
    expect(result.error).toBe('leaked secret');

    // tool-result was still emitted (post-hook can rewrite, not suppress).
    expect(built.emitted.some((e) => e.type === 'tool-result')).toBe(true);
    // text-delta after the kill never fired.
    expect(built.emitted.some((e) => e.type === 'text-delta')).toBe(false);
  });

  it('postToolUse modifiedOutput rewrites the tool-result output', async () => {
    const events: AgentEvent[] = [
      { type: 'tool-call', messageId: 'm1', id: 't1', name: 'tool', input: {} },
      { type: 'tool-result', messageId: 'm1', id: 't1', output: { secret: 'leaked' } },
    ];
    const provider = makeMockProvider(events);
    const hooks = makeHooks(
      async () => ({ continue: true }),
      async () => ({ continue: true, modifiedOutput: { secret: 'REDACTED' } }),
    );
    const built = buildCtx({ provider, hooks });

    await runTurn(built.ctx, defaultPrompt(built.ctx.abortSignal));

    const toolResult = built.emitted.find((e) => e.type === 'tool-result') as Extract<AgentEvent, { type: 'tool-result' }>;
    expect(toolResult.output).toEqual({ secret: 'REDACTED' });
  });
});

describe('runTurn — abort handling', () => {
  it('abortSignal aborting mid-stream ends with reason "stopped"', async () => {
    // Yield events with a delay so abort can land between them.
    let resolveGate: () => void = () => {};
    const gate = new Promise<void>((r) => { resolveGate = r; });

    const provider: AgentProvider = {
      id: 'mock-async',
      name: 'Mock',
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
        return { providerSessionId: 's' };
      },
      async *prompt(input: PromptInput): AsyncGenerator<AgentEvent> {
        yield { type: 'text-delta', messageId: 'm1', text: 'first' };
        await gate; // wait for the test to abort
        if (input.abortSignal.aborted) return;
        yield { type: 'text-delta', messageId: 'm1', text: 'should not arrive' };
      },
    };

    const built = buildCtx({ provider });
    const promise = runTurn(built.ctx, defaultPrompt(built.ctx.abortSignal));

    // Allow the first event to flow through, then abort + release the gate.
    await new Promise((r) => setTimeout(r, 0));
    built.abortController.abort();
    resolveGate();

    const result = await promise;

    expect(result.reason).toBe('stopped');
    expect(built.emitted.some((e) => e.type === 'text-delta' && e.text === 'first')).toBe(true);
    expect(built.emitted.some((e) => e.type === 'text-delta' && e.text === 'should not arrive')).toBe(false);
    // Closing session-end with reason 'stopped'.
    const last = built.emitted[built.emitted.length - 1];
    expect(last).toMatchObject({ type: 'session-end', reason: 'stopped' });
  });

  it('abort fired before runTurn starts ends immediately with reason "stopped"', async () => {
    const provider = makeMockProvider([
      { type: 'text-delta', messageId: 'm1', text: 'should not stream' },
    ]);
    const built = buildCtx({ provider });
    built.abortController.abort();

    const result = await runTurn(built.ctx, defaultPrompt(built.ctx.abortSignal));

    expect(result.reason).toBe('stopped');
    // Provider's events shouldn't have been processed (the iterator
    // honours the abort signal).
    expect(built.emitted.some((e) => e.type === 'text-delta')).toBe(false);
  });
});

describe('runTurn — provider session-end', () => {
  it('honours provider-emitted session-end without duplicating it', async () => {
    const events: AgentEvent[] = [
      { type: 'text-delta', messageId: 'm1', text: 'hi' },
      {
        type: 'message-complete',
        messageId: 'm1',
        usage: { inputTokens: 1, outputTokens: 1 },
      },
      { type: 'session-end', reason: 'completed' },
    ];
    const provider = makeMockProvider(events);
    const built = buildCtx({ provider });

    const result = await runTurn(built.ctx, defaultPrompt(built.ctx.abortSignal));

    const sessionEnds = built.emitted.filter((e) => e.type === 'session-end');
    expect(sessionEnds).toHaveLength(1);
    expect(result.reason).toBe('completed');
  });

  it('provider session-end with reason "error" is reflected in RunResult', async () => {
    const events: AgentEvent[] = [
      { type: 'session-end', reason: 'error', error: 'upstream broke' },
    ];
    const provider = makeMockProvider(events);
    const built = buildCtx({ provider });

    const result = await runTurn(built.ctx, defaultPrompt(built.ctx.abortSignal));

    expect(result.reason).toBe('error');
    expect(result.error).toBe('upstream broke');
  });
});

describe('runTurn — provider failure modes', () => {
  it('provider.prompt throwing synchronously ends with reason "error"', async () => {
    const provider = makeMockProvider([], { throwOnPrompt: new Error('SDK init failed') });
    const built = buildCtx({ provider });

    const result = await runTurn(built.ctx, defaultPrompt(built.ctx.abortSignal));

    expect(result.reason).toBe('error');
    expect(result.error).toBe('SDK init failed');

    const last = built.emitted[built.emitted.length - 1];
    expect(last).toMatchObject({ type: 'session-end', reason: 'error' });
  });

  it('provider iterator throwing mid-stream ends with reason "error"', async () => {
    const provider: AgentProvider = {
      id: 'mock-throw',
      name: 'Mock',
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
        return { providerSessionId: 's' };
      },
      async *prompt(): AsyncGenerator<AgentEvent> {
        yield { type: 'text-delta', messageId: 'm1', text: 'before' };
        throw new Error('stream broke');
      },
    };
    const built = buildCtx({ provider });

    const result = await runTurn(built.ctx, defaultPrompt(built.ctx.abortSignal));

    expect(result.reason).toBe('error');
    expect(result.error).toBe('stream broke');
  });

  it('persistence callback exceptions are swallowed (loop keeps running)', async () => {
    const events: AgentEvent[] = [
      { type: 'text-delta', messageId: 'm1', text: 'hi' },
      { type: 'message-complete', messageId: 'm1' },
    ];
    const provider = makeMockProvider(events);
    const built = buildCtx({ provider });
    // Wreck onTextDelta — kernel must not bail.
    built.ctx.callbacks.onTextDelta = async () => {
      throw new Error('db unavailable');
    };

    const result = await runTurn(built.ctx, defaultPrompt(built.ctx.abortSignal));

    expect(result.reason).toBe('completed');
    expect(built.emitted.some((e) => e.type === 'text-delta')).toBe(true);
    expect(built.emitted.some((e) => e.type === 'message-complete')).toBe(true);
    // The error was logged via warn.
    const warnings = built.logger.entries.filter((e) => e.level === 'warn');
    expect(warnings.some((w) => /onTextDelta/.test(w.msg))).toBe(true);
  });
});

describe('runTurn — file-edit + permission/HIL pass-through', () => {
  it('file-edit fires onFileEdit and emits', async () => {
    const events: AgentEvent[] = [
      { type: 'file-edit', messageId: 'm1', path: 'src/foo.ts', before: 'old', after: 'new' },
    ];
    const provider = makeMockProvider(events);
    const built = buildCtx({ provider });

    await runTurn(built.ctx, defaultPrompt(built.ctx.abortSignal));

    expect(built.persistence.calls.some((c) => c.name === 'onFileEdit')).toBe(true);
    expect(built.emitted.some((e) => e.type === 'file-edit')).toBe(true);
  });

  it('permission-request and human-input-request pass through unchanged', async () => {
    const events: AgentEvent[] = [
      { type: 'permission-request', id: 'p1', tool: 'Bash', input: { cmd: 'ls' } },
      { type: 'human-input-request', id: 'h1', prompt: 'continue?', blocking: true },
    ];
    const provider = makeMockProvider(events);
    const built = buildCtx({ provider });

    await runTurn(built.ctx, defaultPrompt(built.ctx.abortSignal));

    expect(built.emitted.map((e) => e.type)).toEqual([
      'permission-request',
      'human-input-request',
      'session-end',
    ]);
  });
});
