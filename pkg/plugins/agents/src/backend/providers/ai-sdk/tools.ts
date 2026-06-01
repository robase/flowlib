/**
 * Tool catalogue plumbing for the AI SDK provider.
 *
 * Phase 1 ships only the stub tools (`echo`, `now`) — just enough to
 * prove that multi-step tool turns work end-to-end. Phases 2/3 of the
 * migration plan add the real catalogue:
 *
 *   - Phase 2: sandbox-backed filesystem tools (`read_file`,
 *     `write_file`, `edit_file`, `list_directory`, `search_files`,
 *     `run_shell`, `git`). Each is a flowlib action that maps to a
 *     single short `containerFetch` call — no SSE-over-RPC pain.
 *
 *   - Phase 3: existing flowlib actions exposed via the action
 *     registry → agent tool registry bridge. Per-session allowlist
 *     drives which subset shows up to the LLM.
 *
 * The shape this module exports is a function the provider calls per
 * `prompt(input)` invocation. That's deliberate — tool sets are
 * per-turn, since `enabledTools` / `extraDenied` can vary between
 * turns within the same session.
 */

import type { PromptInput } from '../types';

/**
 * The minimum tool shape we hand to `streamText`. We don't import
 * `ai`'s `Tool` type directly to keep this file's compile-time
 * surface narrow — the `ai` package is a peer dep and we want the
 * provider to load fine even when only some subset is installed.
 *
 * Matches the AI SDK v3+ tool descriptor shape: a JSON-schema-like
 * `parameters` (we use `zod` schemas at the boundary and convert), a
 * `description`, and an `execute` callback. AI SDK calls `execute`
 * with the parsed input; whatever we return becomes the `tool-result`
 * passed back to the LLM.
 */
export interface AiSdkToolDescriptor {
  description: string;
  /**
   * Parameters schema as Zod or a plain JSON-Schema object. We use
   * plain JSON Schema in this stub to avoid importing `zod` here.
   * The real catalogue (Phases 2/3) will use Zod via flowlib actions.
   */
  parameters: Record<string, unknown>;
  /**
   * Run the tool. Receives the parsed input and an options bag with
   * `abortSignal`. Returns a result the LLM sees as the
   * `tool-result`. Throw to signal an error (we map this to an
   * is-error tool-result downstream).
   */
  execute: (
    input: Record<string, unknown>,
    options: { abortSignal?: AbortSignal },
  ) => Promise<unknown>;
}

export type AiSdkToolSet = Record<string, AiSdkToolDescriptor>;

/**
 * Build the per-turn tool set for the AI SDK call.
 *
 * Today: returns the two stub tools, filtered by `enabledTools` /
 * `extraDenied` from the prompt input. The signature accepts
 * everything the future catalogue will need so we can extend without
 * a contract change.
 */
export function buildToolSet(input: PromptInput): AiSdkToolSet {
  const denied = new Set<string>(input.extraDenied ?? []);
  const allowlist =
    input.enabledTools && input.enabledTools.length > 0
      ? new Set<string>(input.enabledTools)
      : null;

  const all: AiSdkToolSet = {
    echo: {
      description:
        'Echoes the provided text back to the assistant. Useful only for ' +
        'testing tool-call wiring during development.',
      parameters: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: 'The text to echo back.',
          },
        },
        required: ['text'],
        additionalProperties: false,
      },
      execute: async (raw) => {
        const text = typeof raw.text === 'string' ? raw.text : '';
        return { echoed: text };
      },
    },
    now: {
      description:
        'Returns the current server-side ISO-8601 timestamp. Useful for ' +
        'time-aware prompts during development and as a smoke-test tool.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      execute: async () => ({ now: new Date().toISOString() }),
    },
  };

  const filtered: AiSdkToolSet = {};
  for (const [name, descriptor] of Object.entries(all)) {
    if (denied.has(name)) {
      continue;
    }
    if (allowlist && !allowlist.has(name)) {
      continue;
    }
    filtered[name] = descriptor;
  }
  return filtered;
}
