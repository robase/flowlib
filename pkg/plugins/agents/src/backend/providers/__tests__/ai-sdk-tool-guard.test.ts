/**
 * Tool-deny enforcement for the ai-sdk provider.
 *
 * The invariant under test is not negotiable: **a tool the PreToolUse
 * hooks deny must never reach its underlying `execute`.**
 *
 * The regression these cover: the kernel used to run `runPreToolUse` when
 * it *observed* a `tool-call` event drained from the provider stream. For
 * the ai-sdk provider that's too late — the AI SDK owns dispatch and calls
 * `execute` itself, emitting `tool-call` as a notification alongside the
 * call. So `dangerousBashBlock` matching `rm -rf /` produced a synthetic
 * "Blocked: …" result for the user while the workspace was already being
 * wiped. Same for `modifiedInput`: the rewrite landed on the emitted event
 * only, never on the executed call.
 *
 * Coverage runs at two levels:
 *  1. `wrapToolsWithGuard` in isolation.
 *  2. End-to-end through the real `runTurn` + real `createHookPipeline` +
 *     real `aiSdkProvider`, with only `streamText` faked — because the
 *     bug lived precisely in the seam between those pieces, a unit test of
 *     any one of them would have passed while `rm -rf /` still ran.
 */
import { describe, expect, it, vi } from 'vitest';

import { runTurn } from '../../service/run-turn';
import type { PersistenceCallbacks, SessionContext, SessionLogger } from '../../service/types';
import { createHookPipeline } from '../../hooks/pipeline';
import { dangerousBashBlock } from '../../hooks/handlers';
import { noopHookPipeline } from '../../hooks/types';
import { allowAllResolver } from '../../permissions/types';
import { aiSdkProvider } from '../ai-sdk/provider';
import { wrapToolsWithGuard, type AiSdkToolSet } from '../ai-sdk/tools';
import type { ToolGuard } from '../../service/run-turn';
import type { AgentEvent } from '../../../shared/events';
import type { AgentsAuthContext } from '../../../shared/auth-context';
import type { PromptInput } from '../types';

// ─── Fixtures ─────────────────────────────────────────────────────────

const auth: AgentsAuthContext = { userId: 'user-1', orgId: 'org-1', role: 'user', teamIds: [] };

function makeLogger(): SessionLogger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makePersistence(): PersistenceCallbacks {
  return {
    onMessageStart: vi.fn(async () => {}),
    onTextDelta: vi.fn(async () => {}),
    onToolCall: vi.fn(async () => {}),
    onToolResult: vi.fn(async () => {}),
    onFileEdit: vi.fn(async () => {}),
    onMessageComplete: vi.fn(async () => {}),
    onTurnEnd: vi.fn(async () => {}),
  };
}

function tool(execute: AiSdkToolSet[string]['execute']): AiSdkToolSet[string] {
  return { description: 'fixture', parameters: { type: 'object' }, execute };
}

/**
 * Stand-in for the kernel's guard, so `wrapToolsWithGuard` can be probed
 * without a whole turn around it.
 */
function fixedGuard(decision: { allow: boolean; reason?: string; input?: unknown }): ToolGuard {
  return {
    check: vi.fn(async ({ input }) => ({
      allow: decision.allow,
      ...(decision.reason ? { reason: decision.reason } : {}),
      input: (decision.input ?? input) as Record<string, unknown>,
    })),
  };
}

// ─── Unit: the wrapper itself ─────────────────────────────────────────

