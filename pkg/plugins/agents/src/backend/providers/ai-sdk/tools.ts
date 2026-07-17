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
import type { WorkspaceHandle } from '../../workspaces/types';
import type { ToolOutputStore, ToolOutputBudget } from '../../tools/tool-output-store';
import { TOOL_GUARD_EXTRA_KEY, type ToolGuard } from '../../service/run-turn';

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
    options: { abortSignal?: AbortSignal; toolCallId?: string },
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

/**
 * Merge the tool sources into the final per-turn catalogue and apply the
 * deny / allow filters.
 *
 * Precedence on name collision: `stubs` < `host` < `injected`. So a
 * plugin-injected tool (`skills.read`, `memory.*`) overrides a host tool
 * of the same name, which overrides a stub — the more authoritative
 * source wins. Deny removes a name outright; the allowlist (when set)
 * keeps only listed names.
 */
export function assembleToolSet(args: {
  stubs: AiSdkToolSet;
  host: AiSdkToolSet;
  injected?: AiSdkToolSet;
  denied: ReadonlySet<string>;
  allowlist: ReadonlySet<string> | null;
  onCollision?: (name: string) => void;
}): AiSdkToolSet {
  const merged: AiSdkToolSet = { ...args.stubs };
  const layer = (tools: AiSdkToolSet) => {
    for (const [name, descriptor] of Object.entries(tools)) {
      if (merged[name]) {
        args.onCollision?.(name);
      }
      merged[name] = descriptor;
    }
  };
  layer(args.host);
  if (args.injected) {
    layer(args.injected);
  }

  const out: AiSdkToolSet = {};
  for (const [name, descriptor] of Object.entries(merged)) {
    if (args.denied.has(name)) {
      continue;
    }
    if (args.allowlist && !args.allowlist.has(name)) {
      continue;
    }
    out[name] = descriptor;
  }
  return out;
}

/** Monotonic fallback id for the rare case the AI SDK omits `toolCallId`. */
let toolCallCounter = 0;
function fallbackCallId(name: string): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return `${name}-${c?.randomUUID?.() ?? `${Date.now()}-${++toolCallCounter}`}`;
}

/**
 * Wrap every tool's `execute` so its output passes through the
 * {@link ToolOutputStore}. Large results (a `run_shell` dumping a whole
 * file, a 10k-row action response) are truncated to the inline budget
 * and the full text spilled to the session workspace
 * (`.flowlib/tool-outputs/<id>.txt`), with a footer telling the model
 * where the rest lives. Small results pass through unchanged — including
 * their structured (object) shape, so the UI and model still get rich
 * tool results when they're cheap.
 *
 * This is the ai-sdk path's equivalent of the truncation the claude-code
 * MCP bridge already applies. Without it, one over-eager tool call floods
 * the context window and burns tokens.
 *
 * Truncation must never break a tool call: if the store throws for any
 * reason we fall back to the raw result.
 */
export function wrapToolsWithOutputStore(
  tools: AiSdkToolSet,
  store: ToolOutputStore,
  opts: {
    workspace?: WorkspaceHandle;
    /**
     * Lazy workspace getter, read at execute-time. Preferred over the
     * eager `workspace` so a sandbox provisioned mid-turn (e.g. by an
     * earlier `sandbox.*` tool call) becomes the spill target for later
     * tool results — without forcing a container to boot just to spill.
     * When it returns `undefined`, large outputs stay inline until a
     * workspace exists.
     */
    getWorkspace?: () => WorkspaceHandle | undefined;
    budget?: Partial<ToolOutputBudget>;
  } = {},
): AiSdkToolSet {
  const wrapped: AiSdkToolSet = {};
  for (const [name, descriptor] of Object.entries(tools)) {
    wrapped[name] = {
      description: descriptor.description,
      parameters: descriptor.parameters,
      execute: async (input, options) => {
        const result = await descriptor.execute(input, options);
        const toolCallId = options.toolCallId ?? fallbackCallId(name);
        const workspace = opts.getWorkspace?.() ?? opts.workspace;
        try {
          const stored = await store.store({
            toolCallId,
            output: result,
            ...(workspace ? { workspace } : {}),
            ...(opts.budget ? { budget: opts.budget } : {}),
          });
          // Preserve the original (possibly structured) result when it
          // fits — only coerce to the truncated string when we had to
          // spill.
          return stored.truncated ? stored.inline : result;
        } catch {
          return result;
        }
      },
    };
  }
  return wrapped;
}
