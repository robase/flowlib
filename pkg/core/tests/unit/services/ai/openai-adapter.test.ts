/**
 * Unit tests for OpenAIAdapter — focused on the streaming agent path
 * because that's what plugin metering hooks (`afterAgentExecute`,
 * `afterAgentToolExecute`) depend on for token totals.
 *
 * Edge cases covered:
 *   - Captures provider-reported usage from the final usage-only SSE chunk
 *   - Sums usage across content + tool-call streams
 *   - Returns no `usage` when the stream omits the usage chunk
 *   - Handles partial usage (only prompt or only completion tokens)
 *   - Aggregates streamed tool-call argument fragments + emits usage
 *   - Captures non-standard `reasoning` deltas without losing usage
 *   - Batch result line items: extracts `usage` from `response.body`
 *   - Batch result line items: missing usage gracefully omits the field
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { OpenAIAdapter } from '../../../../src/services/ai/openai-adapter';
import { toOpenAiSseStream } from '../../../integration/helpers/openai-sse';
import type { Logger } from '../../../../src/schemas';

function silentLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function makeAdapter(): OpenAIAdapter {
  return new OpenAIAdapter(silentLogger(), 'sk-test', 'gpt-4o-mini');
}

// Captured request bodies for each request to chat.completions
let captured: Array<Record<string, unknown>> = [];
// Mutable response queue
let chatResponses: Array<Record<string, unknown> | string> = [];

const mswServer = setupServer(
  http.post('https://api.openai.com/v1/chat/completions', async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    captured.push(body);
    const next = chatResponses.shift();
    if (typeof next === 'string') {
      // Raw SSE string — let the test override the format entirely.
      return new Response(next, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    }
    if (!next) {
      throw new Error('No queued response for chat.completions request');
    }
    return new Response(toOpenAiSseStream(next), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  }),
  http.post('https://api.openai.com/v1/files', () =>
    HttpResponse.json({ id: 'file-input-x', object: 'file' }),
  ),
  http.post('https://api.openai.com/v1/batches', () =>
    HttpResponse.json({ id: 'batch-x', status: 'completed', output_file_id: 'file-out-x' }),
  ),
);

beforeAll(() => mswServer.listen({ onUnhandledRequest: 'error' }));
afterAll(() => mswServer.close());
beforeEach(() => {
  captured = [];
  chatResponses = [];
});
afterEach(() => mswServer.resetHandlers());

// ---------------------------------------------------------------------------
// Streaming usage capture
// ---------------------------------------------------------------------------

describe('OpenAIAdapter — streaming usage capture', () => {
  it('captures provider-reported usage from the final usage chunk', async () => {
    chatResponses.push({
      id: 'chatcmpl-1',
      object: 'chat.completion',
      created: 1,
      model: 'gpt-4o-mini',
      choices: [{ index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 13, completion_tokens: 7, total_tokens: 20 },
    });

    const adapter = makeAdapter();
    const result = await adapter.executeAgentPrompt({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [],
    });

    expect(result.type).toBe('text');
    expect(result.content).toBe('hi');
    expect(result.usage).toEqual({ inputTokens: 13, outputTokens: 7 });

    // Adapter must request usage chunks; otherwise OpenAI won't emit them.
    expect(captured[0]?.stream).toBe(true);
    expect(captured[0]?.stream_options).toEqual({ include_usage: true });
  });

  it('returns no usage when the stream omits the usage chunk', async () => {
    // Hand-craft an SSE payload that has the content delta + final stop
    // but no terminal usage chunk. Some OpenAI-compatible proxies do this.
    chatResponses.push(
      [
        `data: ${JSON.stringify({
          id: 'c',
          object: 'chat.completion.chunk',
          choices: [{ index: 0, delta: { content: 'no-usage' }, finish_reason: null }],
        })}`,
        '',
        `data: ${JSON.stringify({
          id: 'c',
          object: 'chat.completion.chunk',
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        })}`,
        '',
        'data: [DONE]',
        '',
        '',
      ].join('\n'),
    );

    const adapter = makeAdapter();
    const result = await adapter.executeAgentPrompt({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'x' }],
      tools: [],
    });

    expect(result.content).toBe('no-usage');
    expect(result.usage).toBeUndefined();
  });

  it('treats missing prompt or completion fields as 0 instead of NaN', async () => {
    chatResponses.push({
      id: 'c',
      object: 'chat.completion',
      created: 1,
      model: 'gpt-4o-mini',
      choices: [
        { index: 0, message: { role: 'assistant', content: 'partial' }, finish_reason: 'stop' },
      ],
      // Only prompt_tokens — completion_tokens absent (rare proxy bug).
      usage: { prompt_tokens: 5 },
    });

    const adapter = makeAdapter();
    const result = await adapter.executeAgentPrompt({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'x' }],
      tools: [],
    });

    expect(result.usage).toEqual({ inputTokens: 5, outputTokens: 0 });
  });

  it('captures usage on tool-use responses, not just text', async () => {
    chatResponses.push({
      id: 'c',
      object: 'chat.completion',
      created: 1,
      model: 'gpt-4o-mini',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_a',
                type: 'function',
                function: { name: 'echo', arguments: JSON.stringify({ x: 1 }) },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 100, completion_tokens: 25, total_tokens: 125 },
    });

    const adapter = makeAdapter();
    const result = await adapter.executeAgentPrompt({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'go' }],
      tools: [
        {
          id: 'echo',
          name: 'Echo',
          description: 'echo',
          inputSchema: { type: 'object' },
          category: 'utility',
        },
      ],
    });

    expect(result.type).toBe('tool_use');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls?.[0]).toMatchObject({
      id: 'call_a',
      toolId: 'echo',
      input: { x: 1 },
    });
    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 25 });
  });

  it('keeps reasoning deltas alongside usage on responses that have both', async () => {
    chatResponses.push({
      id: 'c',
      object: 'chat.completion',
      created: 1,
      model: 'gpt-4o-mini',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: 'final',
            reasoning: 'pondering',
          },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 },
    });

    const adapter = makeAdapter();
    const result = await adapter.executeAgentPrompt({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'q' }],
      tools: [],
    });

    expect(result.content).toBe('final');
    expect(result.reasoning).toBe('pondering');
    expect(result.usage).toEqual({ inputTokens: 8, outputTokens: 2 });
  });

  it('parses malformed tool-call argument JSON without losing usage', async () => {
    // Arguments are intentionally malformed — adapter should still emit a
    // tool call (with a parseError marker) and keep the usage data.
    chatResponses.push({
      id: 'c',
      object: 'chat.completion',
      created: 1,
      model: 'gpt-4o-mini',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_bad',
                type: 'function',
                function: { name: 'echo', arguments: 'this is { not valid json' },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
    });

    const adapter = makeAdapter();
    const result = await adapter.executeAgentPrompt({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'go' }],
      tools: [
        {
          id: 'echo',
          name: 'Echo',
          description: 'echo',
          inputSchema: { type: 'object' },
          category: 'utility',
        },
      ],
    });

    expect(result.type).toBe('tool_use');
    expect(result.toolCalls?.[0].input).toMatchObject({ _parseError: expect.any(String) });
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 3 });
  });
});

// ---------------------------------------------------------------------------
// Batch result usage capture
// ---------------------------------------------------------------------------

describe('OpenAIAdapter — batch result usage capture', () => {
  /**
   * The `pollBatch` flow ends in `downloadResults`, which parses the
   * output JSONL file. We only need to cover the JSONL parse path so
   * mocking the OpenAI files+batches endpoints is overkill — call the
   * private path indirectly via `pollBatch` with a tightly-mocked stack.
   */

  function jsonlLine(opts: {
    customId: string;
    content?: string;
    usage?: { prompt_tokens: number; completion_tokens: number };
    error?: string;
  }): string {
    if (opts.error) {
      return JSON.stringify({ custom_id: opts.customId, error: { message: opts.error } });
    }
    return JSON.stringify({
      id: 'req-1',
      custom_id: opts.customId,
      response: {
        status_code: 200,
        body: {
          id: 'chatcmpl-x',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: opts.content },
              finish_reason: 'stop',
            },
          ],
          ...(opts.usage ? { usage: opts.usage } : {}),
        },
      },
    });
  }

  beforeEach(() => {
    mswServer.use(
      http.get('https://api.openai.com/v1/batches/batch-x', () =>
        HttpResponse.json({
          id: 'batch-x',
          status: 'completed',
          output_file_id: 'file-out-x',
          request_counts: { total: 2, completed: 2, failed: 0 },
        }),
      ),
    );
  });

  it('captures usage from each successful batch line item', async () => {
    const lines = [
      jsonlLine({
        customId: 'job-1',
        content: 'first',
        usage: { prompt_tokens: 30, completion_tokens: 10 },
      }),
      jsonlLine({
        customId: 'job-2',
        content: 'second',
        usage: { prompt_tokens: 50, completion_tokens: 20 },
      }),
    ].join('\n');
    mswServer.use(
      http.get('https://api.openai.com/v1/files/file-out-x/content', () =>
        HttpResponse.text(lines),
      ),
    );

    const adapter = makeAdapter();
    const poll = await adapter.pollBatch('batch-x');

    expect(poll.status).toBe('COMPLETED');
    expect(poll.result).toHaveLength(2);
    expect(poll.result?.[0]).toMatchObject({
      batchId: 'job-1',
      status: 'COMPLETED',
      usage: { inputTokens: 30, outputTokens: 10 },
    });
    expect(poll.result?.[1]).toMatchObject({
      batchId: 'job-2',
      status: 'COMPLETED',
      usage: { inputTokens: 50, outputTokens: 20 },
    });
  });

  it('omits usage when the line item has no usage field', async () => {
    const lines = jsonlLine({ customId: 'job-1', content: 'no usage' });
    mswServer.use(
      http.get('https://api.openai.com/v1/files/file-out-x/content', () =>
        HttpResponse.text(lines),
      ),
    );

    const adapter = makeAdapter();
    const poll = await adapter.pollBatch('batch-x');

    const first = poll.result?.[0];
    expect(first).toMatchObject({ status: 'COMPLETED' });
    // Should NOT have a usage key — strict equality check.
    expect((first as Record<string, unknown>).usage).toBeUndefined();
  });

  it('preserves error line items and does not synthesize fake usage for them', async () => {
    const lines = [
      jsonlLine({
        customId: 'job-1',
        content: 'ok',
        usage: { prompt_tokens: 5, completion_tokens: 2 },
      }),
      jsonlLine({ customId: 'job-2', error: 'rate limited' }),
    ].join('\n');
    mswServer.use(
      http.get('https://api.openai.com/v1/files/file-out-x/content', () =>
        HttpResponse.text(lines),
      ),
    );

    const adapter = makeAdapter();
    const poll = await adapter.pollBatch('batch-x');

    expect(poll.result).toHaveLength(2);
    expect(poll.result?.[0]).toMatchObject({
      status: 'COMPLETED',
      usage: { inputTokens: 5, outputTokens: 2 },
    });
    expect(poll.result?.[1]).toMatchObject({ status: 'FAILED' });
    const failed = poll.result?.[1] as Record<string, unknown> | undefined;
    expect(failed?.usage).toBeUndefined();
  });
});
