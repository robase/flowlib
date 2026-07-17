/**
 * `aiSdkProvider.prompt()` — turn accounting and credential resolution.
 *
 * These drive the provider directly (no `runTurn`), feeding a scripted
 * `fullStream` whose chunk shapes match `ai@6`'s `TextStreamPart` union:
 *
 *   { type: 'finish-step', usage,      finishReason, … }   ← per step
 *   { type: 'finish',      totalUsage, finishReason, … }   ← once, at the end
 *
 * That split is the whole point of the usage tests: `finish` carries
 * `totalUsage`, NOT `usage`.
 */
import { describe, expect, it, vi } from 'vitest';

import { aiSdkProvider } from '../ai-sdk/provider';
import type { AgentEvent } from '../../../shared/events';
import type { AgentsAuthContext } from '../../../shared/auth-context';
import type { PromptInput } from '../types';

const auth: AgentsAuthContext = { userId: 'user-1', orgId: 'org-1', role: 'user', teamIds: [] };

/** `streamText` that replays a fixed chunk script. */
function scriptedStreamText(chunks: unknown[]) {
  return () => ({
    fullStream: (async function* () {
      for (const c of chunks) {
        yield c;
      }
    })(),
  });
}

async function drain(
  iterable: AsyncIterable<AgentEvent>,
): Promise<{ events: AgentEvent[]; end: Extract<AgentEvent, { type: 'session-end' }> | undefined }> {
  const events: AgentEvent[] = [];
  for await (const e of iterable) {
    events.push(e);
  }
  return {
    events,
    end: events.find((e): e is Extract<AgentEvent, { type: 'session-end' }> => e.type ===
      'session-end'),
  };
}

function makePrompt(over: Partial<PromptInput> & { providerSessionId: string }): PromptInput {
  return {
    parts: [{ type: 'text', text: 'go' }],
    abortSignal: new AbortController().signal,
    ...over,
  };
}

/** One step's worth of chunks: some text, then a `finish-step`. */
function step(usage: { inputTokens: number; outputTokens: number }, finishReason: string) {
  return [
    { type: 'text-delta', text: '.' },
    { type: 'finish-step', usage, finishReason, response: {}, rawFinishReason: finishReason },
  ];
}

// ─── Token accounting ─────────────────────────────────────────────────

