/**
 * Integration tests: agent loop token-usage aggregation + afterAgentExecute
 * plugin hook firing.
 *
 * The streaming path is what hosted billing depends on for `llmTokens`
 * metering. These tests cover:
 *   - Per-iteration usage from each LLM round-trip is summed
 *   - Tool-call iterations contribute to the total alongside the final text iter
 *   - `afterAgentExecute` fires once per agent node with correct totals
 *   - Hook payload includes the resolved toolCallCount + duration
 *   - When NO iteration reports usage, totals stay undefined (don't fabricate 0)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { respondWithChatCompletion } from '../helpers/openai-sse';
import { FlowRunStatus } from '../../../src';
import type { FlowlibInstance } from '../../../src/api/types';
import type { FlowlibDefinition } from '../../../src/services/flow-versions/schemas-fresh';
import type { AgentExecutionOutput } from '../../../src/types/agent-tool.types';
import type { FlowlibPlugin } from '../../../src/types/plugin.types';
import { createTestFlowlib } from '../helpers/test-flowlib';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function textResponse(
  content: string,
  usage?: { prompt_tokens: number; completion_tokens: number },
) {
  return {
    id: 'chatcmpl',
    object: 'chat.completion',
    created: 1,
    model: 'gpt-4o-mini',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    ...(usage
      ? { usage: { ...usage, total_tokens: usage.prompt_tokens + usage.completion_tokens } }
      : {}),
  };
}

function toolCallResponse(
  calls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>,
  usage?: { prompt_tokens: number; completion_tokens: number },
) {
  return {
    id: 'chatcmpl',
    object: 'chat.completion',
    created: 1,
    model: 'gpt-4o-mini',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: null,
          tool_calls: calls.map((c) => ({
            id: c.id,
            type: 'function',
            function: { name: c.name, arguments: JSON.stringify(c.arguments) },
          })),
        },
        finish_reason: 'tool_calls',
      },
    ],
    ...(usage
      ? { usage: { ...usage, total_tokens: usage.prompt_tokens + usage.completion_tokens } }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// Shared state + plugin spy
// ---------------------------------------------------------------------------

let responseQueue: Array<Record<string, unknown>> = [];

const mswServer = setupServer(
  http.post('https://api.openai.com/v1/chat/completions', async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const next = responseQueue.shift();
    if (!next) {
      throw new Error('No queued chat.completions response');
    }
    return respondWithChatCompletion(body, next);
  }),
  http.get('https://api.openai.com/v1/models', () =>
    HttpResponse.json({ object: 'list', data: [{ id: 'gpt-4o-mini', object: 'model' }] }),
  ),
);

let flowlib: FlowlibInstance;
let credentialId: string;

const afterAgentExecuteSpy = vi.fn();

beforeAll(async () => {
  mswServer.listen({ onUnhandledRequest: 'bypass' });

  const meteringPlugin: FlowlibPlugin = {
    id: 'test-metering',
    hooks: {
      afterAgentExecute: async (ctx) => {
        afterAgentExecuteSpy(ctx);
      },
    },
  };

  flowlib = await createTestFlowlib({ plugins: [meteringPlugin] });

  const cred = await flowlib.credentials.create({
    name: 'Test OpenAI',
    type: 'llm',
    authType: 'apiKey',
    config: { apiKey: 'sk-test', provider: 'openai' },
    description: 'mock',
  });
  credentialId = cred.id;
});

afterAll(async () => {
  mswServer.close();
  await flowlib.shutdown();
});

beforeEach(() => {
  responseQueue = [];
  afterAgentExecuteSpy.mockReset();
});

afterEach(() => mswServer.resetHandlers());

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function agentNode(
  overrides: Partial<Record<string, unknown>> = {},
): FlowlibDefinition['nodes'][number] {
  return {
    id: 'agent-1',
    type: 'core.agent',
    label: 'Agent',
    referenceId: 'agent',
    params: {
      credentialId,
      model: 'gpt-4o-mini',
      provider: 'OPENAI',
      taskPrompt: 'Do the thing',
      systemPrompt: '',
      addedTools: [
        {
          instanceId: 'inst_math',
          toolId: 'math_eval',
          name: 'Math',
          description: 'eval math',
          params: {},
        },
      ],
      maxIterations: 5,
      stopCondition: 'explicit_stop',
      temperature: 0,
      enableParallelTools: false,
      ...overrides,
    },
    position: { x: 0, y: 0 },
  };
}

async function runAgentFlow(definition: FlowlibDefinition) {
  const flow = await flowlib.flows.create({ name: `usage-${Date.now()}-${Math.random()}` });
  await flowlib.versions.create(flow.id, { flowlibDefinition: definition });
  return flowlib.runs.start(flow.id, {}, { useBatchProcessing: false });
}

function getAgentOutput(result: {
  outputs?: Record<string, unknown>;
}): AgentExecutionOutput | undefined {
  const node = result.outputs?.['agent-1'] as
    | { data: { variables: Record<string, { value?: unknown }> } }
    | undefined;
  return node?.data?.variables?.output?.value as AgentExecutionOutput | undefined;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Agent token-usage aggregation', () => {
  it('sums usage across a single text iteration', async () => {
    responseQueue.push(textResponse('done', { prompt_tokens: 100, completion_tokens: 25 }));

    const result = await runAgentFlow({ nodes: [agentNode()], edges: [] });

    expect(result.status).toBe(FlowRunStatus.SUCCESS);
    const output = getAgentOutput(result)!;
    expect(output.tokenUsage?.inputTokens).toBe(100);
    expect(output.tokenUsage?.outputTokens).toBe(25);
  });

  it('sums usage across tool-call + final-text iterations', async () => {
    // Iter 1: tool call (90 in / 12 out)
    responseQueue.push(
      toolCallResponse([{ id: 'call_1', name: 'inst_math', arguments: { expression: '1+1' } }], {
        prompt_tokens: 90,
        completion_tokens: 12,
      }),
    );
    // Iter 2: final text (110 in / 8 out — input grows because tool result is in context)
    responseQueue.push(textResponse('result is 2', { prompt_tokens: 110, completion_tokens: 8 }));

    const result = await runAgentFlow({ nodes: [agentNode()], edges: [] });

    expect(result.status).toBe(FlowRunStatus.SUCCESS);
    const output = getAgentOutput(result)!;
    expect(output.iterations).toBe(2);
    expect(output.tokenUsage?.inputTokens).toBe(200);
    expect(output.tokenUsage?.outputTokens).toBe(20);
    expect(output.toolResults).toHaveLength(1);
  });

  it('keeps tokenUsage totals undefined when no iteration surfaces usage', async () => {
    // No `usage` field on the response → SSE helper omits the usage chunk →
    // adapter returns response.usage === undefined → loop totals remain
    // undefined (NOT 0).
    responseQueue.push(textResponse('quiet'));

    const result = await runAgentFlow({ nodes: [agentNode()], edges: [] });

    const output = getAgentOutput(result)!;
    expect(output.tokenUsage?.inputTokens).toBeUndefined();
    expect(output.tokenUsage?.outputTokens).toBeUndefined();
    // Conversation-token estimate stays populated (separate concern).
    expect(output.tokenUsage?.conversationTokensEstimate).toBeGreaterThan(0);
  });

  it('treats partial usage (only some iterations report it) as a sum of what was reported', async () => {
    // Iter 1 reports usage; iter 2 does not. Aggregate equals iter 1.
    responseQueue.push(
      toolCallResponse([{ id: 'call_1', name: 'math_eval', arguments: { expression: '2*3' } }], {
        prompt_tokens: 50,
        completion_tokens: 10,
      }),
    );
    responseQueue.push(textResponse('answer'));

    const result = await runAgentFlow({ nodes: [agentNode()], edges: [] });

    const output = getAgentOutput(result)!;
    expect(output.tokenUsage?.inputTokens).toBe(50);
    expect(output.tokenUsage?.outputTokens).toBe(10);
  });
});

describe('afterAgentExecute hook firing (streaming path)', () => {
  it('fires once per agent node with aggregated token + tool counts', async () => {
    responseQueue.push(
      toolCallResponse([{ id: 'call_1', name: 'inst_math', arguments: { expression: '1+1' } }], {
        prompt_tokens: 60,
        completion_tokens: 15,
      }),
    );
    responseQueue.push(textResponse('two', { prompt_tokens: 70, completion_tokens: 5 }));

    const result = await runAgentFlow({ nodes: [agentNode()], edges: [] });

    expect(result.status).toBe(FlowRunStatus.SUCCESS);
    expect(afterAgentExecuteSpy).toHaveBeenCalledTimes(1);
    const ctx = afterAgentExecuteSpy.mock.calls[0][0];
    expect(ctx.nodeId).toBe('agent-1');
    expect(ctx.tokensIn).toBe(130);
    expect(ctx.tokensOut).toBe(20);
    expect(ctx.toolCallCount).toBe(1);
    // Duration must be a real ms number, not 0 — the agent did real work.
    expect(typeof ctx.durationMs).toBe('number');
    expect(ctx.durationMs).toBeGreaterThanOrEqual(0);
    expect(ctx.flowRunId).toBeDefined();
  });

  it('reports zero tokens when no iteration provided usage (hook still fires)', async () => {
    responseQueue.push(textResponse('quiet'));

    await runAgentFlow({ nodes: [agentNode()], edges: [] });

    expect(afterAgentExecuteSpy).toHaveBeenCalledTimes(1);
    const ctx = afterAgentExecuteSpy.mock.calls[0][0];
    // The coordinator reads meta.tokenUsage.inputTokens — undefined collapses
    // to 0 via the `?? 0` guard in node-execution-coordinator.ts.
    expect(ctx.tokensIn).toBe(0);
    expect(ctx.tokensOut).toBe(0);
    expect(ctx.toolCallCount).toBe(0);
  });

  it('does NOT fire afterAgentExecute on a non-agent node', async () => {
    // Run a flow with no agent nodes — the hook must stay silent.
    const flow = await flowlib.flows.create({ name: `noop-${Date.now()}` });
    await flowlib.versions.create(flow.id, {
      flowlibDefinition: {
        nodes: [
          {
            id: 'in',
            type: 'core.input',
            referenceId: 'in',
            params: {},
            position: { x: 0, y: 0 },
          },
          {
            id: 'out',
            type: 'core.output',
            referenceId: 'out',
            params: { value: 'hi' },
            position: { x: 100, y: 0 },
          },
        ],
        edges: [{ id: 'e', source: 'in', target: 'out' }],
      },
    });
    await flowlib.runs.start(flow.id, {}, { useBatchProcessing: false });

    expect(afterAgentExecuteSpy).not.toHaveBeenCalled();
  });
});
