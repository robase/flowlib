/**
 * Integration tests: Complex end-to-end flows
 *
 * Exercises multi-node flows that combine input → transform → HTTP →
 * branching → agent (with tools) → downstream template/output, all
 * against a real Flowlib core. External HTTP (OpenAI + arbitrary APIs)
 * is mocked via MSW.
 *
 * The goal is to catch regressions that only surface when many subsystems
 * interact: template resolution across a long chain, agent output
 * feeding if/else, skipped branches not running their agent nodes,
 * multiple HTTP calls with per-node credentials, etc.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { respondWithChatCompletion } from '../helpers/openai-sse';
import { http, HttpResponse } from 'msw';
import { FlowRunStatus } from '../../../src';
import type { FlowlibInstance } from '../../../src/api/types';
import type { FlowlibDefinition } from '../../../src/services/flow-versions/schemas-fresh';
import type { AgentExecutionOutput } from '../../../src/types/agent-tool.types';
import { createTestFlowlib } from '../helpers/test-flowlib';

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
  calls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>,
  content = '',
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
          content: content || null,
          tool_calls: calls.map((c) => ({
            id: c.id,
            type: 'function',
            function: { name: c.name, arguments: JSON.stringify(c.arguments) },
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

let flowlib: FlowlibInstance;
let credentialId: string;
let openAiQueue: Array<Record<string, unknown>> = [];
let capturedOpenAiRequests: Array<Record<string, unknown>> = [];

const mswServer = setupServer(
  http.post('https://api.openai.com/v1/chat/completions', async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    capturedOpenAiRequests.push(body);
    const next = openAiQueue.shift();
    const payload = next ?? textResponse('[No more queued responses]');
    return respondWithChatCompletion(body, payload);
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
  flowlib = await createTestFlowlib();

  const cred = await flowlib.credentials.create({
    name: 'Test OpenAI',
    type: 'llm',
    authType: 'apiKey',
    config: { apiKey: 'sk-test-key-for-msw', provider: 'openai' },
    description: 'MSW-mocked OpenAI credential',
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
// Shared helpers
// ---------------------------------------------------------------------------

async function runFlow(definition: FlowlibDefinition, inputs: Record<string, unknown> = {}) {
  const flow = await flowlib.flows.create({ name: `complex-${Date.now()}-${Math.random()}` });
  await flowlib.versions.create(flow.id, { flowlibDefinition: definition });
  return flowlib.runs.start(flow.id, inputs, { useBatchProcessing: false });
}

function getNodeOutput(result: { outputs?: Record<string, unknown> }, nodeId: string): unknown {
  const node = result.outputs?.[nodeId] as
    | { data: { variables: Record<string, { value?: unknown }> } }
    | undefined;
  const raw = node?.data?.variables?.output?.value;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}

function getAgentOutput(
  result: { outputs?: Record<string, unknown> },
  nodeId: string,
): AgentExecutionOutput | undefined {
  const node = result.outputs?.[nodeId] as
    | { data: { variables: Record<string, { value?: unknown }> } }
    | undefined;
  return node?.data?.variables?.output?.value as AgentExecutionOutput | undefined;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Complex end-to-end flows', () => {
  // -------------------------------------------------------------------------
  // Full pipeline: input → http → javascript → agent(with tools) → branch →
  //                model → template → output
  // -------------------------------------------------------------------------
  describe('multi-stage pipeline with agents + HTTP + branching', () => {
    it('runs a full seven-node pipeline and routes through the agent branch', async () => {
      mswServer.use(
        http.get('https://api.example.com/users', () =>
          HttpResponse.json({
            users: [
              { id: 1, name: 'Alice', score: 92 },
              { id: 2, name: 'Bob', score: 40 },
            ],
          }),
        ),
      );

      // Agent iteration 1: asks math tool to compute an average
      openAiQueue.push(
        toolCallResponse([
          { id: 'c1', name: 'inst_math', arguments: { expression: '(92 + 40) / 2' } },
        ]),
      );
      // Agent iteration 2: final text
      openAiQueue.push(textResponse('Average score is 66.'));
      // Model node (downstream of branch)
      openAiQueue.push(textResponse('High performers: 1'));

      const result = await runFlow({
        nodes: [
          {
            id: 'input',
            type: 'trigger.manual',
            referenceId: 'req',
            params: {
              inputs: [
                {
                  name: 'req',
                  type: 'json',
                  defaultValue: { endpoint: 'https://api.example.com/users' },
                },
              ],
            },
            position: { x: 0, y: 0 },
          },
          {
            id: 'fetch',
            type: 'http.request',
            referenceId: 'fetch',
            params: {
              method: 'GET',
              url: '{{ req.endpoint }}',
              timeout: 5000,
            },
            position: { x: 200, y: 0 },
          },
          {
            id: 'transform',
            type: 'core.javascript',
            referenceId: 'transform',
            params: {
              code: 'return { users: fetch.data.users, highCount: fetch.data.users.filter(u => u.score > 50).length };',
            },
            position: { x: 400, y: 0 },
          },
          {
            id: 'agent',
            type: 'core.agent',
            referenceId: 'analysis',
            params: {
              credentialId,
              model: 'gpt-4o-mini',
              provider: 'OPENAI',
              taskPrompt: 'Analyze these users: {{ transform }}',
              systemPrompt: 'You analyze user data.',
              addedTools: [
                {
                  instanceId: 'inst_math',
                  toolId: 'math_eval',
                  name: 'Math Evaluate',
                  description: 'Evaluate math',
                  params: {},
                },
              ],
              maxIterations: 5,
              stopCondition: 'explicit_stop',
              temperature: 0,
              enableParallelTools: false,
            },
            position: { x: 600, y: 0 },
          },
          {
            id: 'branch',
            type: 'core.if_else',
            referenceId: 'branch',
            params: {
              expression: 'transform.highCount > 0',
            },
            position: { x: 800, y: 0 },
          },
          {
            id: 'summarize',
            type: 'core.model',
            referenceId: 'summary',
            params: {
              credentialId,
              model: 'gpt-4o-mini',
              provider: 'OPENAI',
              prompt: 'Summarize in one line: {{ analysis.finalResponse }}',
              temperature: 0,
            },
            position: { x: 1000, y: -100 },
          },
          {
            id: 'none',
            type: 'core.template_string',
            referenceId: 'none',
            params: { template: 'no high performers' },
            position: { x: 1000, y: 100 },
          },
        ],
        edges: [
          { id: 'e1', source: 'input', target: 'fetch' },
          { id: 'e2', source: 'fetch', target: 'transform' },
          { id: 'e3', source: 'transform', target: 'agent' },
          // Branch has two direct parents so both `transform` and `analysis`
          // show up in its incoming data.
          { id: 'e4', source: 'agent', target: 'branch' },
          { id: 'e4b', source: 'transform', target: 'branch' },
          { id: 'e5', source: 'branch', target: 'summarize', sourceHandle: 'true_output' },
          { id: 'e6', source: 'branch', target: 'none', sourceHandle: 'false_output' },
        ],
      });

      expect(result.status).toBe(FlowRunStatus.SUCCESS);

      // Agent ran the tool and produced a final response
      const agentOut = getAgentOutput(result, 'agent')!;
      expect(agentOut.iterations).toBe(2);
      expect(agentOut.toolResults).toHaveLength(1);
      expect(agentOut.toolResults[0].success).toBe(true);
      expect(agentOut.toolResults[0].output).toBe(66);
      expect(agentOut.finalResponse).toContain('66');

      // True branch executed — false branch did not
      expect(getNodeOutput(result, 'summarize')).toBe('High performers: 1');
      expect(getNodeOutput(result, 'none')).toBeUndefined();

      // Agent prompt saw the resolved transform data
      const firstAgentReq = capturedOpenAiRequests[0];
      const msgs = firstAgentReq.messages as Array<{ role: string; content: string }>;
      const userMsg = msgs.find((m) => m.role === 'user');
      expect(userMsg?.content).toContain('Alice');
      expect(userMsg?.content).toContain('92');
    });

    it('routes through the false branch and skips the model node entirely', async () => {
      mswServer.use(
        http.get('https://api.example.com/users', () =>
          HttpResponse.json({ users: [{ id: 1, name: 'Zoe', score: 10 }] }),
        ),
      );

      openAiQueue.push(textResponse('No strong performers detected.'));

      const result = await runFlow({
        nodes: [
          {
            id: 'fetch',
            type: 'http.request',
            referenceId: 'fetch',
            params: { method: 'GET', url: 'https://api.example.com/users', timeout: 5000 },
            position: { x: 0, y: 0 },
          },
          {
            id: 'transform',
            type: 'core.javascript',
            referenceId: 'transform',
            params: {
              code: 'return { highCount: fetch.data.users.filter(u => u.score > 50).length };',
            },
            position: { x: 200, y: 0 },
          },
          {
            id: 'agent',
            type: 'core.agent',
            referenceId: 'analysis',
            params: {
              credentialId,
              model: 'gpt-4o-mini',
              provider: 'OPENAI',
              taskPrompt: 'Analyze: {{ transform }}',
              systemPrompt: '',
              addedTools: [],
              maxIterations: 3,
              stopCondition: 'explicit_stop',
              temperature: 0,
              enableParallelTools: false,
            },
            position: { x: 400, y: 0 },
          },
          {
            id: 'branch',
            type: 'core.if_else',
            referenceId: 'branch',
            params: { expression: 'transform.highCount > 0' },
            position: { x: 600, y: 0 },
          },
          {
            id: 'hi',
            type: 'core.model',
            referenceId: 'hi',
            params: {
              credentialId,
              model: 'gpt-4o-mini',
              provider: 'OPENAI',
              prompt: 'should not run',
              temperature: 0,
            },
            position: { x: 800, y: -100 },
          },
          {
            id: 'lo',
            type: 'core.template_string',
            referenceId: 'lo',
            params: { template: 'none above threshold' },
            position: { x: 800, y: 100 },
          },
        ],
        edges: [
          { id: 'e1', source: 'fetch', target: 'transform' },
          { id: 'e2', source: 'transform', target: 'agent' },
          { id: 'e3', source: 'agent', target: 'branch' },
          { id: 'e3b', source: 'transform', target: 'branch' },
          { id: 'e4', source: 'branch', target: 'hi', sourceHandle: 'true_output' },
          { id: 'e5', source: 'branch', target: 'lo', sourceHandle: 'false_output' },
        ],
      });

      expect(result.status).toBe(FlowRunStatus.SUCCESS);
      expect(getNodeOutput(result, 'lo')).toBe('none above threshold');

      // The expensive model node must have been skipped, not called.
      expect(getNodeOutput(result, 'hi')).toBeUndefined();
      // Only the agent's single call should have reached OpenAI — not the skipped model.
      expect(capturedOpenAiRequests).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // Switch routing with agents in multiple branches
  // -------------------------------------------------------------------------
  describe('switch routing with agent branches', () => {
    it('only executes the matched case branch; other agent branches are skipped', async () => {
      openAiQueue.push(textResponse('Urgent ticket handled.'));

      const result = await runFlow(
        {
          nodes: [
            {
              id: 'input',
              type: 'trigger.manual',
              referenceId: 'ticket',
              params: {
                inputs: [
                  {
                    name: 'ticket',
                    type: 'json',
                    defaultValue: { priority: 'high', body: 'server down' },
                  },
                ],
              },
              position: { x: 0, y: 0 },
            },
            {
              id: 'switch',
              type: 'core.switch',
              referenceId: 'route',
              params: {
                cases: [
                  {
                    slug: 'urgent',
                    label: 'Urgent',
                    expression: 'ticket.priority === "high"',
                  },
                  {
                    slug: 'normal',
                    label: 'Normal',
                    expression: 'ticket.priority === "normal"',
                  },
                ],
              },
              position: { x: 200, y: 0 },
            },
            {
              id: 'urgent_agent',
              type: 'core.agent',
              referenceId: 'urgent_agent',
              params: {
                credentialId,
                model: 'gpt-4o-mini',
                provider: 'OPENAI',
                taskPrompt: 'Handle urgent ticket: {{ ticket.body }}',
                systemPrompt: '',
                addedTools: [],
                maxIterations: 2,
                stopCondition: 'explicit_stop',
                temperature: 0,
                enableParallelTools: false,
              },
              position: { x: 400, y: -100 },
            },
            {
              id: 'normal_agent',
              type: 'core.agent',
              referenceId: 'normal_agent',
              params: {
                credentialId,
                model: 'gpt-4o-mini',
                provider: 'OPENAI',
                taskPrompt: 'Handle normal: {{ ticket.body }}',
                systemPrompt: '',
                addedTools: [],
                maxIterations: 2,
                stopCondition: 'explicit_stop',
                temperature: 0,
                enableParallelTools: false,
              },
              position: { x: 400, y: 100 },
            },
          ],
          edges: [
            { id: 'e1', source: 'input', target: 'switch' },
            {
              id: 'e2',
              source: 'switch',
              target: 'urgent_agent',
              sourceHandle: 'urgent',
            },
            {
              id: 'e3',
              source: 'switch',
              target: 'normal_agent',
              sourceHandle: 'normal',
            },
          ],
        },
        {},
      );

      expect(result.status).toBe(FlowRunStatus.SUCCESS);

      const urgent = getAgentOutput(result, 'urgent_agent');
      expect(urgent?.finalResponse).toBe('Urgent ticket handled.');

      // The unselected case's agent must not have executed.
      expect(getAgentOutput(result, 'normal_agent')).toBeUndefined();

      // Only one LLM call — normal branch must not have hit the API.
      expect(capturedOpenAiRequests).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // Agent chaining: output of agent 1 → input of agent 2
  // -------------------------------------------------------------------------
  describe('chained agents', () => {
    it('passes finalResponse from agent 1 to agent 2 via templates', async () => {
      // Agent 1 response
      openAiQueue.push(textResponse('42'));
      // Agent 2 receives the first agent's answer and confirms
      openAiQueue.push(textResponse('Confirmed: 42'));

      const result = await runFlow({
        nodes: [
          {
            id: 'a1',
            type: 'core.agent',
            referenceId: 'a1',
            params: {
              credentialId,
              model: 'gpt-4o-mini',
              provider: 'OPENAI',
              taskPrompt: 'Give a number',
              systemPrompt: '',
              addedTools: [],
              maxIterations: 2,
              stopCondition: 'explicit_stop',
              temperature: 0,
              enableParallelTools: false,
            },
            position: { x: 0, y: 0 },
          },
          {
            id: 'a2',
            type: 'core.agent',
            referenceId: 'a2',
            params: {
              credentialId,
              model: 'gpt-4o-mini',
              provider: 'OPENAI',
              taskPrompt: 'Confirm this value: {{ a1.finalResponse }}',
              systemPrompt: '',
              addedTools: [],
              maxIterations: 2,
              stopCondition: 'explicit_stop',
              temperature: 0,
              enableParallelTools: false,
            },
            position: { x: 200, y: 0 },
          },
        ],
        edges: [{ id: 'e1', source: 'a1', target: 'a2' }],
      });

      expect(result.status).toBe(FlowRunStatus.SUCCESS);

      const a2 = getAgentOutput(result, 'a2')!;
      expect(a2.finalResponse).toBe('Confirmed: 42');

      // Second agent's user prompt must contain the first agent's answer
      const secondAgentReq = capturedOpenAiRequests[1];
      const msgs = secondAgentReq.messages as Array<{ role: string; content: string }>;
      const userMsg = msgs.find((m) => m.role === 'user');
      expect(userMsg?.content).toContain('42');
    });
  });

  // -------------------------------------------------------------------------
  // Agent calls third-party action (HTTP) as a tool
  // -------------------------------------------------------------------------
  describe('agent uses third-party action as a tool', () => {
    it('agent calls http.request through the tool bridge and gets real response data', async () => {
      mswServer.use(
        http.get('https://api.example.com/weather', () =>
          HttpResponse.json({ temp: 72, condition: 'sunny' }, { status: 200 }),
        ),
      );

      // Agent requests the HTTP tool, then wraps up
      openAiQueue.push(
        toolCallResponse([
          {
            id: 't1',
            name: 'inst_http',
            arguments: {
              method: 'GET',
              url: 'https://api.example.com/weather',
            },
          },
        ]),
      );
      openAiQueue.push(textResponse('The weather is sunny at 72F.'));

      const result = await runFlow({
        nodes: [
          {
            id: 'agent',
            type: 'core.agent',
            referenceId: 'agent',
            params: {
              credentialId,
              model: 'gpt-4o-mini',
              provider: 'OPENAI',
              taskPrompt: 'Check the weather',
              systemPrompt: '',
              addedTools: [
                {
                  instanceId: 'inst_http',
                  toolId: 'http.request',
                  name: 'HTTP Request',
                  description: 'Make HTTP requests',
                  params: {},
                },
              ],
              maxIterations: 3,
              stopCondition: 'explicit_stop',
              temperature: 0,
              enableParallelTools: false,
            },
            position: { x: 0, y: 0 },
          },
        ],
        edges: [],
      });

      expect(result.status).toBe(FlowRunStatus.SUCCESS);

      const out = getAgentOutput(result, 'agent')!;
      expect(out.toolResults).toHaveLength(1);
      expect(out.toolResults[0].success).toBe(true);

      const toolOut = out.toolResults[0].output as {
        data: { temp: number; condition: string };
        status: number;
      };
      expect(toolOut.data.condition).toBe('sunny');
      expect(toolOut.status).toBe(200);
    });

    it('agent retries when an HTTP tool returns a transient 500', async () => {
      let calls = 0;
      mswServer.use(
        http.get('https://api.example.com/flaky', () => {
          calls++;
          if (calls === 1) {
            return HttpResponse.json({ error: 'transient' }, { status: 500 });
          }
          return HttpResponse.json({ ok: true });
        }),
      );

      // Iteration 1: agent calls HTTP, gets 500 (tool succeeds at the network
      // level but response.ok is false; the agent sees the structured result).
      openAiQueue.push(
        toolCallResponse([
          {
            id: 't1',
            name: 'inst_http',
            arguments: { method: 'GET', url: 'https://api.example.com/flaky' },
          },
        ]),
      );
      // Iteration 2: agent retries
      openAiQueue.push(
        toolCallResponse([
          {
            id: 't2',
            name: 'inst_http',
            arguments: { method: 'GET', url: 'https://api.example.com/flaky' },
          },
        ]),
      );
      // Iteration 3: agent wraps up
      openAiQueue.push(textResponse('Got it after retry.'));

      const result = await runFlow({
        nodes: [
          {
            id: 'agent',
            type: 'core.agent',
            referenceId: 'agent',
            params: {
              credentialId,
              model: 'gpt-4o-mini',
              provider: 'OPENAI',
              taskPrompt: 'Fetch flaky',
              systemPrompt: '',
              addedTools: [
                {
                  instanceId: 'inst_http',
                  toolId: 'http.request',
                  name: 'HTTP Request',
                  description: 'Make HTTP requests',
                  params: {},
                },
              ],
              maxIterations: 4,
              stopCondition: 'explicit_stop',
              temperature: 0,
              enableParallelTools: false,
            },
            position: { x: 0, y: 0 },
          },
        ],
        edges: [],
      });

      expect(result.status).toBe(FlowRunStatus.SUCCESS);
      expect(calls).toBe(2);

      const out = getAgentOutput(result, 'agent')!;
      expect(out.toolResults).toHaveLength(2);
      // First call succeeded at the HTTP level (fetch didn't throw) but returned 500.
      const first = out.toolResults[0].output as { status: number; ok: boolean };
      expect(first.status).toBe(500);
      expect(first.ok).toBe(false);
      // Second call succeeded.
      const second = out.toolResults[1].output as { status: number; ok: boolean };
      expect(second.status).toBe(200);
      expect(second.ok).toBe(true);
    });
  });
});
