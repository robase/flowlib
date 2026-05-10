/**
 * `AgentService` — the orchestration kernel surface.
 *
 * Thin class wrapper around `runTurn`. Lives as a singleton on
 * `ctx.registries.agentService`; consumed by:
 *  - Stream H (Cloudflare Durable Object) — the DO's `onMessage`
 *    handler builds a `SessionContext` and calls
 *    `agentService.runTurn(ctx, prompt)`.
 *  - Stream I (REST endpoints) — Mode 1 uses it directly; Mode 2 hands
 *    off to the DO which then calls back through here.
 *
 * Provider-agnostic, table-agnostic. Never imports from `repositories/`
 * or any specific provider package — that's the rule that lets the
 * flow-editor chat assistant share this kernel later.
 */

import type { AgentService as AgentServiceContract, RunResult, SessionContext } from './types';
import type { PromptInput } from '../providers/types';
import { runTurn } from './run-turn';

/**
 * Default `AgentService` implementation. Stateless — every instance
 * delegates to the pure `runTurn` function.
 */
export class AgentService implements AgentServiceContract {
  /** Run one user-prompt turn against the supplied context. */
  runTurn(ctx: SessionContext, prompt: PromptInput): Promise<RunResult> {
    return runTurn(ctx, prompt);
  }
}

/**
 * Factory — returns a fresh `AgentService` singleton. Stream A's
 * `register.ts` calls this; tests can call it too without going through
 * the plugin context.
 */
export function createAgentService(): AgentService {
  return new AgentService();
}
