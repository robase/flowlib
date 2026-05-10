/**
 * Persistence for `agent_projects`.
 *
 * Tenant scoped. Projects act as a container for related workspaces.
 * No public DTO yet — internal `AgentProject` type defined here.
 */

import type { PluginDatabaseApi } from '@flowlib/core';
import type { AgentsDB } from './db-types';
import { generateId, nowFor, toIso } from './util';

export interface AgentProject {
  id: string;
  orgId: string | null;
  name: string;
  description: string | null;
  gitRemote: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

interface AgentProjectRow {
  id: string;
  org_id: string | null;
  name: string;
  description: string | null;
  git_remote: string | null;
  created_by: string;
  created_at: string | Date;
  updated_at: string | Date;
}

export interface CreateProjectInput {
  id?: string;
  orgId: string | null;
  name: string;
  description?: string | null;
  gitRemote?: string | null;
  createdBy: string;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string | null;
  gitRemote?: string | null;
}

export interface ListProjectsFilter {
  orgId?: string | null;
  createdBy?: string;
  gitRemote?: string;
  limit?: number;
  offset?: number;
}

function mapRow(row: AgentProjectRow): AgentProject {
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    description: row.description,
    gitRemote: row.git_remote,
    createdBy: row.created_by,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export class ProjectsRepository {
  constructor(private readonly database: PluginDatabaseApi) {}

  async findById(id: string, orgId?: string | null): Promise<AgentProject | null> {
    let query = this.database
      .kysely<AgentsDB>()
      .selectFrom('agent_projects')
      .selectAll()
      .where('id', '=', id);
    if (orgId !== undefined) {
      query =
        orgId === null ? query.where('org_id', 'is', null) : query.where('org_id', '=', orgId);
    }
    const row = await query.limit(1).executeTakeFirst();
    return row ? mapRow(row as unknown as AgentProjectRow) : null;
  }

  async list(filter: ListProjectsFilter = {}): Promise<AgentProject[]> {
    let query = this.database.kysely<AgentsDB>().selectFrom('agent_projects').selectAll();
    if (filter.orgId !== undefined) {
      query =
        filter.orgId === null
          ? query.where('org_id', 'is', null)
          : query.where('org_id', '=', filter.orgId);
    }
    if (filter.createdBy !== undefined) {
      query = query.where('created_by', '=', filter.createdBy);
    }
    if (filter.gitRemote !== undefined) {
      query = query.where('git_remote', '=', filter.gitRemote);
    }
    query = query.orderBy('created_at', 'desc');
    if (filter.limit !== undefined) {
      query = query.limit(filter.limit);
    }
    if (filter.offset !== undefined) {
      query = query.offset(filter.offset);
    }
    const rows = await query.execute();
    return rows.map((row) => mapRow(row as unknown as AgentProjectRow));
  }

  async create(input: CreateProjectInput): Promise<AgentProject> {
    const id = input.id ?? generateId();
    const now = nowFor(this.database);

    await this.database
      .kysely<AgentsDB>()
      .insertInto('agent_projects')
      .values({
        id,
        org_id: input.orgId,
        name: input.name,
        description: input.description ?? null,
        git_remote: input.gitRemote ?? null,
        created_by: input.createdBy,
        created_at: now,
        updated_at: now,
      } as never)
      .execute();

    const created = await this.findById(id, input.orgId);
    if (!created) {
      throw new Error('Failed to load created project');
    }
    return created;
  }

  async update(
    id: string,
    patch: UpdateProjectInput,
    orgId?: string | null,
  ): Promise<AgentProject | null> {
    const set: Record<string, unknown> = {};
    if (patch.name !== undefined) {
      set.name = patch.name;
    }
    if (patch.description !== undefined) {
      set.description = patch.description;
    }
    if (patch.gitRemote !== undefined) {
      set.git_remote = patch.gitRemote;
    }

    if (Object.keys(set).length === 0) {
      return this.findById(id, orgId);
    }
    set.updated_at = nowFor(this.database);

    let query = this.database
      .kysely<AgentsDB>()
      .updateTable('agent_projects')
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
    let query = this.database.kysely<AgentsDB>().deleteFrom('agent_projects').where('id', '=', id);
    if (orgId !== undefined) {
      query =
        orgId === null ? query.where('org_id', 'is', null) : query.where('org_id', '=', orgId);
    }
    await query.execute();
  }
}
