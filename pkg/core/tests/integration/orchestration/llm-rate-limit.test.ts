/**
 * Integration tests: LLM provider rate-limit + transient error handling
 *
 * The OpenAI SDK is constructed with `maxRetries: 3` in
 * `openai-adapter.ts`. It auto-retries on 408/409/429/5xx with exponential
 * backoff. These tests verify that behavior end-to-end via a real flow:
 *
 * - Transient 429 succeeds after SDK retry
 * - Transient 503 succeeds after SDK retry
 * - Persistent 429 exhausts retries and fails the flow
 * - Agent loop inherits the same retry behavior
 * - Mid-loop rate limit (second iteration) still fails cleanly
 *
 * NOTE: We use a real local HTTP server (not MSW) because the OpenAI SDK
 * calls `ReadableStream.cancel()` on error responses, and MSW's response
 * bodies don't cancel cleanly under undici — causing retries to hang
 * indefinitely. A real HTTP server dodges the issue.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { FlowRunStatus } from '../../../src';
import type { InvectInstance } from '../../../src/api/types';
import type { InvectDefinition } from '../../../src/services/flow-versions/schemas-fresh';
import { createTestInvect } from '../helpers/test-flowlib';

// ---------------------------------------------------------------------------
// Response factories
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
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
}

function toolCallResponse(
  calls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>,
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
            function: { name: c.name, arguments: JSON.stringify(c.arguments) },
          })),
        },
        finish_reason: 'tool_calls',
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
}

// ---------------------------------------------------------------------------
// Local HTTP server (mocks OpenAI)
// ---------------------------------------------------------------------------

/** Each entry produces one HTTP response. Responses are consumed in order. */
type QueuedResponse =
  | { kind: 'ok'; body: Record<string, unknown> }
  | { kind: 'error'; status: number; body: Record<string, unknown> };

let responseQueue: QueuedResponse[] = [];
let requestCount = 0;
let server: Server;
let serverBaseUrl: string;

/**
 * Given a chat.completion-shaped body, emit an equivalent text/event-stream
 * payload so the OpenAI SDK's streaming parser can read it when the caller
 * set `stream: true`. We emit one chunk per choice-delta plus a final
 * `[DONE]` terminator.
 */
function toSseStream(body: Record<string, unknown>): string {
  const choices = (body.choices as Array<{ message?: Record<string, unknown> }>) ?? [];
  const message = choices[0]?.message ?? {};
  const toolCalls = (message as { tool_calls?: unknown[] }).tool_calls;
  const content = (message as { content?: string | null }).content ?? null;
  const lines: string[] = [];
  const baseChunk = {
    id: body.id,
    object: 'chat.completion.chunk',
    created: body.created,
    model: body.model,
  };

  if (toolCalls && Array.isArray(toolCalls) && toolCalls.length > 0) {
    toolCalls.forEach((tc, idx) => {
      const t = tc as { id: string; function: { name: string; arguments: string } };
      lines.push(
        `data: ${JSON.stringify({
          ...baseChunk,
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: idx,
                    id: t.id,
                    function: { name: t.function.name, arguments: t.function.arguments },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        })}\n\n`,
      );
    });
    lines.push(
      `data: ${JSON.stringify({
        ...baseChunk,
        choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
      })}\n\n`,
    );
  } else if (typeof content === 'string' && content.length > 0) {
    lines.push(
      `data: ${JSON.stringify({
        ...baseChunk,
        choices: [{ index: 0, delta: { content }, finish_reason: null }],
      })}\n\n`,
    );
    lines.push(
      `data: ${JSON.stringify({
        ...baseChunk,
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      })}\n\n`,
    );
  }
  lines.push('data: [DONE]\n\n');
  return lines.join('');
}

