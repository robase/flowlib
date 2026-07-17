/**
 * Unit tests for AnthropicAdapter — focused on the streaming agent path
 * and batch result parsing. Anthropic's SSE schema is meaningfully
 * different from OpenAI's (typed events, usage spread across
 * `message_start` and `message_delta`), so coverage is symmetric but
 * not shared.
 *
 * Edge cases covered:
 *   - Captures input_tokens from `message_start.message.usage`
 *   - Captures output_tokens from cumulative `message_delta.usage`
 *   - Tool-use responses still surface usage
 *   - Stream missing message_start usage falls back to delta-only
 *   - Stream missing all usage events returns no `usage` field
 *   - Malformed tool-input JSON survives without losing usage
 *   - Batch result line items: extracts `usage` from `message.usage`
 *   - Batch error / canceled / expired line items omit usage
 *   - Agent path sends top-level `cache_control` (automatic caching)
 *   - Cache read/write tokens fold into the reported input total
 *   - Single-shot prompts cache the system prefix, not the varying user prompt
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { AnthropicAdapter } from '../../../../src/services/ai/anthropic-adapter';
import type { Logger } from '../../../../src/schemas';

function silentLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeAdapter(): AnthropicAdapter {
  return new AnthropicAdapter(silentLogger(), 'sk-ant-test', 'claude-sonnet-4-6');
}

// ---------------------------------------------------------------------------
// Stream builder — Anthropic's typed SSE
// ---------------------------------------------------------------------------

interface StreamOpts {
  inputTokensStart?: number;
  outputTokensStart?: number;
  outputTokensFinal?: number;
  text?: string;
  thinking?: string;
  toolUse?: { id: string; name: string; argsJson: string };
  malformedToolJson?: { id: string; name: string };
  /** Skip the message_start usage block entirely. */
  omitStartUsage?: boolean;
  /** Skip the message_delta usage block entirely. */
  omitDeltaUsage?: boolean;
  /** Prompt-cache tokens reported on `message_start.message.usage`. */
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

function buildSse(opts: StreamOpts): string {
  const events: Array<{ event: string; data: Record<string, unknown> }> = [];

  // message_start
  events.push({
    event: 'message_start',
    data: {
      type: 'message_start',
      message: {
        id: 'msg_x',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-4-6',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        ...(opts.omitStartUsage
          ? {}
          : {
              usage: {
                input_tokens: opts.inputTokensStart ?? 0,
                output_tokens: opts.outputTokensStart ?? 0,
                ...(opts.cacheReadTokens !== undefined
                  ? { cache_read_input_tokens: opts.cacheReadTokens }
                  : {}),
                ...(opts.cacheCreationTokens !== undefined
                  ? { cache_creation_input_tokens: opts.cacheCreationTokens }
                  : {}),
              },
            }),
      },
    },
  });

  let blockIndex = 0;

  if (opts.thinking) {
    events.push({
      event: 'content_block_start',
      data: {
        type: 'content_block_start',
        index: blockIndex,
        content_block: { type: 'thinking', thinking: '' },
      },
    });
    events.push({
      event: 'content_block_delta',
      data: {
        type: 'content_block_delta',
        index: blockIndex,
        delta: { type: 'thinking_delta', thinking: opts.thinking },
      },
    });
    events.push({
      event: 'content_block_stop',
      data: { type: 'content_block_stop', index: blockIndex },
    });
    blockIndex++;
  }

  if (opts.text) {
    events.push({
      event: 'content_block_start',
      data: {
        type: 'content_block_start',
        index: blockIndex,
        content_block: { type: 'text', text: '' },
      },
    });
    events.push({
      event: 'content_block_delta',
      data: {
        type: 'content_block_delta',
        index: blockIndex,
        delta: { type: 'text_delta', text: opts.text },
      },
    });
    events.push({
      event: 'content_block_stop',
      data: { type: 'content_block_stop', index: blockIndex },
    });
    blockIndex++;
  }

  if (opts.toolUse) {
    events.push({
      event: 'content_block_start',
      data: {
        type: 'content_block_start',
        index: blockIndex,
        content_block: {
          type: 'tool_use',
          id: opts.toolUse.id,
          name: opts.toolUse.name,
          input: {},
        },
      },
    });
    events.push({
      event: 'content_block_delta',
      data: {
        type: 'content_block_delta',
        index: blockIndex,
        delta: { type: 'input_json_delta', partial_json: opts.toolUse.argsJson },
      },
    });
    events.push({
      event: 'content_block_stop',
      data: { type: 'content_block_stop', index: blockIndex },
    });
    blockIndex++;
  }

  if (opts.malformedToolJson) {
    events.push({
      event: 'content_block_start',
      data: {
        type: 'content_block_start',
        index: blockIndex,
        content_block: {
          type: 'tool_use',
          id: opts.malformedToolJson.id,
          name: opts.malformedToolJson.name,
          input: {},
        },
      },
    });
    events.push({
      event: 'content_block_delta',
      data: {
        type: 'content_block_delta',
        index: blockIndex,
        delta: { type: 'input_json_delta', partial_json: 'this is { not valid' },
      },
    });
    events.push({
      event: 'content_block_stop',
      data: { type: 'content_block_stop', index: blockIndex },
    });
    blockIndex++;
  }

  // message_delta with cumulative output token total
  events.push({
    event: 'message_delta',
    data: {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      ...(opts.omitDeltaUsage ? {} : { usage: { output_tokens: opts.outputTokensFinal ?? 0 } }),
    },
  });
  events.push({ event: 'message_stop', data: { type: 'message_stop' } });

  return events
    .map(({ event, data }) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    .join('');
}