describe('aiSdkProvider: token usage', () => {
  async function runWithChunks(chunks: unknown[], opts: { maxSteps?: number } = {}) {
    const provider = aiSdkProvider({
      streamText: scriptedStreamText(chunks),
      vendors: { anthropic: () => ({}) },
      resolveCredential: async () => ({ vendor: 'anthropic' as const, apiKey: 'sk-test' }),
      ...(opts.maxSteps ? { maxSteps: opts.maxSteps } : {}),
    });
    const { providerSessionId } = await provider.createSession({
      auth,
      config: { defaultModel: 'anthropic/claude-sonnet-4-5' },
    });
    return drain(provider.prompt(makePrompt({ providerSessionId })));
  }

  it("reads the turn total from `finish.totalUsage` (ai@6 puts nothing in `finish.usage`)", async () => {
    // A 3-step turn. Each step's `usage` is that step's spend alone; the
    // conversation prefix is re-billed every step, so the total dwarfs the
    // last step. Reading `finish.usage` yields `undefined` here — the old
    // code then fell back to the last step's 300, understating by 5×.
    const { events } = await runWithChunks([
      { type: 'start' },
      ...step({ inputTokens: 100, outputTokens: 10 }, 'tool-calls'),
      ...step({ inputTokens: 200, outputTokens: 20 }, 'tool-calls'),
      ...step({ inputTokens: 300, outputTokens: 30 }, 'stop'),
      {
        type: 'finish',
        finishReason: 'stop',
        rawFinishReason: 'stop',
        totalUsage: { inputTokens: 600, outputTokens: 60 },
      },
    ]);

    const complete = events.find((e) => e.type === 'message-complete');
    expect(complete).toMatchObject({ usage: { inputTokens: 600, outputTokens: 60 } });
  });

  it('falls back to summing every `finish-step` when `totalUsage` is absent', async () => {
    const { events } = await runWithChunks([
      { type: 'start' },
      ...step({ inputTokens: 100, outputTokens: 10 }, 'tool-calls'),
      ...step({ inputTokens: 200, outputTokens: 20 }, 'tool-calls'),
      ...step({ inputTokens: 300, outputTokens: 30 }, 'stop'),
      { type: 'finish', finishReason: 'stop' },
    ]);

    // Summed, not last-write-wins (which would have been 300 / 30).
    expect(events.find((e) => e.type === 'message-complete')).toMatchObject({
      usage: { inputTokens: 600, outputTokens: 60 },
    });
  });

  it('still reads the legacy single `usage` shape on finish', async () => {
    const { events } = await runWithChunks([
      { type: 'start' },
      { type: 'text-delta', text: 'hi' },
      { type: 'finish', finishReason: 'stop', usage: { promptTokens: 42, completionTokens: 7 } },
    ]);

    expect(events.find((e) => e.type === 'message-complete')).toMatchObject({
      usage: { inputTokens: 42, outputTokens: 7 },
    });
  });

  // ─── Step-limit end reason ──────────────────────────────────────────

  it("ends with 'max-turns' when the step cap cuts the loop off mid-task", async () => {
    // 3 steps with maxSteps: 3, and the last step still wanted to call
    // tools — `stopWhen` halted it, the model wasn't done.
    const { end } = await runWithChunks(
      [
        { type: 'start' },
        ...step({ inputTokens: 100, outputTokens: 10 }, 'tool-calls'),
        ...step({ inputTokens: 200, outputTokens: 20 }, 'tool-calls'),
        ...step({ inputTokens: 300, outputTokens: 30 }, 'tool-calls'),
        {
          type: 'finish',
          finishReason: 'tool-calls',
          totalUsage: { inputTokens: 600, outputTokens: 60 },
        },
      ],
      { maxSteps: 3 },
    );

    expect(end).toEqual({ type: 'session-end', reason: 'max-turns' });
  });

  it("ends 'completed' when the model finishes on its own at the step cap", async () => {
    // Same step count, but the final step ended in 'stop' — the model was
    // genuinely done, so hitting the cap is incidental.
    const { end } = await runWithChunks(
      [
        { type: 'start' },
        ...step({ inputTokens: 100, outputTokens: 10 }, 'tool-calls'),
        ...step({ inputTokens: 200, outputTokens: 20 }, 'tool-calls'),
        ...step({ inputTokens: 300, outputTokens: 30 }, 'stop'),
        { type: 'finish', finishReason: 'stop', totalUsage: { inputTokens: 600, outputTokens: 60 } },
      ],
      { maxSteps: 3 },
    );

    expect(end).toEqual({ type: 'session-end', reason: 'completed' });
  });

  it("ends 'completed' on a short turn well under the cap", async () => {
    const { end } = await runWithChunks(
      [
        { type: 'start' },
        ...step({ inputTokens: 100, outputTokens: 10 }, 'stop'),
        { type: 'finish', finishReason: 'stop', totalUsage: { inputTokens: 100, outputTokens: 10 } },
      ],
      { maxSteps: 25 },
    );

    expect(end).toEqual({ type: 'session-end', reason: 'completed' });
  });
});

// ─── Credential resolution ────────────────────────────────────────────

