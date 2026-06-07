/**
 * `registerRepositories(ctx)` — populates `ctx.registries.repositories`
 * with a factory that constructs the typed repository bag from a
 * per-request `PluginDatabaseApi`.
 *
 * The plugin's `init(flowlib)` runs before any HTTP request lands, but
 * `flowlib.database` (the singleton runtime database) is not part of the
 * current `FlowlibPluginContext` surface — `database` only enters the
 * picture via `PluginEndpointContext`. We therefore expose a factory
 * here and let endpoints call it with the request's database handle.
 *
 * Stream I (endpoints) wires this up. Stream A (orchestrator / hooks)
 * also calls the factory whenever it has a database handle (e.g. when
 * persisting messages emitted by a provider stream). The factory shape
 * keeps the pattern aligned with the webhooks plugin
 * (`pkg/plugins/webhooks/src/backend/plugin.ts:getRepository(ctx)`).
 */

import type { PluginDatabaseApi } from '@flowlib/core';
import type { PluginContext } from '../plugin-context';
import { AuditRepository } from './audit.repository';
import { McpServersRepository } from './mcp-servers.repository';
import { MessagesRepository } from './messages.repository';
import { ProjectsRepository } from './projects.repository';
import { RolePermissionsRepository } from './role-permissions.repository';
import { SessionsRepository } from './sessions.repository';
import { SkillsRepository } from './skills.repository';
import { WorkspacesRepository } from './workspaces.repository';

/** The bag of repositories handed to subsystems / endpoints. */
export interface Repositories {
  mcpServers: McpServersRepository;
  workspaces: WorkspacesRepository;
  sessions: SessionsRepository;
  messages: MessagesRepository;
  projects: ProjectsRepository;
  skills: SkillsRepository;
  audit: AuditRepository;
  rolePermissions: RolePermissionsRepository;
}

/** Construct a fresh repositories bag bound to a database handle. */
export function buildRepositories(database: PluginDatabaseApi): Repositories {
  return {
    mcpServers: new McpServersRepository(database),
    workspaces: new WorkspacesRepository(database),
    sessions: new SessionsRepository(database),
    messages: new MessagesRepository(database),
    projects: new ProjectsRepository(database),
    skills: new SkillsRepository(database),
    audit: new AuditRepository(database),
    rolePermissions: new RolePermissionsRepository(database),
  };
}

/**
 * The slot stored in `ctx.registries.repositories`. Endpoints invoke
 * this on each request with `ctx.database` to materialise the bag.
 */
export type RepositoriesFactory = (database: PluginDatabaseApi) => Repositories;

/**
 * Stream F entrypoint — called by the plugin orchestrator during
 * `init()`. v1 keeps the slot a pure factory so subsystems remain
 * stateless w.r.t. the database handle.
 */
export function registerRepositories(ctx: PluginContext): void {
  ctx.registries.repositories = buildRepositories satisfies RepositoriesFactory;
  ctx.logger.debug('[agents] registerRepositories: factory installed');
}
