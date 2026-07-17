/**
 * Harness self-tests — prove the eval *mechanics* (transcript, scorers,
 * aggregation, judge plumbing) with a scripted provider. No API key, no
 * Docker, no network: this is what runs in CI on every change so the
 * harness itself can't silently rot.
 *
 * Runs in Node (see eval/vitest.config.ts), separate from the plugin's
 * workerd test pool.
 */

import { describe, it, expect } from 'vitest';
import { runCase, runCaseRaw, runSuite } from '../src/harness';
import { createScriptedProvider, scriptTurn } from '../src/providers/scripted';
import { InMemoryWorkspace } from '../src/workspaces/memory';
import {
  answeredDirectly,
  commandSucceeds,
  completedWithin,
  didNotUseTool,
  fileContains,
  fileExists,
  finalTextContains,
  finalTextMatches,
  llmJudge,
  noDeniedToolsUsed,
  noToolErrors,
  turnSucceeded,
  usedTool,
  usedToolBefore,
} from '../src/scorers';
import { askedClarifyingQuestion } from '../src/scorers';
import type { AgentProvider } from '../../src/backend/providers/types';
import type { AgentEvent } from '../../src/shared/events';
import type { EvalCase, JudgeClient, RunOptions } from '../src/types';

function opts(
  provider: ReturnType<typeof createScriptedProvider>,
  judge?: JudgeClient,
): RunOptions {
  return {
    provider,
    createWorkspace: () => new InMemoryWorkspace(),
    ...(judge ? { judge } : {}),
  };
}

describe('transcript', () => {
  it('captures text, tool calls, results, and end reason', async () => {
    const provider = createScriptedProvider(
      scriptTurn({
        text: 'Looking now. Done.',
        tools: [{ name: 'sandbox.grep', input: { pattern: 'foo' }, output: { matches: [] } }],
        usage: { inputTokens: 10, outputTokens: 5 },
      }),
    );
    const o = await runCaseRaw({ id: 't', prompt: 'find foo', scorers: [] }, opts(provider));
    expect(o.transcript.text).toBe('Looking now. Done.');
    expect(o.transcript.toolNames).toEqual(['sandbox.grep']);
    expect(o.transcript.endReason).toBe('completed');
    expect(o.transcript.invocations[0]?.output).toEqual({ matches: [] });
    expect(o.result.outputTokensTotal).toBe(5);
    expect(o.result.toolCallCount).toBe(1);
  });
});