function handleRequest(req: IncomingMessage, res: ServerResponse) {
  const url = req.url ?? '';
  if (req.method === 'GET' && url.endsWith('/v1/models')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        object: 'list',
        data: [{ id: 'gpt-4o-mini', object: 'model', owned_by: 'openai' }],
      }),
    );
    return;
  }

  if (req.method === 'POST' && url.endsWith('/v1/chat/completions')) {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      requestCount += 1;
      let streamRequested = false;
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as {
          stream?: boolean;
        };
        streamRequested = body.stream === true;
      } catch {
        // body not JSON — treat as non-stream
      }

      const next = responseQueue.shift();
      if (!next) {
        if (streamRequested) {
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          res.end(toSseStream(textResponse('[queue empty]')));
        } else {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(textResponse('[queue empty]')));
        }
        return;
      }
      if (next.kind === 'ok') {
        if (streamRequested) {
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          res.end(toSseStream(next.body));
        } else {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(next.body));
        }
        return;
      }
      // Send `retry-after-ms: 1` so if anything still retries it does so
      // immediately (our action-level retries respect Retry-After).
      res.writeHead(next.status, {
        'content-type': 'application/json',
        'retry-after-ms': '1',
      });
      res.end(JSON.stringify(next.body));
    });
    return;
  }

  res.writeHead(404);
  res.end();
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

let flowlib: InvectInstance;
let credentialId: string;

const originalOpenAIBaseUrl = process.env.OPENAI_BASE_URL;

beforeAll(async () => {
  server = createServer(handleRequest);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  serverBaseUrl = `http://127.0.0.1:${port}/v1`;
  // The OpenAI SDK reads OPENAI_BASE_URL by default, so we can redirect
  // the real adapter to our local server without threading baseURL through
  // the credential → adapter factory chain.
  process.env.OPENAI_BASE_URL = serverBaseUrl;

  flowlib = await createTestInvect();
  const cred = await flowlib.credentials.create({
    name: 'Test OpenAI Rate-Limit',
    type: 'llm',
    authType: 'apiKey',
    config: { apiKey: 'sk-test', provider: 'openai' },
    description: 'Local mock OpenAI (rate limit)',
  });
  credentialId = cred.id;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  await flowlib.shutdown();
  if (originalOpenAIBaseUrl === undefined) {
    delete process.env.OPENAI_BASE_URL;
  } else {
    process.env.OPENAI_BASE_URL = originalOpenAIBaseUrl;
  }
});

beforeEach(() => {
  responseQueue = [];
  requestCount = 0;
});

