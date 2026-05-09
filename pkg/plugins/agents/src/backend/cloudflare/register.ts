/**
 * `registerCloudflareDO` — Stream H's contribution to the agents-plugin
 * `init()` sequence.
 *
 * Two responsibilities:
 *
 *  1. **Stash the runtime registries on the per-isolate singleton.**
 *     The Durable Object class can't see the `PluginContext` that
 *     the Worker built — those references live as closures in the
 *     Worker's `init()`. The DO and the Worker share the same JS
 *     isolate, so a module-level singleton in
 *     `cloudflare/runtime-singleton.ts` bridges the two. By the time
 *     the runtime has dispatched any DO request, `init()` has already
 *     run (Workers semantics), so the singleton is always populated.
 *
 *  2. **Expose the DO class on `ctx.registries.cloudflareDoClass`** so
 *     the integrator's Worker can re-export it from a single source of
 *     truth (`export { AgentChatDO } from '@flowlib/agents'`).
 *
 * This file is wired into the plugin during INT (Phase 2). Until INT
 * lands, the plugin's `plugin.ts` ships a stub `registerCloudflareDO`
 * that just logs — INT replaces the import with the real one below.
 */

import type { PluginContext } from '../plugin-context';

import { AgentChatDO } from './chat-agent-do';
import { setAgentsRuntime } from './runtime-singleton';

/**
 * Register the Cloudflare Durable Object surface with the plugin
 * runtime. Called from `plugin.ts` during `init()`.
 *
 * Idempotent — safe to call multiple times in a hot-reload loop.
 */
export function registerCloudflareDO(ctx: PluginContext): void {
  // Make the runtime registries reachable from inside the DO class.
  setAgentsRuntime(ctx.registries);

  // Expose the DO class for downstream consumers (e.g. the consumer
  // Worker that re-exports it for its `wrangler.jsonc` migration).
  ctx.registries.cloudflareDoClass = AgentChatDO;

  ctx.logger.debug(
    '[agents] Cloudflare DO class registered (AgentChatDO) — ' +
      'remember to declare `new_sqlite_classes: ["AgentChatDO"]` in ' +
      'wrangler.jsonc migrations.',
  );
}