describe('aiSdkProvider: credential resolution follows the turn, not the session default', () => {
  /** A resolver that hands back a credential for whatever vendor is asked. */
  function vendorEchoResolver() {
    return vi.fn(async ({ vendor }: { vendor: string }) => ({
      vendor: vendor as 'anthropic' | 'openai',
      apiKey: `sk-${vendor}`,
    }));
  }

  function makeProvider(resolveCredential: ReturnType<typeof vendorEchoResolver>) {
    return aiSdkProvider({
      streamText: scriptedStreamText([
        { type: 'text-delta', text: 'ok' },
        { type: 'finish', finishReason: 'stop', totalUsage: { inputTokens: 1, outputTokens: 1 } },
      ]),
      vendors: { anthropic: () => ({}), openai: () => ({}) },
      resolveCredential,
    });
  }

  it('resolves against the turn-override vendor, not the session default vendor', async () => {
    const resolveCredential = vendorEchoResolver();
    const provider = makeProvider(resolveCredential);
    const { providerSessionId } = await provider.createSession({
      auth,
      config: { defaultModel: 'anthropic/claude-sonnet-4-5' },
    });

    // The turn overrides the model to an OpenAI one. Deriving the vendor
    // from `session.defaultModel` asked for an `anthropic` credential,
    // which the vendor-mismatch check then rejected outright — killing a
    // turn whose credential would have resolved fine.
    const { end } = await drain(
      provider.prompt(makePrompt({ providerSessionId, model: 'openai/gpt-4o-mini' })),
    );

    expect(resolveCredential).toHaveBeenCalledWith(expect.objectContaining({ vendor: 'openai' }));
    expect(end).toEqual({ type: 'session-end', reason: 'completed' });
  });

  it('re-resolves per vendor rather than serving a cached credential for another one', async () => {
    const resolveCredential = vendorEchoResolver();
    const provider = makeProvider(resolveCredential);
    const { providerSessionId } = await provider.createSession({
      auth,
      config: { defaultModel: 'anthropic/claude-sonnet-4-5' },
    });

    // Turn 1 warms the cache with an anthropic credential…
    await drain(provider.prompt(makePrompt({ providerSessionId })));
    // …turn 2 switches vendor. The cached credential is stale by
    // definition; `createSession`'s invalidation only watches
    // `defaultModel` and can't see a per-turn override.
    const { end } = await drain(
      provider.prompt(makePrompt({ providerSessionId, model: 'openai/gpt-4o-mini' })),
    );

    expect(resolveCredential).toHaveBeenCalledTimes(2);
    expect(resolveCredential).toHaveBeenLastCalledWith(
      expect.objectContaining({ vendor: 'openai' }),
    );
    expect(end).toEqual({ type: 'session-end', reason: 'completed' });
  });

  it('reuses the cached credential when the vendor is unchanged', async () => {
    const resolveCredential = vendorEchoResolver();
    const provider = makeProvider(resolveCredential);
    const { providerSessionId } = await provider.createSession({
      auth,
      config: { defaultModel: 'anthropic/claude-sonnet-4-5' },
    });

    await drain(provider.prompt(makePrompt({ providerSessionId })));
    await drain(
      provider.prompt(makePrompt({ providerSessionId, model: 'anthropic/claude-haiku-4-5' })),
    );

    expect(resolveCredential).toHaveBeenCalledTimes(1);
  });

  it('still reports a genuine vendor/credential mismatch', async () => {
    // A resolver pinned to anthropic (the user's only key) against an
    // openai model must still fail loudly — the fix must not paper over
    // the real mismatch it was masking.
    const provider = aiSdkProvider({
      streamText: scriptedStreamText([]),
      vendors: { anthropic: () => ({}), openai: () => ({}) },
      resolveCredential: async () => ({ vendor: 'anthropic' as const, apiKey: 'sk-a' }),
    });
    const { providerSessionId } = await provider.createSession({
      auth,
      config: { defaultModel: 'anthropic/claude-sonnet-4-5' },
    });

    const { end } = await drain(
      provider.prompt(makePrompt({ providerSessionId, model: 'openai/gpt-4o-mini' })),
    );

    expect(end?.reason).toBe('error');
    expect(end?.error).toContain('needs vendor "openai"');
  });
});
