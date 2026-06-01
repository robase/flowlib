/**
 * Per-isolate registry that lets a Cloudflare Durable Object reach the
 * agents-plugin runtime built by the host Worker.
 *
 * # Why this exists
 *
 * The Worker fetch handler and each Durable Object instance run in
 * **separate JS isolates** in the Cloudflare runtime. The Worker's
 * `createFlowlib({ plugins: [agents(...)] })` call only populates the
 * `runtime` singleton inside the *Worker isolate* — every DO isolate
 * starts empty.
 *
 * To bridge that gap, the host registers a `bootstrap` function at
 * **module load time** (the top of the Worker entry file). Module load
 * runs in every isolate that loads the script, so the bootstrap
 * reference is available inside DO isolates too. On the first DO
 * request the DO calls `ensureAgentsRuntime(env, orgId)`, which
 * synchronously short-circuits if `runtime` is already set and
 * otherwise awaits the bootstrap. The bootstrap is responsible for
 * calling `createFlowlib(...)` (or equivalent) so that the agents
 * plugin's `init()` runs in the DO isolate, which in turn calls
 * `setAgentsRuntime(...)` and populates the singleton.
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

import type { PluginDatabaseApi } from '@flowlib/core';
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

/**
 * Host-provided per-isolate bootstrap. Called by `ensureAgentsRuntime`
 * the first time a DO request lands in an isolate where the runtime
 * has not yet been populated. The host registers this once at the top
 * of its Worker entry module via `setAgentsRuntimeBootstrapper(...)`;
 * because module load runs in every isolate that loads the script,
 * the registration is automatically visible in DO isolates.
 *
 * The function receives the Worker `env` plus the `orgId` parsed from
 * the DO name, and is responsible for calling whatever the host uses
 * to build a Flowlib instance with `agents()` in its plugin list.
 * That `createFlowlib` call's `init()` chain ends up calling
 * `setAgentsRuntime(...)`, which populates the singleton for the
 * duration of the isolate.
 */
export type AgentsRuntimeBootstrap = (env: unknown, orgId: string) => Promise<unknown>;

let bootstrap: AgentsRuntimeBootstrap | null = null;

/**
 * Register the host's per-isolate runtime bootstrap. Call this at
 * **module top level** in the Worker entry — not inside any handler
 * — so that DO isolates pick it up during module load.
 */
export function setAgentsRuntimeBootstrapper(fn: AgentsRuntimeBootstrap): void {
  bootstrap = fn;
}

/**
 * Return the runtime registries, lazily running the host-provided
 * bootstrap if the singleton is empty in the current isolate.
 *
 * Throws if both the singleton and the bootstrap are missing — that
 * means neither the host's Worker init nor the host's bootstrap
 * registration has run in this isolate, which is a wiring bug.
 */
export async function ensureAgentsRuntime(
  env: unknown,
  orgId: string,
): Promise<AgentsRuntimeRegistries> {
  if (runtime) {
    return runtime;
  }
  if (!bootstrap) {
    throw new Error(
      '[agents] runtime not registered and no bootstrap available in this ' +
        'isolate. The host Worker must either call `createFlowlib({ ' +
        'plugins: [agents(...)] })` before any DO request lands, or call ' +
        '`setAgentsRuntimeBootstrapper((env, orgId) => Promise<void>)` at ' +
        'the top of the Worker entry module so DO isolates can bootstrap ' +
        'themselves on first use.',
    );
  }
  await bootstrap(env, orgId);
  if (!runtime) {
    throw new Error(
      '[agents] bootstrap completed but the runtime singleton is still ' +
        'empty — the bootstrap must call `createFlowlib({ plugins: ' +
        "[agents(...)] })` (or otherwise trigger the agents plugin's " +
        'init() which calls setAgentsRuntime).',
    );
  }
  return runtime;
}

/** Test-only: unregister the bootstrap. */
export function clearAgentsRuntimeBootstrapper(): void {
  bootstrap = null;
}

/**
 * Resolver for a `PluginDatabaseApi` bound to the current isolate's
 * Flowlib instance. The agents plugin's `registerCloudflareDO` install
 * a closure here at init time so the DO can build the repositories bag
 * without having to discover the database connection on every turn.
 *
 * Separate from `bootstrap` because the bootstrap is host-supplied
 * (Worker-entry top level), whereas the database resolver is wired by
 * the plugin itself once Flowlib has finished initialising. Both live
 * on this module so the DO has a single import surface.
 */
let databaseResolver: (() => PluginDatabaseApi) | null = null;

export function setAgentsDatabaseResolver(fn: () => PluginDatabaseApi): void {
  databaseResolver = fn;
}

export function getAgentsDatabaseApi(): PluginDatabaseApi {
  if (!databaseResolver) {
    throw new Error(
      '[agents] database resolver not registered — `registerCloudflareDO` ' +
        'should have installed it during plugin init. This usually means ' +
        'the agents plugin failed to initialise in this isolate.',
    );
  }
  return databaseResolver();
}

/** Test-only: unregister the database resolver. */
export function clearAgentsDatabaseResolver(): void {
  databaseResolver = null;
}
