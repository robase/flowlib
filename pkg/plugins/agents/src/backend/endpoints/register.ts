/**
 * `registerEndpoints` — Stream I's subsystem registrar.
 *
 * Builds the full list of `FlowlibPluginEndpoint` for the agents
 * plugin and returns it. The plugin orchestrator (`plugin.ts`) is
 * responsible for assigning the result onto `backend.endpoints`.
 *
 * Why "build + return" rather than "mutate ctx"?
 *
 * `FlowlibPlugin.endpoints` is a static field on the plugin object —
 * the plugin manager reads it via `plugin.endpoints` after `init()`
 * completes (see `pkg/core/src/services/plugin-manager.ts:165`). So
 * the plugin orchestrator just needs to assign the registrar's
 * output onto the field before the request router queries it.
 *
 * Tenant scoping, auth-context resolution, and 404-on-cross-tenant
 * are all enforced inside the per-resource endpoint factories.
 *
 * Order matters: this registrar runs **last** in the plugin's `init()`
 * sequence (after repositories, providers, workspaces, service,
 * tools, cloudflare DO) so every dependency is in place by the time
 * a request lands.
 */

import type { FlowlibPluginEndpoint } from '@flowlib/core';
import type { PluginContext } from '../plugin-context';
import { createMcpServersEndpoints } from './mcp-servers.endpoint';
import { createWorkspacesEndpoints } from './workspaces.endpoint';
import { createSessionsEndpoints } from './sessions.endpoint';
import { createProjectsEndpoints } from './projects.endpoint';
import { createFilesEndpoints } from './files.endpoint';
import { createCredentialsEndpoints } from './credentials.endpoint';

/**
 * Build all REST endpoints for the agents plugin.
 *
 * @returns The full set of `FlowlibPluginEndpoint`s the plugin
 *   contributes. Order is: mcp-servers → workspaces → sessions →
 *   projects → files. `:id`-bearing routes go after their static
 *   siblings so frameworks that match in declaration order resolve
 *   `/workspaces/:id/files` correctly without conflicting with
 *   `/workspaces/:id`.
 */
export function buildEndpoints(ctx: PluginContext): FlowlibPluginEndpoint[] {
  return [
    ...createMcpServersEndpoints(ctx),
    ...createWorkspacesEndpoints(ctx),
    ...createSessionsEndpoints(ctx),
    ...createProjectsEndpoints(ctx),
    ...createFilesEndpoints(ctx),
    ...createCredentialsEndpoints(ctx),
  ];
}

/**
 * Subsystem registrar called by `plugin.ts`. Builds the endpoint list
 * and pushes the entries into the supplied `target` array (typically
 * `backend.endpoints`, which `plugin.ts` initialises to `[]` at
 * factory-build time so framework adapters see a stable array
 * reference).
 *
 * Idempotent — re-running clears the target first.
 */
export function registerEndpoints(
  ctx: PluginContext,
  target: FlowlibPluginEndpoint[],
): FlowlibPluginEndpoint[] {
  const endpoints = buildEndpoints(ctx);
  target.length = 0;
  for (const ep of endpoints) {
    target.push(ep);
  }
  ctx.logger.info(`[agents] ${endpoints.length} endpoints registered`);
  return target;
}
