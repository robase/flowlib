/**
 * Live provider + judge wiring for real evals against Anthropic.
 *
 * Both `ai` and `@ai-sdk/anthropic` are *optional* peer deps of
 * `@flowlib/agents`, so they're imported dynamically: the offline scripted
 * path (and the harness self-tests) never load them. A live run needs them
 * installed and `ANTHROPIC_API_KEY` set.
 */

import { aiSdkProvider } from '../../../src/backend/providers/ai-sdk';
import { buildSandboxTools } from '../../../src/backend/providers/ai-sdk/sandbox-tools';
import type { AgentProvider } from '../../../src/backend/providers/types';
import type { JudgeClient } from '../types';

export interface LiveProviderOptions {
  /** Anthropic API key. Defaults to `process.env.ANTHROPIC_API_KEY`. */
  apiKey?: string;
  /** Default model spec. Default `anthropic/claude-sonnet-4-5`. */
  defaultModel?: string;
  /** Max tool-call steps per turn. Default 25. */
  maxSteps?: number;
  /** Expose the sandbox.* tools (grep/read/edit/run). Needs a real workspace. */
  withSandboxTools?: boolean;
}

/**
 * Dynamically load `ai` + `@ai-sdk/anthropic`, with a clear error if
 * absent. The specifiers are held in variables on purpose: `ai` and
 * `@ai-sdk/anthropic` are *optional* peer deps, so a literal `import('ai')`
 * would make `tsc` (and the offline scripted path) require them. A
 * non-literal specifier is typed `any`, keeping them truly optional.
 */
async function loadAiSdk(): Promise<{
  streamText: (cfg: unknown) => unknown;
  generateText: (cfg: unknown) => Promise<{ text: string }>;
  createAnthropic: (cfg: { apiKey: string }) => (modelId: string) => unknown;
}> {
  const aiPkg = 'ai';
  const anthropicPkg = '@ai-sdk/anthropic';
  try {
    const [ai, anthropic] = await Promise.all([
      import(aiPkg),
      import(anthropicPkg),
    ]);
    return {
      streamText: ai.streamText as never,
      generateText: ai.generateText as never,
      createAnthropic: anthropic.createAnthropic as never,
    };
  } catch (err) {
    throw new Error(
      'Live evals need `ai` and `@ai-sdk/anthropic` installed. ' +
        `Run \`pnpm add -D ai @ai-sdk/anthropic\` in pkg/plugins/agents. (${
          err instanceof Error ? err.message : String(err)
        })`,
    );
  }
}

function resolveKey(explicit?: string): string {
  const key = explicit ?? process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error('ANTHROPIC_API_KEY is not set — required for live evals.');
  }
  return key;
}

/** Build the real `aiSdkProvider` wired to Anthropic from an env key. */
export async function createLiveProvider(
  options: LiveProviderOptions = {},
): Promise<AgentProvider> {
  const { streamText, createAnthropic } = await loadAiSdk();
  const apiKey = resolveKey(options.apiKey);

  return aiSdkProvider({
    id: 'eval-ai-sdk',
    defaultModel: options.defaultModel ?? 'anthropic/claude-sonnet-4-5',
    maxSteps: options.maxSteps ?? 25,
    streamText: streamText as never,
    vendors: {
      anthropic: (cred, modelId) => createAnthropic({ apiKey: cred.apiKey })(modelId),
    },
    // Env-key resolver so the harness needs no credential store.
    resolveCredential: async () => ({ vendor: 'anthropic', apiKey }),
    ...(options.withSandboxTools
      ? { tools: ({ ensureWorkspace }) => buildSandboxTools(ensureWorkspace) }
      : {}),
  });
}

/** Build a {@link JudgeClient} backed by Anthropic (defaults to a cheap model). */
export async function createAnthropicJudge(options: {
  apiKey?: string;
  model?: string;
} = {}): Promise<JudgeClient> {
  const { generateText, createAnthropic } = await loadAiSdk();
  const apiKey = resolveKey(options.apiKey);
  const model = createAnthropic({ apiKey })(options.model ?? 'claude-sonnet-4-5');
  return async ({ system, prompt }) => {
    const out = await generateText({ model, system, prompt } as never);
    return out.text;
  };
}