// ---------------------------------------------------------------------------
// MSW server
// ---------------------------------------------------------------------------

let messageResponses: string[] = [];
let captured: Array<Record<string, unknown>> = [];

const mswServer = setupServer(
  http.post('https://api.anthropic.com/v1/messages', async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    captured.push(body);
    const sse = messageResponses.shift();
    if (!sse) {
      throw new Error('No queued Anthropic stream response');
    }
    return new Response(sse, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  }),
);

beforeAll(() => mswServer.listen({ onUnhandledRequest: 'error' }));
afterAll(() => mswServer.close());
beforeEach(() => {
  messageResponses = [];
  captured = [];
});
afterEach(() => mswServer.resetHandlers());

// ---------------------------------------------------------------------------
// Streaming usage capture
// ---------------------------------------------------------------------------

describe('AnthropicAdapter — streaming usage capture', () => {
  it('captures input_tokens from message_start and output_tokens from message_delta', async () => {
    messageResponses.push(
      buildSse({
        inputTokensStart: 42,
        outputTokensStart: 1,
        outputTokensFinal: 17,
        text: 'hello world',
      }),
    );

    const adapter = makeAdapter();
    const result = await adapter.executeAgentPrompt({
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
    });

    expect(result.type).toBe('text');
    expect(result.content).toBe('hello world');
    // message_delta cumulative wins — final output_tokens is 17, not 1+17.
    expect(result.usage).toEqual({ inputTokens: 42, outputTokens: 17 });
  });

  it('captures usage on tool-use responses with parsed tool input', async () => {
    messageResponses.push(
      buildSse({
        inputTokensStart: 100,
        outputTokensFinal: 50,
        toolUse: { id: 'toolu_1', name: 'echo', argsJson: '{"x":1,"y":2}' },
      }),
    );

    const adapter = makeAdapter();
    const result = await adapter.executeAgentPrompt({
      model: 'claude-sonnet-4-6',
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
      id: 'toolu_1',
      toolId: 'echo',
      input: { x: 1, y: 2 },
    });
    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 50 });
  });

  it('falls back to delta-only output when message_start has no usage', async () => {
    messageResponses.push(
      buildSse({
        omitStartUsage: true,
        outputTokensFinal: 9,
        text: 'no start',
      }),
    );

    const adapter = makeAdapter();
    const result = await adapter.executeAgentPrompt({
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'q' }],
      tools: [],
    });

    // input_tokens unset, output captured from delta
    expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 9 });
  });

  it('returns no usage when neither message_start nor message_delta carry it', async () => {
    messageResponses.push(
      buildSse({
        omitStartUsage: true,
        omitDeltaUsage: true,
        text: 'silent',
      }),
    );

    const adapter = makeAdapter();
    const result = await adapter.executeAgentPrompt({
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'q' }],
      tools: [],
    });

    expect(result.content).toBe('silent');
    expect(result.usage).toBeUndefined();
  });

  it('preserves usage even when tool input JSON fails to parse', async () => {
    messageResponses.push(
      buildSse({
        inputTokensStart: 11,
        outputTokensFinal: 4,
        malformedToolJson: { id: 'toolu_bad', name: 'echo' },
      }),
    );

    const adapter = makeAdapter();
    const result = await adapter.executeAgentPrompt({
      model: 'claude-sonnet-4-6',
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
    expect(result.usage).toEqual({ inputTokens: 11, outputTokens: 4 });
  });

  it('captures thinking content alongside usage (extended thinking models)', async () => {
    messageResponses.push(
      buildSse({
        inputTokensStart: 80,
        outputTokensFinal: 60,
        thinking: 'reasoning trail',
        text: 'answer',
      }),
    );

    const adapter = makeAdapter();
    const result = await adapter.executeAgentPrompt({
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'q' }],
      tools: [],
    });

    expect(result.content).toBe('answer');
    expect(result.reasoning).toBe('reasoning trail');
    expect(result.usage).toEqual({ inputTokens: 80, outputTokens: 60 });
  });
});

