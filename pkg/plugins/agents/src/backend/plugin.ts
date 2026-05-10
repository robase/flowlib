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
  FlowlibPluginEndpoint,
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

// ─── Real subsystem registrars (Phase 1 streams' work) ─────────────────
//
// `plugin.ts` wires together fixed-order calls into each owned
// subsystem's `register.ts`. Stream INT swapped P0's stubs for the
// real imports here. Anything Stream I lands later (endpoints) gets
// wired in the same fashion.

import { registerProviders as registerProvidersImpl } from './providers/register';
import { registerWorkspaces as registerWorkspacesImpl } from './workspaces/cloudflare-sandbox/register';
import { registerService as registerServiceImpl } from './service/register';
import { registerTools as registerToolsImpl } from './tools/register';
import { registerPermissions as registerPermissionsImpl } from './permissions/register';
import { registerAudit as registerAuditImpl } from './audit/register';
import { registerPromptComposer as registerPromptComposerImpl } from './prompt/register';
import { registerCloudflareDO as registerCloudflareDOImpl } from './cloudflare/register';
import { registerRepositories as registerRepositoriesImpl } from './repositories/register';
import { registerEndpoints as registerEndpointsImpl } from './endpoints/register';

function registerProviders(ctx: PluginContext): void {
  registerProvidersImpl(ctx, ctx.options.providers ?? []);
}

function registerWorkspaces(ctx: PluginContext): void {
  registerWorkspacesImpl(ctx);
}

function registerRepositories(ctx: PluginContext): void {
  registerRepositoriesImpl(ctx);
}

function registerService(ctx: PluginContext): void {
  registerServiceImpl(ctx);
}

function registerTools(ctx: PluginContext): void {
  registerToolsImpl(ctx);
}

function registerEndpoints(ctx: PluginContext, endpoints: FlowlibPluginEndpoint[]): void {
  registerEndpointsImpl(ctx, endpoints);
}

function registerPermissions(ctx: PluginContext): void {
  registerPermissionsImpl(ctx);
}

function registerAudit(ctx: PluginContext): void {
  registerAuditImpl(ctx);
}

function registerPromptComposer(ctx: PluginContext): void {
  registerPromptComposerImpl(ctx);
}

function registerCloudflareDO(ctx: PluginContext): void {
  registerCloudflareDOImpl(ctx);
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
    // opencode is the chat-first default — it talks to an opencode server
    // running inside the workspace sandbox and doesn't require an API key
    // at session-create time, so a fresh org can start chatting without
    // configuring a credential. claude-code is opt-in via
    // `agents({ defaultProviderId: 'claude-code' })`.
    defaultProviderId: opts.defaultProviderId ?? 'opencode',
    defaultModel: opts.defaultModel ?? 'anthropic/claude-sonnet-4-5',
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

function preflightCheck(options: ResolvedAgentsOptions, flowlib: FlowlibPluginContext): void {
  if (options.orgScope !== 'required') {
    return;
  }

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

  // Stream I owns this array: it's mounted on the FlowlibPlugin at
  // factory time (so framework adapters see a stable reference) and
  // populated during `init()` by `registerEndpoints`. Mutating in
  // place keeps the same `endpoints` reference live through restart.
  const endpoints: FlowlibPluginEndpoint[] = [];

  const backend: FlowlibPlugin = {
    id: 'agents',
    name: 'Agents',
    schema: agentSchema,
    endpoints,
    setupInstructions:
      'Run `npx flowlib-cli generate` to create the agent_* tables, then `npx flowlib-cli migrate`.',

    async init(flowlib) {
      preflightCheck(resolved, flowlib);

      const ctx = buildPluginContext(flowlib, resolved);

      // The fixed register-call sequence. Order matters:
      //  1. Repositories stand up first — everything else may consume them.
      //  2. Permissions + audit (depend on repositories).
      //  3. Providers + workspaces (no deps).
      //  4. Service kernel + prompt composer (depend on the above).
      //  5. Tools layer (subscribes to action-registry events; consumes
      //     permissions + workspace handle factories).
      //  6. Cloudflare DO surface (depends on the runtime singleton being
      //     populated with everything above).
      //  7. Endpoints register last, since they consume everything.
      registerRepositories(ctx);
      registerPermissions(ctx);
      registerAudit(ctx);
      registerProviders(ctx);
      registerWorkspaces(ctx);
      registerService(ctx);
      registerPromptComposer(ctx);
      registerTools(ctx);
      registerCloudflareDO(ctx);
      registerEndpoints(ctx, endpoints);

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
