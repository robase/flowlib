/**
 * `agents()` — the plugin factory.
 *
 * Returns a `FlowlibPluginDefinition` whose `init()` constructs a single
 * `PluginContext` and hands it to a fixed list of subsystem `register*()`
 * functions. P0 ships stub registrars that no-op (they log a `debug`
 * line). Phase 1 streams replace each stub with the real implementation
 * when their PR lands; INT (Stream INT) flips the imports.
 *
 * Layering rule: this file is owned by P0 and INT only. No Phase 1
 * stream edits it directly — they all live behind a `register*()`
 * boundary.
 */

import type {
  FlowlibPlugin,
  FlowlibPluginDefinition,
  FlowlibPluginContext,
} from '@flowlib/core';
import { getGlobalActionRegistry } from '@flowlib/actions/registry';
import { agentSchema } from './schema/tables';
import type {
  PluginContext,
  ResolvedAgentsOptions,
  AgentsRuntimeRegistries,
} from './plugin-context';
import type { AgentsPluginPublicOptions } from '../shared/types';
import { DEFAULT_ORG_ID } from './auth/resolve-auth-context';

// ─── Stub register* functions ──────────────────────────────────────────
//
// Each stub is a no-op that records its invocation in the plugin's
// store. Phase 1 streams replace these with the real registrars. The
// list of register calls is the load-bearing piece — the order here
// is the order subsystems initialise in.

function registerProviders(ctx: PluginContext): void {
  ctx.logger.debug('[agents] registerProviders: stub — Stream B will replace');
}

function registerWorkspaces(ctx: PluginContext): void {
  ctx.logger.debug('[agents] registerWorkspaces: stub — Stream E will replace');
}

function registerService(ctx: PluginContext): void {
  ctx.logger.debug('[agents] registerService: stub — Stream A will replace');
}

function registerTools(ctx: PluginContext): void {
  ctx.logger.debug('[agents] registerTools: stub — Stream G will replace');
}

function registerEndpoints(ctx: PluginContext): void {
  ctx.logger.debug('[agents] registerEndpoints: stub — Stream I will replace');
}

function registerPermissions(ctx: PluginContext): void {
  ctx.logger.debug('[agents] registerPermissions: stub — Stream J will replace');
}

function registerPromptComposer(ctx: PluginContext): void {
  ctx.logger.debug('[agents] registerPromptComposer: stub — Stream K will replace');
}

function registerCloudflareDO(ctx: PluginContext): void {
  ctx.logger.debug('[agents] registerCloudflareDO: stub — Stream H will replace');
}

// ─── Options + context plumbing ────────────────────────────────────────

/** Public options shape exposed to consumers. */
export interface AgentsPluginOptions extends AgentsPluginPublicOptions {
  /**
   * Provider singletons to register (Claude Code, opencode, …). Order
   * matters for the picker UI — first is the default.
   */
  providers?: ReadonlyArray<import('./providers/types').AgentProvider>;
  /**
   * Workspace provider (cloudflareSandbox in v1). Optional — raw-LLM
   * agents (post-v1) operate without a workspace.
   */
  workspaceProvider?: import('./workspaces/types').WorkspaceProvider;
  /**
   * Whether new agents default `exposeFlowlibActions: true`. Per-agent
   * config can still override. Default false (opt-in).
   */
  exposeFlowlibActions?: boolean;
  /**
   * Tool ids hard-denied for every agent in this deployment (e.g.
   * `['Bash']` to block bash globally). Per-role/per-agent denies stack
   * on top.
   */
  defaultDenyList?: ReadonlyArray<string>;
  /**
   * Frontend plugin contributed via `agents({ frontend: agentsFrontendPlugin })`.
   * The backend extracts `.backend`; `<Flowlib>` extracts `.frontend`.
   */
  frontend?: unknown;
}

function resolveOptions(opts: AgentsPluginOptions = {}): ResolvedAgentsOptions {
  return {
    staticOrgId: opts.staticOrgId ?? DEFAULT_ORG_ID,
    orgScope: opts.orgScope ?? 'optional',
    providers: opts.providers ?? [],
    workspaceProvider: opts.workspaceProvider,
    exposeFlowlibActions: opts.exposeFlowlibActions ?? false,
    defaultDenyList: opts.defaultDenyList ?? [],
  };
}

function buildPluginContext(
  flowlib: FlowlibPluginContext,
  options: ResolvedAgentsOptions,
): PluginContext {
  const registries: AgentsRuntimeRegistries = {
    // `providers` is typed as a Map keyed by provider id. The shape
    // matches the conditional in `AgentsRuntimeRegistries`.
    providers: new Map() as AgentsRuntimeRegistries['providers'],
    workspaces: new Map(),
  };

  return {
    options,
    flowlib,
    actionRegistry: getGlobalActionRegistry(),
    registries,
    logger: flowlib.logger,
  };
}

// ─── Pre-flight checks ────────────────────────────────────────────────

function preflightCheck(
  options: ResolvedAgentsOptions,
  flowlib: FlowlibPluginContext,
): void {
  if (options.orgScope !== 'required') {return;}

  const hasAuthPlugin = flowlib.hasPlugin('user-auth') || flowlib.hasPlugin('auth');
  const hasStaticOrg = options.staticOrgId !== DEFAULT_ORG_ID;

  if (!hasAuthPlugin && !hasStaticOrg) {
    flowlib.logger.warn(
      '[agents] orgScope: "required" set but no auth plugin or staticOrgId is configured; ' +
        'falling back to "default-org" — every row will share the same tenant id. ' +
        'Configure `staticOrgId` or enable the auth plugin for true multi-tenancy.',
    );
  }
}

// ─── Factory ───────────────────────────────────────────────────────────

/**
 * Build the agents plugin.
 *
 * @example
 * ```ts
 * import { agents } from '@flowlib/agents';
 *
 * defineConfig({
 *   plugins: [
 *     agents({
 *       staticOrgId: 'acme',
 *       orgScope: 'required',
 *     }),
 *   ],
 * });
 * ```
 */
export function agents(options: AgentsPluginOptions = {}): FlowlibPluginDefinition {
  const resolved = resolveOptions(options);

  const backend: FlowlibPlugin = {
    id: 'agents',
    name: 'Agents',
    schema: agentSchema,
    setupInstructions:
      'Run `npx flowlib-cli generate` to create the agent_* tables, then `npx flowlib-cli migrate`.',

    async init(flowlib) {
      preflightCheck(resolved, flowlib);

      const ctx = buildPluginContext(flowlib, resolved);

      // The fixed register-call sequence. Order matters:
      //  1. Providers + workspaces stand up first (no deps).
      //  2. Service kernel binds against them.
      //  3. Tools layer subscribes to action-registry events.
      //  4. Endpoints register last, since they consume everything.
      registerProviders(ctx);
      registerWorkspaces(ctx);
      registerService(ctx);
      registerTools(ctx);
      registerPermissions(ctx);
      registerPromptComposer(ctx);
      registerCloudflareDO(ctx);
      registerEndpoints(ctx);

      ctx.logger.info('[agents] plugin initialised', {
        orgScope: resolved.orgScope,
        staticOrgId: resolved.staticOrgId,
      });
    },

    async shutdown() {
      // v1 has no resources to release at this layer — Phase 1 streams
      // wire shutdown through their own `register*()` returns once they
      // own real resources (provider singletons, sandbox handles, …).
    },
  };

  return {
    id: 'agents',
    name: 'Agents',
    backend,
    frontend: options.frontend,
  };
}
