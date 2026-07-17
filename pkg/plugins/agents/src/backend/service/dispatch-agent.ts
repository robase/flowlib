/**
 * `dispatch_agent` — spawn a **read-only** exploration sub-turn (mirrors
 * Claude Code's Task/Agent tool). The sub-agent runs the same provider loop
 * with a restricted, read-only toolset and an isolated event sink; its
 * streamed text is captured and returned to the parent as a findings
 * summary, keeping deep exploration out of the parent's context window.
 *
 * Constraints (see docs/coding-agent-parity-plan.md A5 + Part D/E):
 *   - **Read-only**: only `SUBAGENT_READ_ONLY_TOOLS` are enabled, so the
 *     sub-agent can search/read/run but not write/edit/clone/push.
 *   - **Depth capped at 1**: `dispatch_agent` is NOT in the read-only set,
 *     so a sub-agent cannot dispatch its own sub-agent.
 *   - **No HIL**: the sub-agent gets no decision gate (it can't prompt the
 *     user); it must work from the task alone.
 *   - **Isolated**: a no-op persistence callback set + a capture-only `emit`
 *     mean the sub-turn neither persists messages nor streams to the user.
 *   - **Gated**: only offered when the deployment opts in (`agents({
 *     subAgents: true })`) — it is token-heavy.
 */

import type { AgentEvent } from '../../shared/events';
import type { ProviderToolDescriptor, PromptInput } from '../providers/types';
import type { AgentService, PersistenceCallbacks, SessionContext } from './types';

/**
 * Tools a dispatched sub-agent may use. Deliberately excludes every
 * mutating tool (`write_file`/`edit_file`/`multi_edit`/`clone`/`run_task`/
 * `git`) and `dispatch_agent` itself (depth cap = 1).
 */
export const SUBAGENT_READ_ONLY_TOOLS: readonly string[] = [
  'sandbox.grep',
  'sandbox.glob',
  'sandbox.read_file',
  'sandbox.list_files',
  'sandbox.run_shell',
  'web.fetch',
];

/** Default cap on the returned summary length. */
const DEFAULT_MAX_SUMMARY_CHARS = 8_000;

const NOOP_CALLBACKS: PersistenceCallbacks = {
  onMessageStart: () => Promise.resolve(),
  onTextDelta: () => Promise.resolve(),
  onToolCall: () => Promise.resolve(),
  onToolResult: () => Promise.resolve(),
  onFileEdit: () => Promise.resolve(),
  onMessageComplete: () => Promise.resolve(),
  onTurnEnd: () => Promise.resolve(),
};

/** The slice of the parent session a sub-turn needs to run in isolation. */
export type SubAgentBase = Pick<
  SessionContext,
  | 'sessionId'
  | 'providerSessionId'
  | 'auth'
  | 'provider'
  | 'workspace'
  | 'hooks'
  | 'permissions'
  | 'logger'
  | 'abortSignal'
  | 'defaultModel'
  | 'providerTools'
>;

export interface DispatchAgentDeps {
  /** The kernel — runs the sub-turn. */
  agentService: AgentService;
  /** Parent-session pieces the sub-turn reuses. */
  base: SubAgentBase;
  /** Cap on returned summary length. */
  maxSummaryChars?: number;
}

/**
 * Build the `dispatch_agent` provider tool. The host wires it (gated on the
 * `subAgents` option) with the parent session's pieces + the agent service.
 */
export function buildDispatchAgentTool(deps: DispatchAgentDeps): ProviderToolDescriptor {
  const maxChars = deps.maxSummaryChars ?? DEFAULT_MAX_SUMMARY_CHARS;
  return {
    description:
      'Dispatch a read-only exploration sub-agent to investigate a focused ' +
      'question and report back a concise summary — without filling your own ' +
      'context with the intermediate search/read steps. Good for "where/how is ' +
      'X implemented?", "trace the callers of Y", "summarise how Z works". The ' +
      'sub-agent can only search/read/run (grep, glob, read_file, list_files, ' +
      'run_shell, web.fetch) — it cannot edit files or dispatch further ' +
      'sub-agents. Returns { summary }.',
    parameters: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description:
            'A self-contained investigation task. Be specific — the sub-agent ' +
            'sees only this text, not the conversation.',
        },
      },
      required: ['task'],
      additionalProperties: false,
    },
    execute: async (raw, options) => {
      const task = String(raw.task ?? '').trim();
      if (!task) {
        return { error: 'dispatch_agent: `task` must be a non-empty string.' };
      }
      options.abortSignal?.throwIfAborted?.();

      // Capture-only sink: collect the sub-agent's streamed text; never
      // forward to the user-facing transport.
      const chunks: string[] = [];
      const capture = (event: AgentEvent): void => {
        if (event.type === 'text-delta') {
          chunks.push(event.text);
        }
      };

      const abortSignal = options.abortSignal ?? deps.base.abortSignal;
      const subContext: SessionContext = {
        sessionId: deps.base.sessionId,
        providerSessionId: deps.base.providerSessionId,
        auth: deps.base.auth,
        provider: deps.base.provider,
        ...(deps.base.workspace ? { workspace: deps.base.workspace } : {}),
        hooks: deps.base.hooks,
        permissions: deps.base.permissions,
        logger: deps.base.logger,
        callbacks: NOOP_CALLBACKS,
        emit: capture,
        abortSignal,
        ...(deps.base.defaultModel ? { defaultModel: deps.base.defaultModel } : {}),
        // Read-only allowlist — also filters out `dispatch_agent` itself
        // (depth cap) and every mutating tool.
        enabledTools: SUBAGENT_READ_ONLY_TOOLS,
        ...(deps.base.providerTools ? { providerTools: deps.base.providerTools } : {}),
        // No decisionGate: the sub-agent cannot prompt the user.
      };

      const framedTask =
        'You are a read-only exploration sub-agent. Investigate the request ' +
        'below using only read-only tools, then report a concise findings ' +
        'summary (cite files/lines where relevant). Do not attempt to modify ' +
        `anything.\n\nRequest: ${task}`;
      const promptInput: PromptInput = {
        providerSessionId: deps.base.providerSessionId,
        parts: [{ type: 'text', text: framedTask }],
        abortSignal,
        enabledTools: SUBAGENT_READ_ONLY_TOOLS,
        ...(deps.base.defaultModel ? { model: deps.base.defaultModel } : {}),
        ...(deps.base.providerTools ? { providerTools: deps.base.providerTools } : {}),
      };

      const result = await deps.agentService.runTurn(subContext, promptInput);

      let summary = chunks.join('');
      const truncated = summary.length > maxChars;
      if (truncated) {
        summary = `${summary.slice(0, maxChars)}\n…(summary truncated)`;
      }
      return {
        summary: summary || '(the sub-agent produced no textual summary)',
        reason: result.reason,
        toolCalls: result.toolCallCount,
        truncated,
      };
    },
  };
}