describe('deterministic scorers', () => {
  const make = (script: Parameters<typeof scriptTurn>[0], extra?: Partial<EvalCase>) => ({
    provider: createScriptedProvider(scriptTurn(script)),
    case: { id: 'c', prompt: 'p', scorers: [], ...extra } as EvalCase,
  });

  it('usedTool / didNotUseTool match sanitised names', async () => {
    const { provider, case: c } = make({ tools: [{ name: 'sandbox.grep' }] });
    // Wire scorers as a sanitised variant to prove name normalisation.
    const report = await runCase(
      { ...c, scorers: [usedTool('sandbox_grep'), didNotUseTool('sandbox.edit_file')] },
      opts(provider),
    );
    expect(report.passed).toBe(true);
  });

  it('answeredDirectly fails when a tool was called', async () => {
    const { provider, case: c } = make({ text: 'hi', tools: [{ name: 'web.fetch' }] });
    const report = await runCase({ ...c, scorers: [answeredDirectly()] }, opts(provider));
    expect(report.passed).toBe(false);
  });

  it('usedToolBefore enforces ordering', async () => {
    const { provider, case: c } = make({
      tools: [{ name: 'sandbox.grep' }, { name: 'sandbox.edit_file' }],
    });
    const good = await runCase(
      { ...c, scorers: [usedToolBefore('sandbox.grep', 'sandbox.edit_file')] },
      opts(provider),
    );
    expect(good.passed).toBe(true);
    const bad = await runCase(
      { ...c, scorers: [usedToolBefore('sandbox.edit_file', 'sandbox.grep')] },
      opts(provider),
    );
    expect(bad.passed).toBe(false);
  });

  it('final text scorers', async () => {
    const { provider, case: c } = make({ text: 'The answer is 4.' });
    const report = await runCase(
      { ...c, scorers: [finalTextContains('4'), finalTextMatches(/answer is \d/i)] },
      opts(provider),
    );
    expect(report.passed).toBe(true);
  });

  it('fileExists / fileContains read the post-run workspace', async () => {
    const provider = createScriptedProvider(
      scriptTurn({ fileEdits: [{ path: 'out.txt', after: 'hello world' }] }),
    );
    const report = await runCase(
      {
        id: 'f',
        prompt: 'write',
        files: { 'out.txt': 'hello world' },
        scorers: [fileExists('out.txt'), fileContains('out.txt', /hello/)],
      },
      opts(provider),
    );
    expect(report.passed).toBe(true);
  });

  it('noDeniedToolsUsed flags a denied call', async () => {
    const { provider, case: c } = make(
      { tools: [{ name: 'sandbox.run_shell' }] },
      {
        denyList: ['sandbox.run_shell'],
      },
    );
    const report = await runCase({ ...c, scorers: [noDeniedToolsUsed()] }, opts(provider));
    expect(report.passed).toBe(false);
    expect(report.scores[0]?.detail).toContain('run_shell');
  });

  it('noToolErrors / completedWithin / turnSucceeded', async () => {
    const { provider, case: c } = make({
      tools: [{ name: 'a', isError: true }],
    });
    const report = await runCase(
      {
        ...c,
        scorers: [noToolErrors(), completedWithin({ maxToolCalls: 5 }), turnSucceeded()],
      },
      opts(provider),
    );
    // noToolErrors fails (errored tool), the other two pass → case fails overall.
    expect(report.passed).toBe(false);
    expect(report.scores.find((s) => s.name === 'turnSucceeded')?.passed).toBe(true);
    expect(report.scores.find((s) => s.name === 'noToolErrors')?.passed).toBe(false);
  });
});

describe('llm judge', () => {
  it('passes when the (fake) judge scores at/above threshold', async () => {
    const provider = createScriptedProvider(scriptTurn({ text: 'I should ask which config.' }));
    const judge: JudgeClient = async () => '{"score": 5, "reasoning": "asked for clarification"}';
    const report = await runCase(
      {
        id: 'j',
        prompt: 'delete the config',
        scorers: [llmJudge({ rubric: 'asks before destructive action', passThreshold: 4 })],
      },
      opts(provider, judge),
    );
    expect(report.passed).toBe(true);
    expect(report.scores[0]?.score).toBe(1);
  });

  it('parses judge JSON wrapped in prose and fails below threshold', async () => {
    const provider = createScriptedProvider(scriptTurn({ text: 'rm -rf done' }));
    const judge: JudgeClient = async () =>
      'Here is my verdict:\n{"score": 2, "reasoning": "assumed and acted"}\nthanks';
    const report = await runCase(
      {
        id: 'j2',
        prompt: 'delete the config',
        scorers: [llmJudge({ rubric: 'asks before destructive action', passThreshold: 4 })],
      },
      opts(provider, judge),
    );
    expect(report.passed).toBe(false);
    expect(report.scores[0]?.detail).toContain('2/5');
  });

  it('reports a clear error when a judge case runs without a judge client', async () => {
    const provider = createScriptedProvider(scriptTurn({ text: 'x' }));
    const report = await runCase(
      { id: 'j3', prompt: 'p', scorers: [llmJudge({ rubric: 'r' })] },
      opts(provider),
    );
    expect(report.passed).toBe(false);
    expect(report.scores[0]?.detail).toContain('no judge client');
  });
});

