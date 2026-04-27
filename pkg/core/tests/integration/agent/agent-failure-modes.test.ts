/**
 * Integration tests: Agent failure modes
 *
 * Targets the brittle edges of the agent loop — surfaces that unit tests
 * usually skip because they require a real Invect core, real tool registry,
 * and real orchestrator:
 *
 * - Conversation truncation when `maxConversationTokens` is exceeded
 * - OpenAI API HTTP errors (429, 500) propagating to FAILED node
 * - Malformed tool arguments from the LLM (`_parseError` path)
 * - Huge tool output truncation (MAX_TOOL_OUTPUT_CHARS)
 * - Tool timeout via `toolTimeoutMs`
 * - Parallel tool calls with mixed success/failure
 * - Agent reaches `max_iterations` with pending tool calls
 * - Agent node FAILED propagates to flow FAILED
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { respondWithChatCompletion } from '../helpers/openai-sse';
import { http, HttpResponse, delay } from 'msw';
import { FlowRunStatus } from '../../../src';
import type { InvectInstance } from '../../../src/api/types';
import type { InvectDefinition } from '../../../src/services/flow-versions/schemas-fresh';
import type { AgentExecutionOutput } from '../../../src/types/agent-tool.types';
import { createTestInvect } from '../helpers/test-flowlib';

// ---------------------------------------------------------------------------
// MSW helpers
// ---------------------------------------------------------------------------

function textResponse(content: string) {
  return {
    id: `chatcmpl-${Date.now()}-${Math.random()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: 'gpt-4o-mini',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content, tool_calls: undefined },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
  };
}

function toolCallResponse(
  calls: Array<{ id: string; name: string; arguments: Record<string, unknown> | string }>,
) {
  return {
    id: `chatcmpl-${Date.now()}-${Math.random()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
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
            function: {
              name: c.name,
              arguments:
                typeof c.arguments === 'string' ? c.arguments : JSON.stringify(c.arguments),
            },
          })),
        },
        finish_reason: 'tool_calls',
      },
    ],
    usage: { prompt_tokens: 60, completion_tokens: 30, total_tokens: 90 },
  };
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

let flowlib: InvectInstance;
let credentialId: string;
let openAiQueue: Array<Record<string, unknown> | (() => Response | Promise<Response>)> = [];
let capturedOpenAiRequests: Array<Record<string, unknown>> = [];

const mswServer = setupServer(
  http.post('https://api.openai.com/v1/chat/completions', async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    capturedOpenAiRequests.push(body);
    const next = openAiQueue.shift();
    if (!next) {
      return respondWithChatCompletion(body, textResponse('[No more queued responses]'));
    }
    if (typeof next === 'function') {
      // Caller-provided factory — usually returns an error response. Leave
      // untouched so tests can exercise non-happy-path shapes (timeouts, 4xx).
      return next();
    }
    return respondWithChatCompletion(body, next);
  }),
  http.get('https://api.openai.com/v1/models', () =>
    HttpResponse.json({
      object: 'list',
      data: [{ id: 'gpt-4o-mini', object: 'model', owned_by: 'openai' }],
    }),
  ),
);

beforeAll(async () => {
  mswServer.listen({ onUnhandledRequest: 'bypass' });
  flowlib = await createTestInvect();
  const cred = await flowlib.credentials.create({
    name: 'Test OpenAI',
    type: 'llm',
    authType: 'apiKey',
    config: { apiKey: 'sk-test', provider: 'openai' },
    description: 'MSW OpenAI',
  });
  credentialId = cred.id;
});

afterAll(async () => {
  mswServer.close();
  await flowlib.shutdown();
});

beforeEach(() => {
  openAiQueue = [];
  capturedOpenAiRequests = [];
});

afterEach(() => {
  mswServer.resetHandlers();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function runFlow(definition: InvectDefinition, inputs: Record<string, unknown> = {}) {
  const flow = await flowlib.flows.create({ name: `agent-fail-${Date.now()}-${Math.random()}` });
  await flowlib.versions.create(flow.id, { invectDefinition: definition });
  return flowlib.runs.start(flow.id, inputs, { useBatchProcessing: false });
}

function getAgentOutput(
  result: { outputs?: Record<string, unknown> },
  nodeId = 'agent',
): AgentExecutionOutput | undefined {
  const node = result.outputs?.[nodeId] as
    | { data: { variables: Record<string, { value?: unknown }> } }
    | undefined;
  return node?.data?.variables?.output?.value as AgentExecutionOutput | undefined;
}

function baseAgent(overrides: Record<string, unknown> = {}): InvectDefinition['nodes'][number] {
  return {
    id: 'agent',
    type: 'core.agent',
    referenceId: 'agent',
    params: {
      credentialId,
      model: 'gpt-4o-mini',
      provider: 'OPENAI',
      taskPrompt: 'do it',
      systemPrompt: '',
      addedTools: [
        {
          instanceId: 'inst_math',
          toolId: 'math_eval',
          name: 'Math',
          description: 'eval',
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Agent failure modes', () => {
  // -------------------------------------------------------------------------
  // Conversation truncation
  // -------------------------------------------------------------------------
  describe('conversation truncation', () => {
    it('truncates history when maxConversationTokens is exceeded mid-loop', async () => {
      // Iteration 1: tool call (anything — math_eval is fast and cheap).
      openAiQueue.push(
        toolCallResponse([{ id: 't1', name: 'inst_math', arguments: { expression: '1 + 1' } }]),
      );
      // Iteration 2: after huge tool output lands in history, truncation runs
      // before the next API call, then the LLM wraps up.
      openAiQueue.push(textResponse('done'));

      // OPENAI tokens-per-char = 0.25. A 20k-char prompt ≈ 5000 tokens, which
      // is way above the 200-token budget.
      const hugeTaskPrompt = 'A '.repeat(10_000);

      const result = await runFlow({
        nodes: [baseAgent({ taskPrompt: hugeTaskPrompt, maxConversationTokens: 200 })],
        edges: [],
      });

      expect(result.status).toBe(FlowRunStatus.SUCCESS);

      const out = getAgentOutput(result)!;
      expect(out.finishReason).toBe('completed');
      expect(out.tokenUsage?.truncationOccurred).toBe(true);

      // The truncation notice should appear in the second request's messages
      // (the first message — the huge task prompt — is preserved by design).
      expect(capturedOpenAiRequests).toHaveLength(2);
      const msgs = capturedOpenAiRequests[1].messages as Array<{
        role: string;
        content: string;
      }>;
      const notice = msgs.find(
        (m) => typeof m.content === 'string' && m.content.includes('truncated'),
      );
      expect(notice).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // OpenAI API HTTP errors — use 401 and 400 so the OpenAI SDK does NOT retry
  // (the SDK auto-retries 408/409/429/5xx with exponential backoff).
  // -------------------------------------------------------------------------
  describe('OpenAI API errors', () => {
    it('fails the flow when OpenAI returns 401 unauthorized', async () => {
      openAiQueue.push(() =>
        HttpResponse.json(
          { error: { message: 'Invalid API key', type: 'invalid_request_error' } },
          { status: 401 },
        ),
      );

      const result = await runFlow({
        nodes: [baseAgent()],
        edges: [],
      });

      expect(result.status).toBe(FlowRunStatus.FAILED);
      const trace = result.traces?.find((t) => t.nodeId === 'agent');
      expect(trace?.status).toBe('FAILED');
      expect(trace?.error ?? '').toMatch(/agent/i);
    });

    it('fails the flow when OpenAI returns 400 bad-request', async () => {
      openAiQueue.push(() =>
        HttpResponse.json(
          { error: { message: 'Bad request', type: 'invalid_request_error' } },
          { status: 400 },
        ),
      );

      const result = await runFlow({
        nodes: [baseAgent()],
        edges: [],
      });

      expect(result.status).toBe(FlowRunStatus.FAILED);
    });

    it('propagates agent failure through the flow — downstream nodes do not execute', async () => {
      openAiQueue.push(() =>
        HttpResponse.json({ error: { message: 'bad request' } }, { status: 400 }),
      );

      const result = await runFlow({
        nodes: [
          baseAgent(),
          {
            id: 'after',
            type: 'core.template_string',
            referenceId: 'after',
            params: { template: 'should not run: {{ agent.finalResponse }}' },
            position: { x: 200, y: 0 },
          },
        ],
        edges: [{ id: 'e1', source: 'agent', target: 'after' }],
      });

      expect(result.status).toBe(FlowRunStatus.FAILED);
      const afterNode = result.outputs?.['after'];
      expect(afterNode).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Malformed tool arguments
  // -------------------------------------------------------------------------
  describe('malformed tool arguments', () => {
    it('agent receives a _parseError marker and can recover', async () => {
      // First call: malformed JSON arguments — not valid JSON at all.
      openAiQueue.push(
        toolCallResponse([{ id: 't1', name: 'inst_math', arguments: '{ not valid json' }]),
      );
      // Second call: agent retries with correct arguments
      openAiQueue.push(
        toolCallResponse([{ id: 't2', name: 'inst_math', arguments: { expression: '2 + 2' } }]),
      );
      // Third call: agent reports completion
      openAiQueue.push(textResponse('The answer is 4.'));

      const result = await runFlow({
        nodes: [baseAgent({ maxIterations: 5 })],
        edges: [],
      });

      expect(result.status).toBe(FlowRunStatus.SUCCESS);

      const out = getAgentOutput(result)!;
      // Both tool calls are recorded. The first fails because `expression`
      // is missing (Zod validation); the second succeeds.
      expect(out.toolResults).toHaveLength(2);
      expect(out.toolResults[0].success).toBe(false);
      expect(out.toolResults[1].success).toBe(true);
      expect(out.toolResults[1].output).toBe(4);
      expect(out.finalResponse).toBe('The answer is 4.');

      // The first tool call's input contains the parse-error marker the
      // adapter injected — this is what tells the LLM what went wrong.
      const firstInput = out.toolResults[0].input as Record<string, unknown>;
      expect(firstInput._parseError).toBeDefined();
      expect(typeof firstInput._parseError).toBe('string');
    });
  });

  // -------------------------------------------------------------------------
  // Tool output truncation (MAX_TOOL_OUTPUT_CHARS = 10000)
  // -------------------------------------------------------------------------
  describe('huge tool output truncation', () => {
    it('truncates oversized tool output in the LLM message but preserves raw output in toolResults', async () => {
      // Mock an HTTP endpoint returning ~25 KB of JSON.
      const bigArray = Array.from({ length: 1000 }, (_, i) => ({
        id: i,
        label: `item-${i}`,
        payload: 'x'.repeat(20),
      }));
      mswServer.use(
        http.get('https://api.example.com/big', () => HttpResponse.json({ items: bigArray })),
      );

      // Iteration 1: LLM requests http tool → huge response
      openAiQueue.push(
        toolCallResponse([
          {
            id: 't1',
            name: 'inst_http',
            arguments: { method: 'GET', url: 'https://api.example.com/big' },
          },
        ]),
      );
      // Iteration 2: LLM wraps up
      openAiQueue.push(textResponse('received big list'));

      const result = await runFlow({
        nodes: [
          baseAgent({
            addedTools: [
              {
                instanceId: 'inst_http',
                toolId: 'http.request',
                name: 'HTTP',
                description: 'http',
                params: {},
              },
            ],
          }),
        ],
        edges: [],
      });

      expect(result.status).toBe(FlowRunStatus.SUCCESS);

      const out = getAgentOutput(result)!;
      // Raw output preserved
      const rawOutput = out.toolResults[0].output as { data: { items: unknown[] } };
      expect(rawOutput.data.items).toHaveLength(1000);

      // The tool-result message sent to the LLM on iteration 2 must have
      // been truncated with the truncation notice.
      expect(capturedOpenAiRequests).toHaveLength(2);
      const secondReqMsgs = capturedOpenAiRequests[1].messages as Array<{
        role: string;
        content: string;
      }>;
      const toolMsg = secondReqMsgs.find((m) => m.role === 'tool');
      expect(toolMsg).toBeDefined();
      expect(toolMsg!.content).toContain('[Output truncated');
      // Content is capped — well below the raw 25KB size.
      expect(toolMsg!.content.length).toBeLessThan(12_000);
    });
  });

  // -------------------------------------------------------------------------
  // Tool-level HTTP timeout — two ways the agent can bound a slow tool call:
  //
  //   1. The http.request action's own `timeout` param (per-request ceiling).
  //   2. The agent's `toolTimeoutMs`, which aborts via `context.abortSignal`
  //      composed into the fetch signal by http.request.
  // -------------------------------------------------------------------------
  describe('tool-level HTTP timeout', () => {
    it('returns a tool error when a slow HTTP endpoint exceeds the request timeout', async () => {
      mswServer.use(
        http.get('https://api.example.com/slow', async () => {
          await delay(2000);
          return HttpResponse.json({ ok: true });
        }),
      );

      openAiQueue.push(
        toolCallResponse([
          {
            id: 't1',
            name: 'inst_http',
            arguments: {
              method: 'GET',
              url: 'https://api.example.com/slow',
              timeout: 200,
            },
          },
        ]),
      );
      openAiQueue.push(textResponse('gave up waiting'));

      const result = await runFlow({
        nodes: [
          baseAgent({
            addedTools: [
              {
                instanceId: 'inst_http',
                toolId: 'http.request',
                name: 'HTTP',
                description: 'http',
                params: {},
              },
            ],
          }),
        ],
        edges: [],
      });

      expect(result.status).toBe(FlowRunStatus.SUCCESS);

      const out = getAgentOutput(result)!;
      expect(out.toolResults).toHaveLength(1);
      expect(out.toolResults[0].success).toBe(false);
      expect(out.toolResults[0].error ?? '').toMatch(/time/i);
      // Tool execution should return well before the 2s MSW delay completes.
      expect(out.toolResults[0].executionTimeMs).toBeLessThan(1500);
    });

    it('aborts a slow tool via agent-level toolTimeoutMs (context.abortSignal)', async () => {
      mswServer.use(
        http.get('https://api.example.com/very-slow', async () => {
          await delay(2000);
          return HttpResponse.json({ ok: true });
        }),
      );

      openAiQueue.push(
        toolCallResponse([
          {
            id: 't1',
            name: 'inst_http',
            // NOTE: no per-request timeout — the agent must be the one
            // killing this via context.abortSignal.
            arguments: { method: 'GET', url: 'https://api.example.com/very-slow' },
          },
        ]),
      );
      openAiQueue.push(textResponse('gave up waiting'));

      const result = await runFlow({
        nodes: [
          baseAgent({
            toolTimeoutMs: 200,
            addedTools: [
              {
                instanceId: 'inst_http',
                toolId: 'http.request',
                name: 'HTTP',
                description: 'http',
                params: {},
              },
            ],
          }),
        ],
        edges: [],
      });

      expect(result.status).toBe(FlowRunStatus.SUCCESS);

      const out = getAgentOutput(result)!;
      expect(out.toolResults).toHaveLength(1);
      expect(out.toolResults[0].success).toBe(false);
      expect(out.toolResults[0].error ?? '').toMatch(/time|cancel|abort/i);
      expect(out.toolResults[0].executionTimeMs).toBeLessThan(1500);
    });
  });

  // -------------------------------------------------------------------------
  // Parallel tool calls with mixed outcomes
  // -------------------------------------------------------------------------
  describe('parallel tool calls', () => {
    it('one tool failure does not prevent sibling tools from completing', async () => {
      // Parallel: one valid math, one with invalid arguments (will fail Zod)
      openAiQueue.push(
        toolCallResponse([
          { id: 'c1', name: 'inst_math', arguments: { expression: '10 * 10' } },
          { id: 'c2', name: 'inst_math', arguments: { expression: '' } },
        ]),
      );
      openAiQueue.push(textResponse('done with parallel'));

      const result = await runFlow({
        nodes: [baseAgent({ enableParallelTools: true })],
        edges: [],
      });

      expect(result.status).toBe(FlowRunStatus.SUCCESS);

      const out = getAgentOutput(result)!;
      expect(out.toolResults).toHaveLength(2);

      const good = out.toolResults.find((r) => r.success);
      const bad = out.toolResults.find((r) => !r.success);
      expect(good?.output).toBe(100);
      expect(bad?.error).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // max_iterations with tool calls still pending
  // -------------------------------------------------------------------------
  describe('max_iterations safety limit', () => {
    it('halts with finishReason=max_iterations when LLM keeps requesting tools', async () => {
      // Three queued tool calls but maxIterations is 2 — the second call's
      // result will be sent, the agent will request a third call, then hit
      // the ceiling.
      for (let i = 0; i < 4; i++) {
        openAiQueue.push(
          toolCallResponse([
            { id: `c${i}`, name: 'inst_math', arguments: { expression: `${i} + 1` } },
          ]),
        );
      }

      const result = await runFlow({
        nodes: [baseAgent({ maxIterations: 2 })],
        edges: [],
      });

      // Max-iterations is not a node failure — the agent returns a result
      // with finishReason=max_iterations and the flow succeeds.
      expect(result.status).toBe(FlowRunStatus.SUCCESS);
      const out = getAgentOutput(result)!;
      expect(out.finishReason).toBe('max_iterations');
      expect(out.iterations).toBe(2);
    });
  });
});