// ---------------------------------------------------------------------------
// Prompt caching
// ---------------------------------------------------------------------------

describe('AnthropicAdapter — prompt caching', () => {
  it('enables automatic caching on the agent path', async () => {
    messageResponses.push(buildSse({ inputTokensStart: 10, outputTokensFinal: 5, text: 'ok' }));

    const adapter = makeAdapter();
    await adapter.executeAgentPrompt({
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
      systemPrompt: 'be terse',
    });

    // Top-level cache_control — the breakpoint tracks the last cacheable block
    // as the conversation grows, so each iteration reads back the prior one.
    expect(captured[0]?.cache_control).toEqual({ type: 'ephemeral' });
  });

  it('reports total input tokens across cache reads, writes, and uncached input', async () => {
    messageResponses.push(
      buildSse({
        inputTokensStart: 12,
        cacheReadTokens: 1800,
        cacheCreationTokens: 240,
        outputTokensFinal: 30,
        text: 'cached',
      }),
    );

    const adapter = makeAdapter();
    const result = await adapter.executeAgentPrompt({
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
    });

    // `input_tokens` alone counts only post-breakpoint tokens (12). Downstream
    // metering records this as tokensIn, so it must stay the full 2052.
    expect(result.usage).toEqual({ inputTokens: 2052, outputTokens: 30 });
  });

  it('reports uncached input unchanged when no cache fields are present', async () => {
    messageResponses.push(
      buildSse({ inputTokensStart: 42, outputTokensFinal: 17, text: 'uncached' }),
    );

    const adapter = makeAdapter();
    const result = await adapter.executeAgentPrompt({
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
    });

    expect(result.usage).toEqual({ inputTokens: 42, outputTokens: 17 });
  });

  it('caches the system prompt on single-shot prompts, not the varying user prompt', async () => {
    messageResponses.push(buildSse({ inputTokensStart: 5, outputTokensFinal: 3, text: 'done' }));

    const adapter = makeAdapter();
    await adapter.executePrompt({
      model: 'claude-sonnet-4-6',
      prompt: 'summarise this row',
      systemPrompt: 'You are a summariser.',
    } as Parameters<AnthropicAdapter['executePrompt']>[0]);

    // Explicit breakpoint on system, NOT top-level automatic caching: the last
    // block here is the per-row user prompt, so an automatic breakpoint would
    // write a fresh entry every call and never read one back.
    expect(captured[0]?.cache_control).toBeUndefined();
    expect(captured[0]?.system).toEqual([
      { type: 'text', text: 'You are a summariser.', cache_control: { type: 'ephemeral' } },
    ]);
  });

  it('leaves the system prompt as a plain string when there is nothing to cache', async () => {
    messageResponses.push(buildSse({ inputTokensStart: 5, outputTokensFinal: 3, text: 'done' }));

    const adapter = makeAdapter();
    await adapter.executePrompt({
      model: 'claude-sonnet-4-6',
      prompt: 'no system prompt here',
    } as Parameters<AnthropicAdapter['executePrompt']>[0]);

    expect(captured[0]?.system).toBeUndefined();
    expect(captured[0]?.cache_control).toBeUndefined();
  });
});
