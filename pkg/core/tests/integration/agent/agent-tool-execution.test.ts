/**
 * Integration tests: Agent Node + Tool Execution
 *
 * Tests the AGENT node through the full flow execution pipeline with
 * MSW intercepting OpenAI API calls. Covers:
 *
 * - Basic agent text response (no tool use)
 * - Single tool call → tool execution → final response
 * - Multi-iteration tool loop (call tool, get result, call again)
 * - Parallel tool calls in a single response
 * - Stop conditions: explicit_stop, tool_result, max_iterations
 * - Error handling: invalid tool, tool execution failure, missing credential
 * - Agent with upstream data (template resolution in task prompt)
 * - Tool execution recording in database
 * - Conversation history tracking
 * - Max iterations safety limit
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { respondWithChatCompletion } from '../helpers/openai-sse';
import { FlowRunStatus } from '../../../src';
import type { FlowlibInstance } from '../../../src/api/types';
import type { FlowlibDefinition } from '../../../src/services/flow-versions/schemas-fresh';
import type { AgentExecutionOutput } from '../../../src/types/agent-tool.types';
import { createTestFlowlib } from '../helpers/test-flowlib';

// ---------------------------------------------------------------------------
// MSW helpers — build OpenAI-shaped responses
// ---------------------------------------------------------------------------

/** Standard OpenAI chat completion with text only */
function textResponse(content: string) {
  return {
    id: `chatcmpl-${Date.now()}`,
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

/** OpenAI chat completion requesting one or more tool calls */
function toolCallResponse(
  calls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>,
  content: string = '',
) {
  return {
    id: `chatcmpl-${Date.now()}`,
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
// Shared state
// ---------------------------------------------------------------------------

let flowlib: FlowlibInstance;
let credentialId: string;
/** Ordered list of responses the mock server should return */
let responseQueue: Array<Record<string, unknown>> = [];
/** Request bodies captured for inspection */
let capturedRequests: Array<Record<string, unknown>> = [];

const mswServer = setupServer(
  http.post('https://api.openai.com/v1/chat/completions', async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    capturedRequests.push(body);

    const next = responseQueue.shift();
    const payload = next ?? textResponse('No more queued responses');
    return respondWithChatCompletion(body, payload);
  }),
  // Models endpoint (called during adapter registration validation)
  http.get('https://api.openai.com/v1/models', () => {
    return HttpResponse.json({
      object: 'list',
      data: [{ id: 'gpt-4o-mini', object: 'model', owned_by: 'openai' }],
    });
  }),
);

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  mswServer.listen({ onUnhandledRequest: 'bypass' });
  flowlib = await createTestFlowlib();

  // Create an OpenAI credential for agent tests
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
  responseQueue = [];
  capturedRequests = [];
});

afterEach(() => {
  mswServer.resetHandlers();
});

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
      taskPrompt: 'Do the task',
      systemPrompt: 'You are a helpful assistant.',
      addedTools: [
        {
          instanceId: 'inst_math',
          toolId: 'math_eval',
          name: 'Math Evaluate',
          description: 'Evaluate math expressions',
          params: {},
        },
      ],
      maxIterations: 10,
      stopCondition: 'explicit_stop',
      temperature: 0,
      enableParallelTools: true,
      ...overrides,
    },
    position: { x: 200, y: 200 },
  };
}

async function runAgentFlow(definition: FlowlibDefinition, inputs: Record<string, unknown> = {}) {
  const flow = await flowlib.flows.create({ name: `agent-test-${Date.now()}` });
  await flowlib.versions.create(flow.id, { flowlibDefinition: definition });
  return flowlib.runs.start(flow.id, inputs, { useBatchProcessing: false });
}