describe('wrapToolsWithGuard', () => {
  it('does not call the underlying execute when the guard denies', async () => {
    const execute = vi.fn(async () => ({ ran: true }));
    const wrapped = wrapToolsWithGuard(
      { 'sandbox.run_shell': tool(execute) },
      fixedGuard({ allow: false, reason: 'Blocked: destructive' }),
    );

    const result = await wrapped['sandbox.run_shell'].execute(
      { command: 'rm -rf /' },
      { toolCallId: 'tc-1' },
    );

    expect(execute).not.toHaveBeenCalled();
    // The model still learns *why*, so it can course-correct rather than retry.
    expect(result).toEqual({ error: 'Blocked: destructive', blocked: true });
  });

  it('executes with the guard-resolved input, not the original (modifiedInput lands)', async () => {
    const execute = vi.fn(async () => ({ ok: true }));
    const wrapped = wrapToolsWithGuard(
      { 'sandbox.run_shell': tool(execute) },
      fixedGuard({ allow: true, input: { command: 'ls -la' } }),
    );

    await wrapped['sandbox.run_shell'].execute({ command: 'ls' }, { toolCallId: 'tc-2' });

    expect(execute).toHaveBeenCalledWith({ command: 'ls -la' }, { toolCallId: 'tc-2' });
  });

  it('passes the canonical dotted tool name to the guard', async () => {
    const guard = fixedGuard({ allow: true });
    const wrapped = wrapToolsWithGuard({ 'sandbox.run_shell': tool(async () => null) }, guard);

    await wrapped['sandbox.run_shell'].execute({ command: 'ls' }, { toolCallId: 'tc-3' });

    expect(guard.check).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: 'sandbox.run_shell', toolCallId: 'tc-3' }),
    );
  });

  it('is a pass-through when no guard is threaded', async () => {
    const tools = { echo: tool(async () => ({ ok: true })) };
    expect(wrapToolsWithGuard(tools, undefined)).toBe(tools);
  });
});

// ─── End-to-end: runTurn → aiSdkProvider → streamText → tool execute ──

/**
 * The provider rewrites dotted tool names to the `^[a-zA-Z0-9_-]+$`
 * pattern strict vendors demand before handing the set to `streamText`,
 * so the SDK only ever sees (and calls back with) the sanitised key.
 * Mirror that here — looking tools up by their dotted name would silently
 * find nothing and let a deny test pass for the wrong reason.
 */
function wireName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * A fake `streamText` that behaves like the real one in the way that
 * matters here: **it calls `execute` itself**, and emits the `tool-call`
 * chunk as a notification around that call rather than as a request for
 * permission.
 *
 * `order` picks which side of the race we're reproducing — whether the
 * consumer sees the `tool-call` chunk before or after dispatch. The deny
 * must hold either way.
 */
function fakeStreamText(opts: {
  toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }>;
  order?: 'call-chunk-first' | 'execute-first';
}) {
  return (config: { tools: AiSdkToolSet }) => ({
    fullStream: (async function* () {
      yield { type: 'start' };
      for (const call of opts.toolCalls) {
        const key = wireName(call.name);
        const descriptor = config.tools[key];
        if (!descriptor) {
          throw new Error(
            `fakeStreamText: no tool "${key}" in [${Object.keys(config.tools).join(', ')}]`,
          );
        }
        const emitCall = () => ({
          type: 'tool-call',
          toolCallId: call.id,
          toolName: key,
          input: call.input,
        });
        if (opts.order === 'execute-first') {
          const output = await descriptor.execute(call.input, { toolCallId: call.id });
          yield emitCall();
          yield { type: 'tool-result', toolCallId: call.id, output };
        } else {
          yield emitCall();
          const output = await descriptor.execute(call.input, { toolCallId: call.id });
          yield { type: 'tool-result', toolCallId: call.id, output };
        }
      }
      yield {
        type: 'finish-step',
        usage: { inputTokens: 10, outputTokens: 5 },
        finishReason: 'stop',
      };
      yield { type: 'finish', finishReason: 'stop', totalUsage: { inputTokens: 10, outputTokens: 5 } };
    })(),
  });
}

function makeContext(
  provider: ReturnType<typeof aiSdkProvider>,
  hooks: SessionContext['hooks'],
  events: AgentEvent[],
): SessionContext {
  return {
    sessionId: 'sess-1',
    providerSessionId: 'psess-1',
    auth,
    provider,
    hooks,
    permissions: allowAllResolver,
    logger: makeLogger(),
    callbacks: makePersistence(),
    emit: (e) => {
      events.push(e);
    },
    abortSignal: new AbortController().signal,
  };
}

