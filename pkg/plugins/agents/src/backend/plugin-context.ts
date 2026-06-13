/**
 * `PluginContext` — the bag of dependencies the plugin's `init()` builds
 * once and hands to every `register*()` subsystem.
 *
 * Each Phase 1 stream owns one `register.ts` file per subsystem; that
 * file accepts a `PluginContext` and extends the runtime with its
 * registrations (provider, workspace, endpoint, hook, …). P0 ships
 * stub `register*` functions that no-op.
 */

import type { ActionRegistry } from '@flowlib/actions/registry';
import type { FlowlibPluginContext } from '@flowlib/core';
import type { AgentsPluginPublicOptions } from '../shared/types';

/**
 * Subsystem registries the plugin maintains in-process. v1 streams
 * populate these during `init()`; the orchestrator (Stream A) and
 * endpoints (Stream I) read them at request time.
 *
 * **All Phase 1 slots are declared upfront** so streams can populate
 * them without all editing the same interface block. Slots are
 * `undefined` until their stream's `register*()` runs; consumers
 * (Stream A, Stream I) check before use.
 */
export interface AgentsRuntimeRegistries {
  /** Agent provider registry — Stream B. */
  providers: Map<string, import('./providers/types').AgentProvider>;
  /** Workspace provider registry — Stream E. */
  workspaces: Map<string, import('./workspaces/types').WorkspaceProvider>;
  /** AgentService singleton — Stream A. */
  agentService?: unknown;
  /** Repositories bag — Stream F. */
  repositories?: unknown;
  /** Permissions resolver — Stream J. */
  permissions?: unknown;
  /**
   * Credentials accessor (`flowlib.credentials`), threaded to providers so
   * `aiSdkProvider` can resolve a chat's attached credential without the
   * host hand-wiring `resolveCredential`. Set during `init()`.
   */
  credentials?: import('./providers/types').AgentCredentialsAccessor;
  /** Audit log writer — Stream J. */
  auditWriter?: unknown;
  /** System prompt composer — Stream K. */
  promptComposer?: unknown;
  /** Flowlib-actions MCP bridge factory — Stream G. */
  flowlibActionsMcp?: unknown;
  /** Tool output store — Stream G. */
  toolOutputStore?: unknown;
  /** Hook pipeline — Stream A (kernel) + S1+ (handlers populate it). */
  hookPipeline?: unknown;
  /** Cloudflare AIChatAgent DO class export — Stream H. */
  cloudflareDoClass?: unknown;
}

/**
 * Resolved options object — internal use only. Defaults filled in.
 */
export interface ResolvedAgentsOptions extends AgentsPluginPublicOptions {
  staticOrgId: string;
  orgScope: 'optional' | 'required';
  /** Provider singletons (Claude Code, opencode, etc.) registered at init. */
  providers: ReadonlyArray<import('./providers/types').AgentProvider>;
  /**
   * Workspace providers registered at init (e.g. `cloudflareSandbox`,
   * `cloudflareSandboxClaude`). Each entry is keyed by its provider id;
   * workspace rows persist that id and endpoints look it up here.
   *
   * The first entry is the implicit default when `POST /workspaces`
   * omits an explicit `workspaceProviderId`.
   */
  workspaceProviders: ReadonlyArray<import('./workspaces/types').WorkspaceProvider>;
  /** Whether new agents default `exposeFlowlibActions: true`. Default false. */
  exposeFlowlibActions: boolean;
  /** Tool ids hard-denied for every agent in this deployment (e.g. `['Bash']`). */
  defaultDenyList: ReadonlyArray<string>;
  /**
   * Cloudflare `AgentChatDO` class, injected by Cloudflare hosts via
   * `agents({ cloudflareDoClass })`. Stashed onto
   * `registries.cloudflareDoClass`. Undefined on Express/Node hosts.
   */
  cloudflareDoClass?: unknown;
  /**
   * Provider id used when `POST /sessions` omits `providerId`. Must
   * match one of the registered providers' ids. Defaults to
   * `'claude-code'`.
   */
  defaultProviderId: string;
  /**
   * Model id used when `POST /sessions` omits `model`. Defaults to
   * `'claude-sonnet-4-5'`.
   */
  defaultModel: string;
}

/**
 * The context every subsystem registrar receives.
 *
 * v1 keeps this intentionally small — it grows as Phase 1 streams add
 * their own services (repositories, tool-output store, audit writer,
 * …). Each addition is a small P0 patch, not a Phase 1 surface change.
 */
export interface PluginContext {
  /** Resolved plugin options (defaults applied). */
  options: ResolvedAgentsOptions;
  /** Flowlib's plugin init context (logger, store, getFlowlib, …). */
  flowlib: FlowlibPluginContext;
  /** The shared `@flowlib/actions` registry — used by the MCP bridge. */
  actionRegistry: ActionRegistry;
  /** Per-subsystem in-process registries. */
  registries: AgentsRuntimeRegistries;
  /** Logger bound to the agents plugin scope. */
  logger: FlowlibPluginContext['logger'];
}