afterEach(() => {
  responseQueue = [];
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function runFlow(definition: InvectDefinition) {
  const flow = await flowlib.flows.create({ name: `ratelimit-${Date.now()}-${Math.random()}` });
  await flowlib.versions.create(flow.id, { invectDefinition: definition });
  return flowlib.runs.start(flow.id, {}, { useBatchProcessing: false });
}

function modelNode(overrides: Record<string, unknown> = {}): InvectDefinition['nodes'][number] {
  return {
    id: 'model',
    type: 'core.model',
    referenceId: 'model',
    params: {
      credentialId,
      model: 'gpt-4o-mini',
      provider: 'OPENAI',
      prompt: 'say hi',
      systemPrompt: '',
      useBatchProcessing: false,
      temperature: 0,
      ...overrides,
    },
    position: { x: 0, y: 0 },
  };
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

function rateLimit(): QueuedResponse {
  return {
    kind: 'error',
    status: 429,
    body: {
      error: { message: 'Rate limit reached', type: 'rate_limit_exceeded', code: 'rate_limit' },
    },
  };
}

function serverError(status = 503): QueuedResponse {
  return {
    kind: 'error',
    status,
    body: { error: { message: 'service unavailable', type: 'server_error' } },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LLM rate-limit + transient-error handling', () => {
  const testTimeout = 30_000;

  describe('core.model (single-shot prompt)', () => {
    it(
      'retries past a transient 429 and returns the eventual success',
      async () => {
        responseQueue = [rateLimit(), { kind: 'ok', body: textResponse('hello world') }];

        const result = await runFlow({ nodes: [modelNode()], edges: [] });

        expect(result.status).toBe(FlowRunStatus.SUCCESS);
        expect(requestCount).toBe(2);

        const out = (
          result.outputs?.['model'] as
            | { data?: { variables?: { output?: { value?: unknown } } } }
            | undefined
        )?.data?.variables?.output?.value;
        expect(String(out ?? '')).toContain('hello world');
      },
      testTimeout,
    );

    it(
      'retries past a transient 503 and returns the eventual success',
      async () => {
        responseQueue = [serverError(503), { kind: 'ok', body: textResponse('recovered') }];

        const result = await runFlow({ nodes: [modelNode()], edges: [] });

        expect(result.status).toBe(FlowRunStatus.SUCCESS);
        expect(requestCount).toBe(2);
      },
      testTimeout,
    );

    it(
      'fails cleanly when rate-limits persist past the retry budget',
      async () => {
        // SDK retries are disabled for flow-node callers; core.model retries
        // at the action layer with maxAttempts=3 → 3 total attempts.
        responseQueue = Array.from({ length: 6 }, rateLimit);

        const result = await runFlow({ nodes: [modelNode()], edges: [] });

        expect(result.status).toBe(FlowRunStatus.FAILED);
        // Exactly 3 attempts: action-level maxAttempts=3, no SDK retries.
        expect(requestCount).toBe(3);

        const trace = result.traces?.find((t) => t.nodeId === 'model');
        expect(trace?.status).toBe('FAILED');
        expect(trace?.error ?? '').toMatch(/429|rate/i);
        expect(trace?.errorDetails?.code).toBe('RATE_LIMIT');
        expect(trace?.errorDetails?.providerStatusCode).toBe(429);
        expect(trace?.errorDetails?.attempts).toBe(3);
      },
      testTimeout,
    );

    it(
      'propagates a persistent 5xx failure as a flow failure',
      async () => {
        responseQueue = Array.from({ length: 6 }, () => serverError(500));

        const result = await runFlow({ nodes: [modelNode()], edges: [] });

        expect(result.status).toBe(FlowRunStatus.FAILED);
        expect(requestCount).toBe(3);
        const trace = result.traces?.find((t) => t.nodeId === 'model');
        expect(trace?.errorDetails?.code).toBe('UPSTREAM_5XX');
      },
      testTimeout,
    );
  });

  describe('core.agent (iterative loop)', () => {
    it(
      'first iteration survives a transient 429',
      async () => {
        responseQueue = [rateLimit(), { kind: 'ok', body: textResponse('all done') }];

        const result = await runFlow({ nodes: [baseAgent()], edges: [] });

        expect(result.status).toBe(FlowRunStatus.SUCCESS);
        expect(requestCount).toBe(2);
      },
      testTimeout,
    );

    it(
      'mid-loop rate limit that exhausts retries fails the flow',
      async () => {
        responseQueue = [
          {
            kind: 'ok',
            body: toolCallResponse([
              { id: 't1', name: 'inst_math', arguments: { expression: '1+1' } },
            ]),
          },
          rateLimit(),
          rateLimit(),
          rateLimit(),
          rateLimit(),
        ];

        const result = await runFlow({ nodes: [baseAgent()], edges: [] });

        expect(result.status).toBe(FlowRunStatus.FAILED);
        // 1 successful tool-call + 3 attempts on iter 2 (iterationRetries=3) = 4.
        expect(requestCount).toBe(4);
      },
      testTimeout,
    );

    it(
      'downstream nodes do not execute when the agent is rate-limited into failure',
      async () => {
        responseQueue = Array.from({ length: 6 }, rateLimit);

        const result = await runFlow({
          nodes: [
            baseAgent(),
            {
              id: 'after',
              type: 'core.template_string',
              referenceId: 'after',
              params: { template: 'should not run' },
              position: { x: 200, y: 0 },
            },
          ],
          edges: [{ id: 'e1', source: 'agent', target: 'after' }],
        });

        expect(result.status).toBe(FlowRunStatus.FAILED);
        expect(result.outputs?.['after']).toBeUndefined();
      },
      testTimeout,
    );
  });
});
