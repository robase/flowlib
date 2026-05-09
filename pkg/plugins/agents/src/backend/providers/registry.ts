/**
 * `ProviderRegistry` — in-process map of provider id → `AgentProvider`.
 *
 * Stream B owns this file. The registry is constructed once at plugin
 * init by `register.ts`, populated from the plugin options, and stored
 * on `PluginContext.registries.providers` for downstream consumers
 * (Stream A's orchestrator, Stream I's endpoints).
 *
 * Design notes:
 * - Wraps a `Map<string, AgentProvider>` so it can layer typed,
 *   error-throwing accessors on top of the bare Map slot declared in
 *   `plugin-context.ts`. The same `Map` instance is shared with the
 *   context, so plugin code that accesses `ctx.registries.providers`
 *   directly (legacy / debugging) still sees what the registry sees.
 * - `register()` enforces unique ids — duplicates throw with a clear
 *   message. Order of insertion is preserved (Map iteration order),
 *   which `list()` exposes.
 * - `get()` throws when the id is unknown, listing the known ids in
 *   the error so misconfigured agent rows fail loudly with an
 *   actionable hint.
 */

import type { AgentProvider } from './types';

export class ProviderRegistry {
  private readonly providers: Map<string, AgentProvider>;

  /**
   * @param backing Optional pre-existing Map to wrap. When supplied,
   * the registry shares state with the caller (used by `register.ts`
   * to keep `PluginContext.registries.providers` in sync). When
   * omitted, a fresh Map is created.
   */
  constructor(backing?: Map<string, AgentProvider>) {
    this.providers = backing ?? new Map<string, AgentProvider>();
  }

  /**
   * Register a provider. Throws if a provider with the same `id` is
   * already registered.
   */
  register(provider: AgentProvider): void {
    if (this.providers.has(provider.id)) {
      throw new Error(
        `[agents] provider with id "${provider.id}" is already registered`,
      );
    }
    this.providers.set(provider.id, provider);
  }

  /**
   * Resolve a provider by id. Throws with the list of known ids when
   * the requested id is unknown — this typically indicates a
   * misconfigured `agent_definitions.provider_id` row.
   */
  get(id: string): AgentProvider {
    const provider = this.providers.get(id);
    if (!provider) {
      const known = Array.from(this.providers.keys());
      const knownList = known.length > 0 ? known.join(', ') : '(none)';
      throw new Error(
        `[agents] unknown provider id "${id}"; registered providers: ${knownList}`,
      );
    }
    return provider;
  }

  /** @returns `true` when a provider with this id is registered. */
  has(id: string): boolean {
    return this.providers.has(id);
  }

  /** @returns Providers in registration (insertion) order. */
  list(): AgentProvider[] {
    return Array.from(this.providers.values());
  }
}

/**
 * Factory mirror of `new ProviderRegistry(backing)` — kept for
 * symmetry with other Flowlib subsystems that prefer factory
 * functions over `new`.
 */
export function createProviderRegistry(
  backing?: Map<string, AgentProvider>,
): ProviderRegistry {
  return new ProviderRegistry(backing);
}
