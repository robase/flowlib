/**
 * Plugin Manager
 *
 * Manages the lifecycle of Flowlib plugins: initialization, hook execution,
 * endpoint collection, and shutdown.
 *
 * Created during `Flowlib.initialize()` and shared with framework adapters.
 */

import type {
  FlowlibPlugin,
  FlowlibPluginContext,
  FlowlibPluginInitResult,
  PluginHookRunner,
  FlowRunHookContext,
  NodeExecutionHookContext,
  FlowlibPluginEndpoint,
  PluginDatabaseApi,
} from 'src/types/plugin.types';
import type { FlowlibIdentity, FlowlibPermission, AuthorizationResult } from 'src/types/auth.types';
import type { ActionDefinition } from '@flowlib/action-kit';
import type { FlowlibInstance } from 'src/api/types';

// =============================================================================
// Plugin Manager
// =============================================================================

type ManagerLogger = {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

const noop = (): void => undefined;
const noopLogger: ManagerLogger = {
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
};

export class PluginManager implements PluginHookRunner {
  private plugins: FlowlibPlugin[] = [];
  private pluginMap = new Map<string, FlowlibPlugin>();
  private pluginStores = new Map<string, Map<string, unknown>>();
  private _initialized = false;
  // Logger captured during initializePlugins so hooks called outside the
  // init path (e.g. runOnAuthorize on every request) can log without a
  // logger being threaded through the call site.
  private logger: ManagerLogger = noopLogger;

  constructor(plugins: FlowlibPlugin[] = []) {
    // Validate: no duplicate IDs
    const ids = new Set<string>();
    for (const plugin of plugins) {
      if (ids.has(plugin.id)) {
        throw new Error(`Duplicate plugin ID: "${plugin.id}". Each plugin must have a unique ID.`);
      }
      ids.add(plugin.id);
      this.pluginMap.set(plugin.id, plugin);
      this.pluginStores.set(plugin.id, new Map());
    }
    this.plugins = [...plugins];
  }

  /**
   * Initialize all plugins in order.
   * Called during `Flowlib.initialize()` after action registry is created.
   */
  async initializePlugins(opts: {
    config: Record<string, unknown>;
    logger: ManagerLogger;
    registerAction: (action: ActionDefinition) => void;
    getFlowlib: () => FlowlibInstance;
  }): Promise<FlowlibPluginInitResult[]> {
    this.logger = opts.logger;
    const results: FlowlibPluginInitResult[] = [];

    for (const plugin of this.plugins) {
      const context: FlowlibPluginContext = {
        config: opts.config,
        logger: opts.logger,
        hasPlugin: (id: string) => this.pluginMap.has(id),
        getPlugin: (id: string) => this.pluginMap.get(id) ?? null,
        registerAction: opts.registerAction,
        store: this.pluginStores.get(plugin.id) ?? new Map(),
        getFlowlib: opts.getFlowlib,
      };

      opts.logger.debug(`Initializing plugin: ${plugin.id}`);

      try {
        // Register plugin-provided actions
        if (plugin.actions?.length) {
          for (const action of plugin.actions) {
            opts.registerAction(action);
          }
          opts.logger.info(`Plugin "${plugin.id}" registered ${plugin.actions.length} action(s)`);
        }

        // Call plugin init
        if (plugin.init) {
          const result = await plugin.init(context);
          if (result) {
            results.push(result);
          }
        }

        opts.logger.info(`Plugin "${plugin.id}" initialized`);
      } catch (error) {
        opts.logger.error(`Plugin "${plugin.id}" initialization failed:`, error);
        throw new Error(
          `Plugin "${plugin.id}" initialization failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    this._initialized = true;
    return results;
  }

  /**
   * Shut down all plugins in reverse order.
   */
  async shutdownPlugins(logger: {
    info: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  }): Promise<void> {
    // Shutdown in reverse order (last initialized → first shutdown)
    for (let i = this.plugins.length - 1; i >= 0; i--) {
      const plugin = this.plugins[i];
      if (!plugin) {
        continue;
      }
      if (plugin.shutdown) {
        try {
          await plugin.shutdown();
          logger.info(`Plugin "${plugin.id}" shut down`);
        } catch (error) {
          logger.error(`Plugin "${plugin.id}" shutdown failed:`, error);
        }
      }
    }
  }

  // ===== Accessors =====

  hasPlugin(id: string): boolean {
    return this.pluginMap.has(id);
  }

  getPlugin(id: string): FlowlibPlugin | null {
    return this.pluginMap.get(id) ?? null;
  }

  getPlugins(): readonly FlowlibPlugin[] {
    return this.plugins;
  }

  /**
   * Collect all endpoints from all plugins.
   */
  getPluginEndpoints(): FlowlibPluginEndpoint[] {
    return this.plugins.flatMap((p) => p.endpoints ?? []);
  }

  /**
   * Collect all error codes from all plugins.
   */
  getPluginErrorCodes(): Record<string, { message: string; status?: number }> {
    const merged: Record<string, { message: string; status?: number }> = {};
    for (const plugin of this.plugins) {
      if (plugin.$ERROR_CODES) {
        Object.assign(merged, plugin.$ERROR_CODES);
      }
    }
    return merged;
  }

  // ===== Hook Runner Implementation =====

  async runBeforeFlowRun(
    context: FlowRunHookContext,
  ): Promise<{ cancelled: boolean; reason?: string; inputs?: Record<string, unknown> }> {
    let currentInputs = context.inputs;

    for (const plugin of this.plugins) {
      const hook = plugin.hooks?.beforeFlowRun;
      if (!hook) {
        continue;
      }

      try {
        const result = await hook({ ...context, inputs: currentInputs });
        if (result?.cancel) {
          return { cancelled: true, reason: result.reason || `Cancelled by plugin "${plugin.id}"` };
        }
        if (result?.inputs) {
          currentInputs = result.inputs;
        }
      } catch (error) {
        return {
          cancelled: true,
          reason: `Plugin "${plugin.id}" beforeFlowRun hook threw: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    return { cancelled: false, inputs: currentInputs };
  }

  async runAfterFlowRun(
    context: FlowRunHookContext & {
      status: 'SUCCESS' | 'FAILED' | 'CANCELLED';
      outputs?: Record<string, unknown>;
      error?: string;
      duration?: number;
    },
  ): Promise<void> {
    for (const plugin of this.plugins) {
      const hook = plugin.hooks?.afterFlowRun;
      if (!hook) {
        continue;
      }

      try {
        await hook(context);
      } catch {
        // afterFlowRun hooks should not crash the system — log and continue
      }
    }
  }

  async runBeforeNodeExecute(
    context: NodeExecutionHookContext,
  ): Promise<{ skipped: boolean; params?: Record<string, unknown> }> {
    let currentParams = context.params;

    for (const plugin of this.plugins) {
      const hook = plugin.hooks?.beforeNodeExecute;
      if (!hook) {
        continue;
      }

      try {
        const result = await hook({ ...context, params: currentParams });
        if (result?.skip) {
          return { skipped: true };
        }
        if (result?.params) {
          currentParams = result.params;
        }
      } catch {
        // Skip on error to prevent plugin bugs from breaking flow execution
      }
    }

    return { skipped: false, params: currentParams };
  }

  async runAfterNodeExecute(
    context: NodeExecutionHookContext & {
      status: 'SUCCESS' | 'FAILED' | 'SKIPPED';
      output?: unknown;
      error?: string;
      errorDetails?: import('@flowlib/action-kit').NodeErrorDetails;
      duration?: number;
    },
  ): Promise<{ output?: unknown }> {
    let currentOutput = context.output;

    for (const plugin of this.plugins) {
      const hook = plugin.hooks?.afterNodeExecute;
      if (!hook) {
        continue;
      }

      try {
        const result = await hook({ ...context, output: currentOutput });
        if (result?.output !== undefined) {
          currentOutput = result.output;
        }
      } catch {
        // Don't let plugin errors crash node execution
      }
    }

    return { output: currentOutput };
  }

  async runAfterAgentExecute(context: {
    flowRunId: string;
    flowId: string;
    nodeId: string;
    model?: string;
    tokensIn: number;
    tokensOut: number;
    toolCallCount: number;
    durationMs: number;
  }): Promise<void> {
    for (const plugin of this.plugins) {
      const hook = plugin.hooks?.afterAgentExecute;
      if (!hook) {
        continue;
      }
      try {
        await hook(context);
      } catch {
        // Don't let plugin errors crash agent execution
      }
    }
  }

  async runOnRequest(
    request: Request,
    context: { path: string; method: string; identity: FlowlibIdentity | null },
  ): Promise<{ intercepted: boolean; response?: Response; request?: Request }> {
    let currentRequest = request;

    for (const plugin of this.plugins) {
      const hook = plugin.hooks?.onRequest;
      if (!hook) {
        continue;
      }

      try {
        const result = await hook(currentRequest, context);
        if (result && 'response' in result) {
          return { intercepted: true, response: result.response };
        }
        if (result && 'request' in result) {
          currentRequest = result.request;
        }
      } catch {
        // Don't let plugin errors crash request handling
      }
    }

    return { intercepted: false, request: currentRequest };
  }

  async runOnResponse(
    response: Response,
    context: { path: string; method: string; identity: FlowlibIdentity | null },
  ): Promise<Response> {
    let currentResponse = response;

    for (const plugin of this.plugins) {
      const hook = plugin.hooks?.onResponse;
      if (!hook) {
        continue;
      }

      try {
        const result = await hook(currentResponse, context);
        if (result?.response) {
          currentResponse = result.response;
        }
      } catch {
        // Don't let plugin errors crash response handling
      }
    }

    return currentResponse;
  }

  async runOnAuthorize(context: {
    identity: FlowlibIdentity | null;
    action: FlowlibPermission;
    resource?: { type: string; id?: string };
    database?: PluginDatabaseApi;
  }): Promise<AuthorizationResult | null> {
    // Deny-wins, fail-closed.
    //
    // Previously this was first-match-wins with errors silently swallowed,
    // so a permissive plugin loaded after a restrictive one (e.g. RBAC)
    // could shadow its denial, and a restrictive plugin throwing in its
    // deny path would simply be skipped — letting the next plugin allow.
    //
    // New semantics:
    //   - Any plugin returning {allowed:false} → deny immediately.
    //   - A plugin throwing → treat as deny (fail closed) and stop.
    //   - Any plugin returning {allowed:true} → remember it, but keep
    //     checking later plugins for a deny.
    //   - If we reach the end with an allow remembered, return it.
    //   - If no plugin had an opinion, return null (caller's default applies).
    let allow: AuthorizationResult | null = null;
    for (const plugin of this.plugins) {
      const hook = plugin.hooks?.onAuthorize;
      if (!hook) {
        continue;
      }

      let result: AuthorizationResult | void;
      try {
        result = await hook(context);
      } catch (error) {
        // Fail closed: a hook that throws while computing authorization
        // cannot be trusted to have allowed the request.
        this.logger.error(
          `[plugin-manager] onAuthorize hook for plugin "${plugin.id}" threw — denying`,
          error,
        );
        return { allowed: false, reason: 'authorization_hook_error' };
      }

      if (!result || typeof result.allowed !== 'boolean') {
        continue;
      }
      if (result.allowed === false) {
        return result;
      }
      // Remember the first allow; later denies still win.
      if (!allow) {
        allow = result;
      }
    }

    return allow;
  }
}
