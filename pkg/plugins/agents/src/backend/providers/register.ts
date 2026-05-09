/**
 * `registerProviders` — Stream B's subsystem registrar.
 *
 * Wires a `ProviderRegistry` over `ctx.registries.providers` and
 * populates it from the supplied provider list. Called once during
 * plugin init by INT (see `plugin.ts`).
 *
 * Why the second `providers` parameter (rather than reading it off
 * `ctx.options`)?  The shared `AgentsPluginPublicOptions` type in
 * `pkg/plugins/agents/src/shared/types.ts` does NOT yet expose a
 * `providers` field — adding one is a P0 surface change. Stream B
 * keeps things shippable today by accepting the providers array
 * explicitly. INT can either:
 *   1. Add `providers?: AgentProvider[]` to `AgentsPluginPublicOptions`
 *      (small P0 patch) and call `registerProviders(ctx, ctx.options.providers)`.
 *   2. Or accept providers via a Stream-B-private extension on the
 *      plugin's own `AgentsPluginOptions` and forward through `init()`.
 *
 * Either path keeps Stream B's contract stable.
 */

import type { AgentProvider } from './types';
import type { PluginContext } from '../plugin-context';
import { ProviderRegistry } from './registry';

/**
 * Populate the plugin's provider registry.
 *
 * @param ctx       Plugin context built by `plugin.ts`.
 * @param providers Provider singletons to register, in load order.
 *                  Defaults to an empty list, which is valid (a host
 *                  may opt to register providers later via the
 *                  exported registry on `ctx.registries.providers`).
 */
export function registerProviders(
  ctx: PluginContext,
  providers: ReadonlyArray<AgentProvider> = [],
): void {
  const registry = new ProviderRegistry(ctx.registries.providers);

  for (const provider of providers) {
    registry.register(provider);
  }

  ctx.logger.info('[agents] provider registry initialised', {
    count: registry.list().length,
    ids: registry.list().map((p) => p.id),
  });
}
