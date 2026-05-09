/**
 * `registerService` — wires the `AgentService` singleton into the
 * plugin's runtime registries.
 *
 * Owned by Stream A. Stream INT swaps `plugin.ts`'s stub
 * `registerService(ctx)` import for this real one once the kernel is
 * green; until then `plugin.ts` carries a stub that just logs.
 *
 * Design constraint: this file does the minimum amount of glue. The
 * service kernel doesn't depend on any other Phase 1 stream — it
 * consumes a `SessionContext` at the boundary. So registration is just
 * a constructor call + a registry assignment.
 */

import type { PluginContext } from '../plugin-context';
import { createAgentService } from './agent-service';

/**
 * Construct the `AgentService` singleton and stash it on
 * `ctx.registries.agentService`. Idempotent — re-running clobbers the
 * previous instance, which is fine because the service is stateless.
 */
export function registerService(ctx: PluginContext): void {
  const service = createAgentService();
  ctx.registries.agentService = service;
  ctx.logger.debug('[agents] AgentService registered');
}