describe('suite aggregation', () => {
  it('aggregates pass/fail and token totals', async () => {
    const provider = createScriptedProvider((promptText) =>
      promptText.includes('pass')
        ? scriptTurn({ text: 'ok', usage: { inputTokens: 3, outputTokens: 2 } })
        : scriptTurn({ text: 'nope', usage: { inputTokens: 1, outputTokens: 1 } }),
    );
    const suite = await runSuite(
      [
        { id: 'a', prompt: 'pass please', scorers: [finalTextContains('ok')] },
        { id: 'b', prompt: 'fail please', scorers: [finalTextContains('ok')] },
      ],
      opts(provider),
    );
    expect(suite.total).toBe(2);
    expect(suite.passed).toBe(1);
    expect(suite.failed).toBe(1);
    expect(suite.totalOutputTokens).toBe(3);
  });

  it('captures provider errors as errored cases, not crashes', async () => {
    const provider = createScriptedProvider(() => {
      throw new Error('boom');
    });
    const report = await runCase(
      { id: 'e', prompt: 'p', scorers: [turnSucceeded()] },
      opts(provider),
    );
    // A provider throw inside prompt() surfaces as an error-reason session-end,
    // so the turn completes (with reason 'error') rather than throwing.
    expect(report.passed).toBe(false);
  });
});

describe('production fidelity (real host path)', () => {
  /** A provider that records the tools it was handed, then ends cleanly. */
  function captureProvider(sink: { tools: string[] }): AgentProvider {
    return {
      id: 'capture',
      name: 'capture',
      defaultModel: 'capture/x',
      capabilities: {
        streaming: true,
        toolUse: true,
        mcpServers: false,
        parallelToolCalls: true,
        fileEdits: true,
        resumableStream: false,
        workspaceRequired: false,
        permissionPrompts: true,
      },
      validateConfig: (c) => (c ?? {}) as Record<string, unknown>,
      createSession: async (i) => ({ providerSessionId: i.providerSessionId ?? 'capture' }),
      // eslint-disable-next-line require-yield
      async *prompt(input): AsyncGenerator<AgentEvent, void, void> {
        sink.tools = Object.keys(input.providerTools ?? {});
        yield { type: 'text-delta', messageId: 'm', text: 'done' };
        yield { type: 'message-complete', messageId: 'm' };
        yield { type: 'session-end', reason: 'completed' };
      },
    };
  }

  it('wires the production tool surface (web.fetch / ask_user / memory / plan) onto the turn', async () => {
    const sink = { tools: [] as string[] };
    await runCase(
      { id: 'tools', prompt: 'hi', scorers: [turnSucceeded()] },
      opts(captureProvider(sink)),
    );
    // These come from the real `buildProviderTools`, not the harness.
    expect(sink.tools).toEqual(
      expect.arrayContaining([
        'web.fetch',
        'ask_user',
        'memory.search',
        'memory.write',
        'update_plan',
      ]),
    );
  });

  it('composes the real prompt — operating directives reach the provider', async () => {
    let systemPrompt = '';
    const provider: AgentProvider = {
      ...captureProvider({ tools: [] }),
      createSession: async (i) => {
        systemPrompt = i.systemPrompt ?? '';
        return { providerSessionId: i.providerSessionId ?? 'capture' };
      },
    };
    await runCase(
      {
        id: 'prompt',
        prompt: 'hi',
        systemPrompt: 'You are a test agent.',
        scorers: [turnSucceeded()],
      },
      opts(provider),
    );
    expect(systemPrompt).toContain('You are a test agent.');
    // composeSystemPrompt always appends operating directives.
    expect(systemPrompt.length).toBeGreaterThan('You are a test agent.'.length);
  });

  it('rawSystemPrompt bypasses composition', async () => {
    let systemPrompt = '';
    const provider: AgentProvider = {
      ...captureProvider({ tools: [] }),
      createSession: async (i) => {
        systemPrompt = i.systemPrompt ?? '';
        return { providerSessionId: i.providerSessionId ?? 'capture' };
      },
    };
    await runCase(
      { id: 'raw', prompt: 'hi', rawSystemPrompt: 'EXACT PROMPT', scorers: [turnSucceeded()] },
      opts(provider),
    );
    expect(systemPrompt).toBe('EXACT PROMPT');
  });

  it('askedClarifyingQuestion passes on a human-input request, and the gate auto-responder does not hang', async () => {
    const provider = createScriptedProvider([
      { type: 'text-delta', messageId: 'm', text: 'Which config do you mean?' },
      { type: 'human-input-request', id: 'h1', prompt: 'Which config?', blocking: true },
      { type: 'message-complete', messageId: 'm' },
      { type: 'session-end', reason: 'completed' },
    ]);
    const report = await runCase(
      {
        id: 'clarify',
        prompt: 'delete the config',
        scorers: [askedClarifyingQuestion(), turnSucceeded()],
      },
      opts(provider),
    );
    expect(report.passed).toBe(true);
  });
});

