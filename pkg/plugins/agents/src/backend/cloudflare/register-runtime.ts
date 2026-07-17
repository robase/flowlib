/**
 * `registerCloudflareRuntime` — the **light** half of the Cloudflare
 * wiring, called unconditionally from the plugin factory's `init()`.
 *
 * It stashes the runtime registries + a database-resolver closure on the
 * per-isolate singleton (`runtime-singleton.ts`) so that, *if* an
 * `AgentChatDO` instance is later created by the Cloudflare runtime, it
 * can reach the plugin's services and lazily materialise repositories.
 *
 * Crucially this module imports **no** Cloudflare/Agents SDK — unlike the
 * DO class itself (`chat-agent-do.ts`, which imports `agents/ai-chat-agent`).
 * That keeps `import { agents } from '@flowlib/agents'` free of the
 * Cloudflare runtime, so the plugin can boot on Express/Node hosts that
 * only need its REST surface. The DO class is injected separately via
 * `agents({ cloudflareDoClass })` on Cloudflare hosts — see
 * `AgentsPluginOptions.cloudflareDoClass`.
 */

import { createPluginDatabaseApi, type PluginDatabaseApi } from '@flowlib/core';
import type { PluginContext } from '../plugin-context';
import { setAgentsRuntime, setAgentsDatabaseResolver } from './runtime-singleton';

/**
 * Wire the per-isolate runtime bridge. Idempotent — safe across
 * hot-reload restarts.
 */
export function registerCloudflareRuntime(ctx: PluginContext): void {
  // Make the runtime registries reachable from inside the DO class.
  setAgentsRuntime(ctx.registries);

  // The repositories slot holds a *factory* keyed by a `PluginDatabaseApi`.
  // Endpoints get the database from their request-scoped context, but the
  // DO has none — stash a closure capturing this isolate's Flowlib
  // instance so the DO can lazily materialise repositories per turn.
  setAgentsDatabaseResolver((): PluginDatabaseApi => {
    const flowlib = ctx.flowlib.getFlowlib();
    return createPluginDatabaseApi(flowlib.plugins.getDatabaseConnection());
  });

  // The DO class itself (`cloudflareDoClass`) is injected via plugin
  // options on Cloudflare hosts and stashed by the factory — it is NOT
  // imported here, to keep this module free of the Agents SDK.
}