function getAgentOutput(
  result: { outputs?: Record<string, unknown> },
  nodeId = 'agent-1',
): AgentExecutionOutput | undefined {
  const node = result.outputs?.[nodeId] as
    | { data: { variables: Record<string, { value?: unknown }> } }
    | undefined;
  return node?.data?.variables?.output?.value as AgentExecutionOutput | undefined;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Agent Node + Tool Execution', () => {
  // -------------------------------------------------------------------------
  // Basic text response — no tool use
  // -------------------------------------------------------------------------
  describe('text-only responses', () => {
    it('should return a text response when LLM does not call tools', async () => {
      responseQueue.push(textResponse('The answer is 42.'));

      const result = await runAgentFlow({
        nodes: [agentNode()],
        edges: [],
      });

      expect(result.status).toBe(FlowRunStatus.SUCCESS);

      const output = getAgentOutput(result);
      expect(output).toBeDefined();
      expect(output!.finalResponse).toBe('The answer is 42.');
      expect(output!.iterations).toBe(1);
      expect(output!.finishReason).toBe('completed');
      expect(output!.toolResults).toHaveLength(0);
    });

    it('should include conversation history in output', async () => {
      responseQueue.push(textResponse('Hello!'));

      const result = await runAgentFlow({
        nodes: [agentNode()],
        edges: [],
      });

      const output = getAgentOutput(result)!;
      expect(output.conversationHistory).toBeDefined();
      expect(output.conversationHistory.length).toBeGreaterThanOrEqual(2);
      // First message is the user's task prompt
      expect(output.conversationHistory[0].role).toBe('user');
      // Last message is the assistant's response
      const last = output.conversationHistory[output.conversationHistory.length - 1];
      expect(last.role).toBe('assistant');
      expect(last.content).toBe('Hello!');
    });
  });

  // -------------------------------------------------------------------------
  // Single tool call round-trip
  // -------------------------------------------------------------------------
  describe('single tool call', () => {
    it('should call math_eval tool and return final response', async () => {
      // LLM requests math tool
      responseQueue.push(
        toolCallResponse([{ id: 'call_1', name: 'inst_math', arguments: { expression: '6 * 7' } }]),
      );
      // After receiving the tool result, LLM produces final text
      responseQueue.push(textResponse('The result of 6 * 7 is 42.'));

      const result = await runAgentFlow({
        nodes: [agentNode()],
        edges: [],
      });

      expect(result.status).toBe(FlowRunStatus.SUCCESS);

      const output = getAgentOutput(result)!;
      expect(output.finalResponse).toBe('The result of 6 * 7 is 42.');
      expect(output.iterations).toBe(2);
      expect(output.toolResults).toHaveLength(1);
      expect(output.toolResults[0].toolId).toBe('inst_math');
      expect(output.toolResults[0].success).toBe(true);
      expect(output.toolResults[0].output).toBe(42);
    });

    it('should send tool result back to LLM in correct message format', async () => {
      responseQueue.push(
        toolCallResponse([
          { id: 'call_math', name: 'inst_math', arguments: { expression: '2 + 3' } },
        ]),
      );
      responseQueue.push(textResponse('5'));

      await runAgentFlow({
        nodes: [agentNode()],
        edges: [],
      });

      // Second request should contain the tool result message
      expect(capturedRequests).toHaveLength(2);
      const secondReq = capturedRequests[1];
      const messages = secondReq.messages as Array<Record<string, unknown>>;

      // Should have: system?, user, assistant (with tool_calls), tool (result)
      const toolMsg = messages.find((m) => m.role === 'tool');
      expect(toolMsg).toBeDefined();
      expect(toolMsg!.tool_call_id).toBe('call_math');

      // Tool result content should contain the math result
      const content =
        typeof toolMsg!.content === 'string' ? toolMsg!.content : JSON.stringify(toolMsg!.content);
      expect(content).toContain('5');
    });
  });

  // -------------------------------------------------------------------------
  // Multi-iteration tool loop
  // -------------------------------------------------------------------------
  describe('multi-iteration loop', () => {
    it('should support multiple tool-call rounds before final response', async () => {
      // Iteration 1: LLM calls math
      responseQueue.push(
        toolCallResponse([{ id: 'c1', name: 'inst_math', arguments: { expression: '10 + 5' } }]),
      );
      // Iteration 2: LLM calls math again with the first result
      responseQueue.push(
        toolCallResponse([{ id: 'c2', name: 'inst_math', arguments: { expression: '15 * 2' } }]),
      );
      // Iteration 3: LLM produces final answer
      responseQueue.push(textResponse('After two calculations: 10+5=15, 15*2=30.'));

      const result = await runAgentFlow({
        nodes: [agentNode()],
        edges: [],
      });

      expect(result.status).toBe(FlowRunStatus.SUCCESS);

      const output = getAgentOutput(result)!;
      expect(output.iterations).toBe(3);
      expect(output.toolResults).toHaveLength(2);
      expect(output.toolResults[0].output).toBe(15);
      expect(output.toolResults[1].output).toBe(30);
      expect(output.finishReason).toBe('completed');
    });
  });

  // -------------------------------------------------------------------------
  // Parallel tool calls
  // -------------------------------------------------------------------------
  describe('parallel tool calls', () => {
    it('should execute multiple tool calls from a single LLM response', async () => {
      // LLM requests two math evaluations at once
      responseQueue.push(
        toolCallResponse([
          { id: 'p1', name: 'inst_math', arguments: { expression: '3 + 4' } },
          { id: 'p2', name: 'inst_math', arguments: { expression: '10 - 2' } },
        ]),
      );
      responseQueue.push(textResponse('Results: 7 and 8.'));

      const result = await runAgentFlow({
        nodes: [agentNode({ enableParallelTools: true })],
        edges: [],
      });

      expect(result.status).toBe(FlowRunStatus.SUCCESS);

      const output = getAgentOutput(result)!;
      expect(output.toolResults).toHaveLength(2);

      const results = output.toolResults.map((r) => r.output);
      expect(results).toContain(7);
      expect(results).toContain(8);
    });

    it('should send all parallel tool results back in the same request', async () => {
      responseQueue.push(
        toolCallResponse([
          { id: 'pa', name: 'inst_math', arguments: { expression: '1+1' } },
          { id: 'pb', name: 'inst_math', arguments: { expression: '2+2' } },
        ]),
      );
      responseQueue.push(textResponse('Done'));

      await runAgentFlow({
        nodes: [agentNode({ enableParallelTools: true })],
        edges: [],
      });

      // The second request should contain both tool result messages
      const secondReq = capturedRequests[1];
      const messages = secondReq.messages as Array<Record<string, unknown>>;
      const toolMessages = messages.filter((m) => m.role === 'tool');
      expect(toolMessages).toHaveLength(2);

      const toolCallIds = toolMessages.map((m) => m.tool_call_id);
      expect(toolCallIds).toContain('pa');
      expect(toolCallIds).toContain('pb');
    });
  });

  // -------------------------------------------------------------------------
  // Stop conditions
  // -------------------------------------------------------------------------
  describe('stop conditions', () => {
    it('explicit_stop: should loop until LLM responds with text (no tools)', async () => {
      // First iteration: tool call
      responseQueue.push(
        toolCallResponse([{ id: 'es1', name: 'inst_math', arguments: { expression: '1+1' } }]),
      );
      // Second iteration: text response → stops the loop
      responseQueue.push(textResponse('All done.'));

      const result = await runAgentFlow({
        nodes: [agentNode({ stopCondition: 'explicit_stop' })],
        edges: [],
      });

      const output = getAgentOutput(result)!;
      expect(output.finishReason).toBe('completed');
      expect(output.iterations).toBe(2);
    });

    it('tool_result: should stop after the first tool execution', async () => {
      responseQueue.push(
        toolCallResponse([{ id: 'tr1', name: 'inst_math', arguments: { expression: '9 * 9' } }]),
      );
      // Should NOT be consumed — loop stops after tool result
      responseQueue.push(textResponse('Should not reach here'));

      const result = await runAgentFlow({
        nodes: [agentNode({ stopCondition: 'tool_result' })],
        edges: [],
      });

      expect(result.status).toBe(FlowRunStatus.SUCCESS);

      const output = getAgentOutput(result)!;
      expect(output.finishReason).toBe('tool_result');
      expect(output.iterations).toBe(1);
      expect(output.toolResults).toHaveLength(1);
      expect(output.toolResults[0].output).toBe(81);

      // Verify the second response was NOT consumed
      expect(responseQueue).toHaveLength(1);
    });

    it('max_iterations: should stop when iteration limit is reached', async () => {
      // Fill queue with tool calls — agent should stop at maxIterations
      for (let i = 0; i < 5; i++) {
        responseQueue.push(
          toolCallResponse([
            { id: `mi_${i}`, name: 'inst_math', arguments: { expression: `${i}+1` } },
          ]),
        );
      }

      const result = await runAgentFlow({
        nodes: [agentNode({ maxIterations: 3, stopCondition: 'max_iterations' })],
        edges: [],
      });

      expect(result.status).toBe(FlowRunStatus.SUCCESS);

      const output = getAgentOutput(result)!;
      expect(output.finishReason).toBe('max_iterations');
      expect(output.iterations).toBe(3);
      // Should have executed tools from the 3 iterations
      expect(output.toolResults.length).toBeLessThanOrEqual(3);
    });

    it('explicit_stop with maxIterations: should cap at limit even if LLM keeps calling tools', async () => {
      // LLM keeps calling tools indefinitely
      for (let i = 0; i < 10; i++) {
        responseQueue.push(
          toolCallResponse([
            { id: `cap_${i}`, name: 'inst_math', arguments: { expression: `${i}` } },
          ]),
        );
      }

      const result = await runAgentFlow({
        nodes: [agentNode({ stopCondition: 'explicit_stop', maxIterations: 2 })],
        edges: [],
      });

      expect(result.status).toBe(FlowRunStatus.SUCCESS);

      const output = getAgentOutput(result)!;
      expect(output.iterations).toBeLessThanOrEqual(2);
      expect(output.finishReason).toBe('max_iterations');
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------
  describe('error handling', () => {
    it('should handle tool execution failure gracefully', async () => {
      // math_eval with invalid expression
      responseQueue.push(
        toolCallResponse([
          {
            id: 'err1',
            name: 'inst_math',
            arguments: { expression: 'not_valid_math!!!' },
          },
        ]),
      );
      // After tool error, LLM should receive error message and respond
      responseQueue.push(textResponse('The math expression was invalid.'));

      const result = await runAgentFlow({
        nodes: [agentNode()],
        edges: [],
      });

      // The flow should still succeed — tool errors are handled within the loop
      expect(result.status).toBe(FlowRunStatus.SUCCESS);

      const output = getAgentOutput(result)!;
      expect(output.toolResults).toHaveLength(1);
      expect(output.toolResults[0].success).toBe(false);
      expect(output.toolResults[0].error).toBeDefined();
      expect(output.finalResponse).toBe('The math expression was invalid.');
    });

    it('should handle unknown tool ID from LLM', async () => {
      responseQueue.push(
        toolCallResponse([
          {
            id: 'unk1',
            name: 'nonexistent_tool_xyz',
            arguments: { foo: 'bar' },
          },
        ]),
      );
      responseQueue.push(textResponse('That tool does not exist.'));

      const result = await runAgentFlow({
        nodes: [agentNode()],
        edges: [],
      });

      // Flow should still succeed — unknown tools produce an error result
      expect(result.status).toBe(FlowRunStatus.SUCCESS);

      const output = getAgentOutput(result)!;
      expect(output.toolResults).toHaveLength(1);
      expect(output.toolResults[0].success).toBe(false);
    });

    it('should fail when credential is missing', async () => {
      // Omit explicit provider so the executor must look up the credential to
      // detect the provider — this forces the "credential not found" path.
      const result = await runAgentFlow({
        nodes: [
          agentNode({
            credentialId: 'non-existent-credential-id',
            provider: undefined,
          }),
        ],
        edges: [],
      });

      // Agent executor returns createErrorResult → node FAILED → flow FAILED
      expect(result.status).toBe(FlowRunStatus.FAILED);
    });

    it('should fail when task prompt is empty', async () => {
      const result = await runAgentFlow({
        nodes: [agentNode({ taskPrompt: '' })],
        edges: [],
      });

      expect(result.status).toBe(FlowRunStatus.FAILED);
    });

    it('should fail when model is empty', async () => {
      const result = await runAgentFlow({
        nodes: [agentNode({ model: '' })],
        edges: [],
      });

      expect(result.status).toBe(FlowRunStatus.FAILED);
    });
  });

  // -------------------------------------------------------------------------
  // Agent with upstream data (template resolution)
  // -------------------------------------------------------------------------
  describe('upstream data + template resolution', () => {
    it('should resolve templates in taskPrompt from upstream input node', async () => {
      responseQueue.push(textResponse('Processed the user question.'));

      const result = await runAgentFlow({
        nodes: [
          {
            id: 'input-1',
            type: 'core.input',
            label: 'Question',
            referenceId: 'question',
            params: { variableName: 'user_question', defaultValue: 'What is 2+2?' },
            position: { x: 0, y: 0 },
          },
          agentNode({
            taskPrompt: 'Answer this question: {{ question }}',
          }),
        ],
        edges: [{ id: 'e1', source: 'input-1', target: 'agent-1' }],
      });

      expect(result.status).toBe(FlowRunStatus.SUCCESS);

      // Verify the actual prompt sent to OpenAI contains the resolved template
      expect(capturedRequests).toHaveLength(1);
      const messages = capturedRequests[0].messages as Array<{
        role: string;
        content: string;
      }>;
      const userMsg = messages.find((m) => m.role === 'user');
      expect(userMsg?.content).toContain('What is 2+2?');
    });

    it('should resolve nested object properties in templates', async () => {
      responseQueue.push(textResponse('Got the data.'));

      const result = await runAgentFlow(
        {
          nodes: [
            {
              id: 'input-1',
              type: 'core.input',
              label: 'Data',
              referenceId: 'data',
              params: {
                variableName: 'payload',
              },
              position: { x: 0, y: 0 },
            },
            {
              id: 'js-1',
              type: 'core.javascript',
              label: 'Extract',
              referenceId: 'extract',
              params: { code: '$input.data' },
              position: { x: 200, y: 0 },
            },
            agentNode({
              taskPrompt: 'Greet {{ extract }}',
            }),
          ],
          edges: [
            { id: 'e1', source: 'input-1', target: 'js-1' },
            { id: 'e2', source: 'js-1', target: 'agent-1' },
          ],
        },
        { payload: { user: { name: 'Alice', age: 30 } } },
      );

      expect(result.status).toBe(FlowRunStatus.SUCCESS);
    });
  });

  // -------------------------------------------------------------------------
  // Agent output feeding downstream nodes
  // -------------------------------------------------------------------------
  describe('downstream data flow', () => {
    it('should pass agent output to downstream template node', async () => {
      responseQueue.push(textResponse('The answer is 42'));

      const result = await runAgentFlow({
        nodes: [
          agentNode(),
          {
            id: 'template-1',
            type: 'core.template_string',
            label: 'Summary',
            referenceId: 'summary',
            params: { template: 'Agent said: {{ agent.finalResponse }}' },
            position: { x: 400, y: 200 },
          },
        ],
        edges: [{ id: 'e1', source: 'agent-1', target: 'template-1' }],
      });

      expect(result.status).toBe(FlowRunStatus.SUCCESS);

      // Check template node output contains agent's response
      const templateOutput = result.outputs?.['template-1'] as
        | { data: { variables: Record<string, { value?: unknown }> } }
        | undefined;
      const templateValue = templateOutput?.data?.variables?.output?.value;
      expect(templateValue).toContain('Agent said:');
      expect(templateValue).toContain('The answer is 42');
    });
  });

  // -------------------------------------------------------------------------
  // Tool execution persistence
  // -------------------------------------------------------------------------
  describe('execution traces', () => {
    it('should persist node execution traces for agent runs', async () => {
      responseQueue.push(
        toolCallResponse([{ id: 'trace1', name: 'inst_math', arguments: { expression: '5+5' } }]),
      );
      responseQueue.push(textResponse('Ten.'));

      const result = await runAgentFlow({
        nodes: [agentNode()],
        edges: [],
      });

      expect(result.status).toBe(FlowRunStatus.SUCCESS);

      // The flow run should have a trace for the agent node
      expect(result.traces).toBeDefined();
      const agentTrace = result.traces?.find((t) => t.nodeId === 'agent-1');
      expect(agentTrace).toBeDefined();
      expect(agentTrace!.status).toBe('SUCCESS');
    });

    it('should record tool execution metadata', async () => {
      responseQueue.push(
        toolCallResponse([{ id: 'rec1', name: 'inst_math', arguments: { expression: '7*8' } }]),
      );
      responseQueue.push(textResponse('56'));

      const result = await runAgentFlow({
        nodes: [agentNode()],
        edges: [],
      });

      const output = getAgentOutput(result)!;
      expect(output.toolResults).toHaveLength(1);

      const toolRecord = output.toolResults[0];
      expect(toolRecord.toolId).toBe('inst_math');
      expect(toolRecord.toolName).toBeTruthy();
      expect(toolRecord.input).toEqual({ expression: '7*8' });
      expect(toolRecord.output).toBe(56);
      expect(toolRecord.success).toBe(true);
      expect(toolRecord.iteration).toBeDefined();
      expect(toolRecord.executionTimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  // -------------------------------------------------------------------------
  // Multiple enabled tools
  // -------------------------------------------------------------------------
  describe('multiple tools', () => {
    it('should make multiple tool instances available to the agent', async () => {
      // LLM calls first math instance
      responseQueue.push(
        toolCallResponse([{ id: 'me1', name: 'inst_math', arguments: { expression: '25 - 18' } }]),
      );
      // Then calls second math instance
      responseQueue.push(
        toolCallResponse([{ id: 'me2', name: 'inst_math_2', arguments: { expression: '7 * 2' } }]),
      );
      // Final text
      responseQueue.push(textResponse('25 - 18 = 7, and 7 * 2 = 14.'));

      const result = await runAgentFlow({
        nodes: [
          agentNode({
            addedTools: [
              {
                instanceId: 'inst_math',
                toolId: 'math_eval',
                name: 'Math Evaluate',
                description: 'Evaluate math expressions',
                params: {},
              },
              {
                instanceId: 'inst_math_2',
                toolId: 'math_eval',
                name: 'Math Evaluate 2',
                description: 'Another math evaluator',
                params: {},
              },
            ],
          }),
        ],
        edges: [],
      });

      expect(result.status).toBe(FlowRunStatus.SUCCESS);

      const output = getAgentOutput(result)!;
      expect(output.toolResults).toHaveLength(2);

      const toolIds = output.toolResults.map((r) => r.toolId);
      expect(toolIds).toContain('inst_math');
      expect(toolIds).toContain('inst_math_2');
    });

    it('should pass enabled tool definitions to OpenAI in correct format', async () => {
      responseQueue.push(textResponse('No tools needed.'));

      await runAgentFlow({
        nodes: [
          agentNode({
            addedTools: [
              {
                instanceId: 'inst_math',
                toolId: 'math_eval',
                name: 'Math Evaluate',
                description: 'Evaluate math expressions',
                params: {},
              },
              {
                instanceId: 'inst_math_2',
                toolId: 'math_eval',
                name: 'Math Evaluate 2',
                description: 'Another math evaluator',
                params: {},
              },
            ],
          }),
        ],
        edges: [],
      });

      const req = capturedRequests[0];
      const tools = req.tools as Array<{
        type: string;
        function: { name: string; description: string; parameters: unknown };
      }>;

      expect(tools).toBeDefined();
      expect(tools.length).toBe(2);
      expect(tools.every((t) => t.type === 'function')).toBe(true);

      const toolNames = tools.map((t) => t.function.name);
      expect(toolNames).toContain('inst_math');
      expect(toolNames).toContain('inst_math_2');

      // Each tool should have a valid JSON Schema for parameters
      for (const tool of tools) {
        expect(tool.function.parameters).toBeDefined();
        expect(tool.function.description).toBeTruthy();
      }
    });
  });

  // -------------------------------------------------------------------------
  // No tools configured
  // -------------------------------------------------------------------------
  describe('no tools', () => {
    it('should work with an agent that has no tools enabled', async () => {
      responseQueue.push(textResponse('I answered without tools.'));

      const result = await runAgentFlow({
        nodes: [agentNode({ addedTools: [] })],
        edges: [],
      });

      expect(result.status).toBe(FlowRunStatus.SUCCESS);

      const output = getAgentOutput(result)!;
      expect(output.finalResponse).toBe('I answered without tools.');
      expect(output.toolResults).toHaveLength(0);

      // No tools should be sent to OpenAI
      const req = capturedRequests[0];
      expect(req.tools).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // System prompt forwarding
  // -------------------------------------------------------------------------
  describe('system prompt', () => {
    it('should send system prompt to OpenAI', async () => {
      responseQueue.push(textResponse('I am the assistant.'));

      await runAgentFlow({
        nodes: [
          agentNode({
            systemPrompt: 'You are a math tutor. Always show your work.',
          }),
        ],
        edges: [],
      });

      const req = capturedRequests[0];
      const messages = req.messages as Array<{ role: string; content: string }>;
      const systemMsg = messages.find((m) => m.role === 'system');
      expect(systemMsg).toBeDefined();
      expect(systemMsg!.content).toContain('You are a math tutor');
    });
  });

  // -------------------------------------------------------------------------
  // Token usage tracking
  // -------------------------------------------------------------------------
  describe('token tracking', () => {
    it('should report token usage estimate in output', async () => {
      responseQueue.push(textResponse('Short response.'));

      const result = await runAgentFlow({
        nodes: [agentNode()],
        edges: [],
      });

      const output = getAgentOutput(result)!;
      expect(output.tokenUsage).toBeDefined();
      expect(typeof output.tokenUsage!.conversationTokensEstimate).toBe('number');
      expect(typeof output.tokenUsage!.truncationOccurred).toBe('boolean');
    });
  });

  // -------------------------------------------------------------------------
  // Flow-level integration: Input → Agent → Output chain
  // -------------------------------------------------------------------------
  describe('full Input → Agent → Output chain', () => {
    it('should execute complete flow with tool use', async () => {
      // Agent uses math tool, then returns final answer
      responseQueue.push(
        toolCallResponse([
          { id: 'chain1', name: 'inst_math', arguments: { expression: '100 / 4' } },
        ]),
      );
      responseQueue.push(textResponse('100 divided by 4 is 25.'));

      const result = await runAgentFlow({
        nodes: [
          {
            id: 'input-1',
            type: 'core.input',
            label: 'Question',
            referenceId: 'question',
            params: {
              variableName: 'math_question',
              defaultValue: 'What is 100 / 4?',
            },
            position: { x: 0, y: 200 },
          },
          agentNode({
            taskPrompt: 'Solve: {{ question }}',
          }),
          {
            id: 'output-1',
            type: 'core.output',
            label: 'Answer',
            referenceId: 'answer',
            params: {
              outputName: 'result',
              outputValue: '{{ agent.finalResponse }}',
            },
            position: { x: 600, y: 200 },
          },
        ],
        edges: [
          { id: 'e1', source: 'input-1', target: 'agent-1' },
          { id: 'e2', source: 'agent-1', target: 'output-1' },
        ],
      });

      expect(result.status).toBe(FlowRunStatus.SUCCESS);

      // Verify all three nodes executed
      expect(result.traces).toBeDefined();
      const traceNodeIds = result.traces!.map((t) => t.nodeId);
      expect(traceNodeIds).toContain('input-1');
      expect(traceNodeIds).toContain('agent-1');
      expect(traceNodeIds).toContain('output-1');

      // Verify agent used the math tool
      const agentOutput = getAgentOutput(result)!;
      expect(agentOutput.toolResults).toHaveLength(1);
      expect(agentOutput.toolResults[0].output).toBe(25);
    });
  });
});