async function setupTurn(args: {
  streamText: ReturnType<typeof fakeStreamText>;
  shellExecute: AiSdkToolSet[string]['execute'];
  hooks: SessionContext['hooks'];
}) {
  const provider = aiSdkProvider({
    streamText: args.streamText,
    vendors: { anthropic: () => ({}) },
    resolveCredential: async () => ({ vendor: 'anthropic' as const, apiKey: 'sk-test' }),
    tools: () => ({ 'sandbox.run_shell': tool(args.shellExecute) }),
  });
  const { providerSessionId } = await provider.createSession({
    auth,
    config: { defaultModel: 'anthropic/claude-sonnet-4-5' },
  });

  const events: AgentEvent[] = [];
  const ctx = { ...makeContext(provider, args.hooks, events), providerSessionId };
  const prompt: PromptInput = {
    providerSessionId,
    parts: [{ type: 'text', text: 'clean up the repo' }],
    abortSignal: ctx.abortSignal,
  };
  const result = await runTurn(ctx, prompt);
  return { events, result };
}

describe('ai-sdk provider + runTurn: pre-tool deny is enforced, not merely announced', () => {
  const securityHooks = () => createHookPipeline({ pre: [dangerousBashBlock] });

  for (const order of ['call-chunk-first', 'execute-first'] as const) {
    it(`never runs a denied destructive command (dispatch order: ${order})`, async () => {
      const shellExecute = vi.fn(async () => ({ stdout: 'wiped' }));
      const { events } = await setupTurn({
        streamText: fakeStreamText({
          toolCalls: [{ id: 'tc-1', name: 'sandbox.run_shell', input: { command: 'rm -rf /' } }],
          order,
        }),
        shellExecute,
        hooks: securityHooks(),
      });

      // THE invariant.
      expect(shellExecute).not.toHaveBeenCalled();

      // …and the user is still told, exactly once.
      const results = events.filter((e) => e.type === 'tool-result');
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        id: 'tc-1',
        isError: true,
        output: { error: expect.stringContaining('destructive pattern') },
      });
    });
  }

  it('runs the hook chain exactly once per tool call (no duplicate audit rows)', async () => {
    const runPreToolUse = vi.fn(async () => ({ continue: false, reason: 'nope' }));
    const hooks = { ...noopHookPipeline, runPreToolUse } as SessionContext['hooks'];
    const shellExecute = vi.fn(async () => ({ stdout: 'ran' }));

    await setupTurn({
      streamText: fakeStreamText({
        toolCalls: [{ id: 'tc-1', name: 'sandbox.run_shell', input: { command: 'ls' } }],
      }),
      shellExecute,
      hooks,
    });

    // Both the guard (execute-time) and the kernel (event-time) consult
    // the decision; it must be computed once and memoised.
    expect(runPreToolUse).toHaveBeenCalledTimes(1);
    expect(shellExecute).not.toHaveBeenCalled();
  });

  it('applies a hook modifiedInput to the executed call, not just the emitted event', async () => {
    const hooks = {
      ...noopHookPipeline,
      runPreToolUse: async () => ({ continue: true, modifiedInput: { command: 'ls --safe' } }),
    } as SessionContext['hooks'];
    const shellExecute = vi.fn(async () => ({ stdout: 'ok' }));

    const { events } = await setupTurn({
      streamText: fakeStreamText({
        toolCalls: [{ id: 'tc-1', name: 'sandbox.run_shell', input: { command: 'ls' } }],
      }),
      shellExecute,
      hooks,
    });

    expect(shellExecute).toHaveBeenCalledWith({ command: 'ls --safe' }, expect.anything());
    expect(events.find((e) => e.type === 'tool-call')).toMatchObject({
      input: { command: 'ls --safe' },
    });
  });

  it('lets an allowed tool through untouched', async () => {
    const shellExecute = vi.fn(async () => ({ stdout: 'total 0' }));
    const { events, result } = await setupTurn({
      streamText: fakeStreamText({
        toolCalls: [{ id: 'tc-1', name: 'sandbox.run_shell', input: { command: 'ls -la' } }],
      }),
      shellExecute,
      hooks: securityHooks(),
    });

    expect(shellExecute).toHaveBeenCalledWith({ command: 'ls -la' }, expect.anything());
    expect(events.find((e) => e.type === 'tool-result')).toMatchObject({
      output: { stdout: 'total 0' },
      isError: false,
    });
    expect(result.reason).toBe('completed');
  });
});
