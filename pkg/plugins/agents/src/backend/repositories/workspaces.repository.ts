/**
 * Persistence for `agent_workspaces`.
 *
 * Tenant scoped.
 */

import type { PluginDatabaseApi } from '@flowlib/core';
import type { AgentVisibility, AgentWorkspace, WorkspaceProviderId } from '../../shared/types';
import type { AgentsDB } from './db-types';
import { encodeJsonOrNull, generateId, nowFor, parseJsonOrNull, toIso } from './util';

interface AgentWorkspaceRow {
  id: string;
  org_id: string | null;
  name: string;
  workspace_provider_id: string;
  root_path: string | null;
  git_remote: string | null;
  git_branch: string | null;
  sandbox_config: unknown;
  project_id: string | null;
  created_by: string;
  visibility: string;
  created_at: string | Date;
  updated_at: string | Date;
}

export interface CreateWorkspaceInput {
  id?: string;
  orgId: string | null;
  name: string;
  workspaceProviderId: WorkspaceProviderId;
  rootPath?: string | null;
  gitRemote?: string | null;
  gitBranch?: string | null;
  sandboxConfig?: Record<string, unknown> | null;
  projectId?: string | null;
  createdBy: string;
  visibility?: AgentVisibility;
}

export interface UpdateWorkspaceInput {
  name?: string;
  workspaceProviderId?: WorkspaceProviderId;
  rootPath?: string | null;
  gitRemote?: string | null;
  gitBranch?: string | null;
  sandboxConfig?: Record<string, unknown> | null;
  projectId?: string | null;
  visibility?: AgentVisibility;
}

export interface ListWorkspacesFilter {
  orgId?: string | null;
  workspaceProviderId?: WorkspaceProviderId;
  projectId?: string;
  createdBy?: string;
  visibility?: AgentVisibility;
  limit?: number;
  offset?: number;
}

function mapRow(row: AgentWorkspaceRow): AgentWorkspace {
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    workspaceProviderId: row.workspace_provider_id as WorkspaceProviderId,
    rootPath: row.root_path,
    gitRemote: row.git_remote,
    gitBranch: row.git_branch,
    sandboxConfig: parseJsonOrNull<Record<string, unknown>>(row.sandbox_config),
    projectId: row.project_id,
    createdBy: row.created_by,
    visibility: row.visibility as AgentVisibility,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export class WorkspacesRepository {
  constructor(private readonly database: PluginDatabaseApi) {}

  async findById(id: string, orgId?: string | null): Promise<AgentWorkspace | null> {
    let query = this.database
      .kysely<AgentsDB>()
      .selectFrom('agent_workspaces')
      .selectAll()
      .where('id', '=', id);
    if (orgId !== undefined) {
      query =
        orgId === null ? query.where('org_id', 'is', null) : query.where('org_id', '=', orgId);
    }
    const row = await query.limit(1).executeTakeFirst();
    return row ? mapRow(row as unknown as AgentWorkspaceRow) : null;
  }

  async list(filter: ListWorkspacesFilter = {}): Promise<AgentWorkspace[]> {
    let query = this.database.kysely<AgentsDB>().selectFrom('agent_workspaces').selectAll();
    if (filter.orgId !== undefined) {
      query =
        filter.orgId === null
          ? query.where('org_id', 'is', null)
          : query.where('org_id', '=', filter.orgId);
    }
    if (filter.workspaceProviderId !== undefined) {
      query = query.where('workspace_provider_id', '=', filter.workspaceProviderId);
    }
    if (filter.projectId !== undefined) {
      query = query.where('project_id', '=', filter.projectId);
    }
    if (filter.createdBy !== undefined) {
      query = query.where('created_by', '=', filter.createdBy);
    }
    if (filter.visibility !== undefined) {
      query = query.where('visibility', '=', filter.visibility);
    }
    query = query.orderBy('created_at', 'desc');
    if (filter.limit !== undefined) {
      query = query.limit(filter.limit);
    }
    if (filter.offset !== undefined) {
      query = query.offset(filter.offset);
    }
    const rows = await query.execute();
    return rows.map((row) => mapRow(row as unknown as AgentWorkspaceRow));
  }

  async create(input: CreateWorkspaceInput): Promise<AgentWorkspace> {
    const id = input.id ?? generateId();
    const now = nowFor(this.database);

    await this.database
      .kysely<AgentsDB>()
      .insertInto('agent_workspaces')
      .values({
        id,
        org_id: input.orgId,
        name: input.name,
        workspace_provider_id: input.workspaceProviderId,
        root_path: input.rootPath ?? null,
        git_remote: input.gitRemote ?? null,
        git_branch: input.gitBranch ?? null,
        sandbox_config: encodeJsonOrNull(input.sandboxConfig ?? null),
        project_id: input.projectId ?? null,
        created_by: input.createdBy,
        visibility: input.visibility ?? 'private',
        created_at: now,
        updated_at: now,
      } as never)
      .execute();

    const created = await this.findById(id, input.orgId);
    if (!created) {
      throw new Error('Failed to load created workspace');
    }
    return created;
  }

  async update(
    id: string,
    patch: UpdateWorkspaceInput,
    orgId?: string | null,
  ): Promise<AgentWorkspace | null> {
    const set: Record<string, unknown> = {};
    if (patch.name !== undefined) {
      set.name = patch.name;
    }
    if (patch.workspaceProviderId !== undefined) {
      set.workspace_provider_id = patch.workspaceProviderId;
    }
    if (patch.rootPath !== undefined) {
      set.root_path = patch.rootPath;
    }
    if (patch.gitRemote !== undefined) {
      set.git_remote = patch.gitRemote;
    }
    if (patch.gitBranch !== undefined) {
      set.git_branch = patch.gitBranch;
    }
    if (patch.sandboxConfig !== undefined) {
      set.sandbox_config = encodeJsonOrNull(patch.sandboxConfig);
    }
    if (patch.projectId !== undefined) {
      set.project_id = patch.projectId;
    }
    if (patch.visibility !== undefined) {
      set.visibility = patch.visibility;
    }

    if (Object.keys(set).length === 0) {
      return this.findById(id, orgId);
    }
    set.updated_at = nowFor(this.database);

    let query = this.database
      .kysely<AgentsDB>()
      .updateTable('agent_workspaces')
      .set(set as never)
      .where('id', '=', id);
    if (orgId !== undefined) {
      query =
        orgId === null ? query.where('org_id', 'is', null) : query.where('org_id', '=', orgId);
    }
    await query.execute();

    return this.findById(id, orgId);
  }

  async delete(id: string, orgId?: string | null): Promise<void> {
    let query = this.database
      .kysely<AgentsDB>()
      .deleteFrom('agent_workspaces')
      .where('id', '=', id);
    if (orgId !== undefined) {
      query =
        orgId === null ? query.where('org_id', 'is', null) : query.where('org_id', '=', orgId);
    }
    await query.execute();
  }
}
