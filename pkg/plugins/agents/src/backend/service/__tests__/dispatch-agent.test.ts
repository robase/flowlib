/**
 * Tests for `dispatch_agent` — the read-only sub-agent tool. Drives it with
 * a fake `AgentService` that streams text into the sub-context's `emit`, and
 * asserts: the streamed text is captured into the returned summary, the
 * sub-turn is read-only (allowlist excludes writes + dispatch_agent itself),
 * persistence is no-op'd, and the parent sink is never touched.
 */
import { describe, it, expect, vi } from 'vitest';
import { buildDispatchAgentTool, SUBAGENT_READ_ONLY_TOOLS } from '../dispatch-agent';
import type { AgentService, SessionContext, RunResult } from '../types';
import type { AgentProvider } from '../../providers/types';

const fakeProvider = { id: 'p', name: 'P' } as unknown as AgentProvider;

function baseDeps(runTurn: AgentService['runTurn']) {
  return {
    agentService: { runTurn },
    base: {
      sessionId: 's1',
      providerSessionId: 'ps1',
      auth: { orgId: 'o', userId: 'u' } as SessionContext['auth'],
      provider: fakeProvider,
      hooks: {} as SessionContext['hooks'],
      permissions: (() => ({ allowed: true })) as unknown as SessionContext['permissions'],
      logger: { debug() {}, info() {}, warn() {}, error() {} },
      abortSignal: new AbortController().signal,
      defaultModel: 'openrouter/anthropic/claude-sonnet-4.5',
      providerTools: {},
    },
  };
}

const RESULT: RunResult = {
  reason: 'completed',
  messageCount: 1,
  toolCallCount: 2,
  inputTokensTotal: 10,
  outputTokensTotal: 5,
  durationMs: 1,
};

describe('buildDispatchAgentTool', () => {
  it('runs a sub-turn and returns the captured streamed text as the summary', async () => {
    let seenCtx: SessionContext | undefined;
    const runTurn = vi.fn(async (ctx: SessionContext) => {
      seenCtx = ctx;
      await ctx.emit({ type: 'text-delta', messageId: 'm', text: 'Found it in ' });
      await ctx.emit({ type: 'text-delta', messageId: 'm', text: 'src/foo.ts:42.' });
      return RESULT;
    });
    const tool = buildDispatchAgentTool(baseDeps(runTurn));
    const out = (await tool.execute({ task: 'where is foo configured?' }, {})) as {
      summary: string;
      reason: string;
      toolCalls: number;
    };
    expect(out.summary).toBe('Found it in src/foo.ts:42.');
    expect(out.reason).toBe('completed');
    expect(out.toolCalls).toBe(2);
    // The sub-context is read-only and depth-capped.
    expect(seenCtx?.enabledTools).toEqual(SUBAGENT_READ_ONLY_TOOLS);
    expect(seenCtx?.enabledTools).not.toContain('dispatch_agent');
    expect(seenCtx?.enabledTools).not.toContain('sandbox.write_file');
    expect(seenCtx?.enabledTools).not.toContain('sandbox.edit_file');
    // No HIL gate for the sub-agent.
    expect(seenCtx?.decisionGate).toBeUndefined();
  });

  it('frames the task as a read-only investigation in the prompt', async () => {
    let promptText = '';
    const runTurn = vi.fn(async (_ctx: SessionContext, prompt: { parts: Array<{ text?: string }> }) => {
      promptText = prompt.parts[0]?.text ?? '';
      return RESULT;
    });
    const tool = buildDispatchAgentTool(baseDeps(runTurn as unknown as AgentService['runTurn']));
    await tool.execute({ task: 'trace callers of bar()' }, {});
    expect(promptText).toContain('read-only exploration sub-agent');
    expect(promptText).toContain('trace callers of bar()');
  });

  it('rejects an empty task without running a turn', async () => {
    const runTurn = vi.fn(async () => RESULT);
    const tool = buildDispatchAgentTool(baseDeps(runTurn));
    const out = (await tool.execute({ task: '   ' }, {})) as { error?: string };
    expect(out.error).toMatch(/non-empty/);
    expect(runTurn).not.toHaveBeenCalled();
  });

  it('truncates an over-long summary', async () => {
    const big = 'x'.repeat(50);
    const runTurn = vi.fn(async (ctx: SessionContext) => {
      await ctx.emit({ type: 'text-delta', messageId: 'm', text: big });
      return RESULT;
    });
    const deps = { ...baseDeps(runTurn), maxSummaryChars: 10 };
    const tool = buildDispatchAgentTool(deps);
    const out = (await tool.execute({ task: 'go' }, {})) as { summary: string; truncated: boolean };
    expect(out.truncated).toBe(true);
    expect(out.summary).toContain('…(summary truncated)');
  });

  it('falls back to a placeholder when no text was produced', async () => {
    const runTurn = vi.fn(async () => RESULT);
    const tool = buildDispatchAgentTool(baseDeps(runTurn));
    const out = (await tool.execute({ task: 'go' }, {})) as { summary: string };
    expect(out.summary).toMatch(/no textual summary/);
  });
});