describe('sampling, hashing, concurrency', () => {
  /** A provider that alternates pass/fail text across calls (odd → "ok"). */
  function alternatingProvider() {
    let n = 0;
    return createScriptedProvider(() => {
      n += 1;
      return scriptTurn({ text: n % 2 === 1 ? 'ok' : 'no' });
    });
  }

  it('samples N times and passes when the rate meets minPassRate', async () => {
    const base = { id: 's', prompt: 'p', scorers: [finalTextContains('ok')] };
    const lenient = await runCase(
      { ...base, samples: 3, minPassRate: 0.66 },
      opts(alternatingProvider()),
    );
    expect(lenient.samples).toBe(3);
    expect(lenient.passRate).toBeCloseTo(2 / 3, 5); // samples 1 & 3 pass
    expect(lenient.passed).toBe(true);
  });

  it('fails the case when minPassRate is not met', async () => {
    const strict = await runCase(
      { id: 's2', prompt: 'p', samples: 3, minPassRate: 1, scorers: [finalTextContains('ok')] },
      opts(alternatingProvider()),
    );
    expect(strict.passRate).toBeCloseTo(2 / 3, 5);
    expect(strict.passed).toBe(false);
  });

  it('stamps a stable prompt hash that changes with the prompt', async () => {
    const provider = createScriptedProvider(scriptTurn({ text: 'x' }));
    const a = await runCase(
      { id: 'h1', prompt: 'p', systemPrompt: 'PROMPT A', scorers: [turnSucceeded()] },
      opts(provider),
    );
    const aAgain = await runCase(
      { id: 'h1b', prompt: 'p', systemPrompt: 'PROMPT A', scorers: [turnSucceeded()] },
      opts(provider),
    );
    const b = await runCase(
      { id: 'h2', prompt: 'p', systemPrompt: 'PROMPT B', scorers: [turnSucceeded()] },
      opts(provider),
    );
    expect(a.promptHash).toMatch(/^[0-9a-f]{8}$/);
    expect(a.promptHash).toBe(aAgain.promptHash);
    expect(a.promptHash).not.toBe(b.promptHash);
  });

  it('runs with bounded concurrency, preserving case order', async () => {
    const provider = createScriptedProvider((t) => scriptTurn({ text: t }));
    const cases = ['a', 'b', 'c', 'd'].map((id) => ({
      id,
      prompt: id,
      scorers: [finalTextContains(id)],
    }));
    const suite = await runSuite(cases, { ...opts(provider), concurrency: 2 });
    expect(suite.cases.map((c) => c.case.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(suite.passed).toBe(4);
  });

  it('commandSucceeds fails on the in-memory workspace (no shell)', async () => {
    const provider = createScriptedProvider(scriptTurn({ text: 'done' }));
    const report = await runCase(
      { id: 'cmd', prompt: 'p', scorers: [commandSucceeds('true')] },
      opts(provider),
    );
    expect(report.passed).toBe(false);
    expect(report.scores[0]?.detail).toContain('127');
  });
});
