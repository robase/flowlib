/**
 * `registerTools` — Stream G's subsystem registrar.
 *
 * Wires two factories onto `ctx.registries`:
 *
 *   - `flowlibActionsMcp` — per-session MCP server factory. Stream A
 *     calls it once per agent turn (or once per session, then reuses the
 *     server for the whole session) to get a fresh MCP server attached
 *     to the caller's user/session/permissions.
 *   - `toolOutputStore` — workspace-attached tool-output truncation +
 *     overflow store factory. Same usage pattern: build one per
 *     session, hand to the kernel.
 *
 * Both slots are pre-declared on `AgentsRuntimeRegistries` (P0).
 *
 * The slots store factory functions, not concrete instances, because
 * the bridge needs per-session state (userId, sessionId, the workspace
 * handle the session was bound to). Stream A and Stream INT call these
 * factories during session bootstrap.
 */

import type { PluginContext } from '../plugin-context';
import type { PermissionsResolver } from '../permissions/types';
import type { WorkspaceHandle } from '../workspaces/types';
import {
  createFlowlibActionsMcpServer,
  type CredentialsLister,
  type CreateFlowlibActionsMcpServerOptions,
  type FlowlibActionsMcpHandle,
} from './flowlib-actions-mcp';
import {
  createToolOutputStore,
  type CreateToolOutputStoreOptions,
  type ToolOutputStore,
} from './tool-output-store';

/**
 * Per-session inputs Stream A supplies when materialising the MCP
 * bridge. The plugin-side registrar already owns `registry`, `logger`,
 * and the credentials API (when available); the kernel adds the
 * user/session/workspace pieces.
 */
export interface FlowlibActionsMcpFactoryInputs {
  userId: string;
  sessionId: string;
  permissions: PermissionsResolver;
  /**
   * Workspace handle. Optional — when absent the bridge runs in
   * raw-LLM mode (overflow held in the in-memory `ToolOutputStore`
   * map; agent retrieves via `read_tool_output` MCP tool).
   */
  workspace?: WorkspaceHandle;
  /** Optional override; defaults to the bridge's tool-output store factory. */
  toolOutputStore?: ToolOutputStore;
  /** Optional override for the credentials lister (e.g. tenant-scoped). */
  credentialsLister?: CredentialsLister;
  /**
   * Optional bridge to Stream A's call-site context. The kernel passes
   * `{ buildNodeContext, abortSignal, … }` per call.
   */
  callHooks?: CreateFlowlibActionsMcpServerOptions['callHooks'];
  /**
   * Optional hook for the per-call deny-list resolution. Stream A's
   * loop typically supplies `() => ({ auth, sessionId, … })` so the
   * resolver has the right scope.
   */
  resolveDenyListInput?: CreateFlowlibActionsMcpServerOptions['resolveDenyListInput'];
}

/**
 * Factory shape stored on `ctx.registries.flowlibActionsMcp`. Stream A
 * calls it per session (or per turn).
 */
export type FlowlibActionsMcpFactory = (
  inputs: FlowlibActionsMcpFactoryInputs,
) => FlowlibActionsMcpHandle;

/**
 * Factory shape stored on `ctx.registries.toolOutputStore`. Stream A
 * calls it per session. Workspace handles are passed at `store()`
 * time, so the factory doesn't need them up-front.
 */
export type ToolOutputStoreFactory = (
  inputs?: CreateToolOutputStoreOptions,
) => ToolOutputStore;

/**
 * Register both factories onto the plugin's runtime registries.
 *
 * Returns the factories for callers (and tests) that prefer to skip
 * the registry round-trip.
 */
export function registerTools(ctx: PluginContext): {
  flowlibActionsMcp: FlowlibActionsMcpFactory;
  toolOutputStore: ToolOutputStoreFactory;
} {
  const logger = ctx.logger;
  const registry = ctx.actionRegistry;

  const credentialsLister = resolveCredentialsLister(ctx);

  const flowlibActionsMcp: FlowlibActionsMcpFactory = (inputs) => {
    return createFlowlibActionsMcpServer({
      registry,
      userId: inputs.userId,
      sessionId: inputs.sessionId,
      permissions: inputs.permissions,
      workspace: inputs.workspace,
      toolOutputStore: inputs.toolOutputStore,
      credentialsLister: inputs.credentialsLister ?? credentialsLister,
      callHooks: inputs.callHooks,
      resolveDenyListInput: inputs.resolveDenyListInput,
      // Cast — the plugin's logger surface is structurally compatible
      // with action-kit's `Logger`.
      logger: logger as unknown as Parameters<
        typeof createFlowlibActionsMcpServer
      >[0]['logger'],
    });
  };

  const toolOutputStore: ToolOutputStoreFactory = (inputs) => {
    return createToolOutputStore({
      ...(inputs ?? {}),
      logger: inputs?.logger ?? logger,
    });
  };

  ctx.registries.flowlibActionsMcp = flowlibActionsMcp;
  ctx.registries.toolOutputStore = toolOutputStore;

  logger.info('[agents] tools registered (flowlibActionsMcp + toolOutputStore factories)');

  return { flowlibActionsMcp, toolOutputStore };
}

/**
 * Best-effort resolution of a `CredentialsLister` from the Flowlib
 * plugin context. `getFlowlib()` is lazy — it throws when called before
 * the service layer is ready. We defer the resolution to first call so
 * registration itself never fails.
 */
function resolveCredentialsLister(ctx: PluginContext): CredentialsLister | undefined {
  // `flowlib.getFlowlib()` returns `FlowlibInstance` whose `credentials`
  // sub-API exposes `list(filters?)`. We adapt that to the lister
  // interface lazily — at first call, not at register time.
  let cached: CredentialsLister | undefined;
  let resolved = false;

  const lister: CredentialsLister = {
    async list(filters) {
      if (!resolved) {
        try {
          const flowlib = ctx.flowlib.getFlowlib?.();
          if (flowlib && typeof flowlib === 'object' && 'credentials' in flowlib) {
            const creds = (flowlib as { credentials?: { list?: CredentialsLister['list'] } })
              .credentials;
            if (creds?.list) {
              cached = { list: creds.list.bind(creds) };
            }
          }
        } catch (err) {
          ctx.logger.debug(
            '[agents] credentials lister unavailable; credential capability checks disabled: ' +
              (err instanceof Error ? err.message : String(err)),
          );
        }
        resolved = true;
      }
      if (!cached) return [];
      return cached.list(filters);
    },
  };

  return lister;
}
