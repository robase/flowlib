/**
 * Per-isolate registry that lets a Cloudflare Durable Object reach the
 * agents-plugin runtime that the Worker built during `init()`.
 *
 * # Why this exists
 *
 * In the Cloudflare Workers model the **dispatch Worker** and the
 * **Durable Object** classes share the same JS isolate. The Worker
 * imports the plugin at module-load time, calls `agents().init()`,
 * builds a `PluginContext`, populates `ctx.registries.*`, and stashes
 * those registries on the module-scoped variable below.
 *
 * When a request lands on a DO, the runtime synchronously instantiates
 * the DO class — but the DO class is in the *same isolate* as the
 * Worker, so this module-level singleton is already populated. The DO
 * just calls `getAgentsRuntime()` and gets the providers, repositories,
 * AgentService, hooks, etc. that the Worker built.
 *
 * # Why not pass it as DO state?
 *
 * `AgentsRuntimeRegistries` carries **live JS objects** (provider
 * singletons holding open SDK clients, the AgentService instance with
 * its closures over Drizzle). Those objects can't round-trip through
 * `ctx.storage` and can't ride on a binding.
 *
 * # Lifecycle gotcha
 *
 * The plugin **must register before the first DO request lands**. In
 * Workers semantics this is automatic: the Worker's `init()` runs as
 * part of module load, which happens before the runtime dispatches any
 * request to either the Worker fetch handler *or* a DO method. Streams
 * that introduce alternative dispatch paths (e.g. cron triggers, queue
 * consumers) need to remember to load the agents plugin from the same
 * Worker entry to keep this invariant.
 *
 * # Tests
 *
 * Unit tests can inject a fake runtime via `setAgentsRuntime(fake)`
 * and clear it in `afterEach` with `clearAgentsRuntime()`. The DO
 * tests in this folder do exactly that.
 */

import type { AgentsRuntimeRegistries } from '../plugin-context';

/**
 * Module-scoped singleton holding the runtime registries set during
 * the host Worker's `init()`.
 */
let runtime: AgentsRuntimeRegistries | null = null;

/**
 * Stash the agents-plugin runtime registries on the isolate-global
 * singleton. Called from `register.ts` during plugin init.
 *
 * Idempotent — re-registration replaces the previous reference. This
 * is intentional so hot-module-reload during local dev still works.
 */
export function setAgentsRuntime(registries: AgentsRuntimeRegistries): void {
  runtime = registries;
}

/**
 * Read the runtime registries set by `setAgentsRuntime`. Throws when
 * unset, because every code path that calls this assumes the plugin
 * is wired up.
 *
 * @throws if no runtime has been registered yet.
 */
export function getAgentsRuntime(): AgentsRuntimeRegistries {
  if (!runtime) {
    throw new Error(
      '[agents] runtime not registered — the consumer Worker must call ' +
        '`createFlowlib({ plugins: [agents(...)] })` before any Durable ' +
        'Object request lands. Stream H docs cover the wrangler.jsonc ' +
        'wiring.',
    );
  }
  return runtime;
}

/**
 * Reset the singleton. Test-only — production code paths never need to
 * unregister, since the isolate dies with the deployment.
 */
export function clearAgentsRuntime(): void {
  runtime = null;
}

/**
 * Probe whether a runtime has been registered without throwing. Used
 * by health checks and tests.
 */
export function hasAgentsRuntime(): boolean {
  return runtime !== null;
}
