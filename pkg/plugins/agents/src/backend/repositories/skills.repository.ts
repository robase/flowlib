/**
 * Persistence for `agent_skills`.
 *
 * A skill is a named, reusable instruction block (Markdown body) the
 * agent can draw on. Scope is `global` (visible to everyone in the org)
 * or `personal` (visible only to its `ownerId`). The prompt composer
 * pulls the in-scope skills via `listForScope`; a future `skills.read`
 * tool resolves a single body by name via `findByName`.
 *
 * Tenant scoped — every query is bounded by `orgId`.
 */

import type { PluginDatabaseApi } from '@flowlib/core';
import type { AgentsDB } from './db-types';
import { generateId, nowFor, parseJson, toIso } from './util';

export type SkillScope = 'personal' | 'global';

export interface AgentSkill {
  id: string;
  orgId: string | null;
  name: string;
  description: string;
  body: string;
  scope: SkillScope;
  ownerId: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

interface AgentSkillRow {
  id: string;
  org_id: string | null;
  name: string;
  description: string;
  body: string;
  scope: string;
  owner_id: string | null;
  tags: string | string[] | null;
  created_at: string | Date;
  updated_at: string | Date;
}

export interface CreateSkillInput {
  id?: string;
  orgId: string | null;
  name: string;
  description: string;
  body: string;
  scope?: SkillScope;
  ownerId?: string | null;
  tags?: string[];
}

export interface UpdateSkillInput {
  name?: string;
  description?: string;
  body?: string;
  scope?: SkillScope;
  tags?: string[];
}

/**
 * Scope for `listForScope` — the org plus an optional user. Returns the
 * org's `global` skills, plus the user's own `personal` skills when
 * `userId` is supplied.
 */
export interface SkillsScope {
  orgId: string | null;
  userId?: string;
  /** Cap the number of skills returned. */
  limit?: number;
}

function mapRow(row: AgentSkillRow): AgentSkill {
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    description: row.description,
    body: row.body,
    scope: row.scope === 'global' ? 'global' : 'personal',
    ownerId: row.owner_id,
    tags: parseJson<string[]>(row.tags, []),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export class SkillsRepository {
  constructor(private readonly database: PluginDatabaseApi) {}

  /**
   * Skills visible to a session: the org's `global` skills plus the
   * user's `personal` skills. Two precise queries (rather than a single
   * `OR`) keep each one index-friendly and dialect-portable.
   */
  async listForScope(scope: SkillsScope): Promise<AgentSkill[]> {
    const out: AgentSkill[] = [];

    out.push(...(await this._query({ orgId: scope.orgId, scope: 'global' })));
    if (scope.userId) {
      out.push(
        ...(await this._query({ orgId: scope.orgId, scope: 'personal', ownerId: scope.userId })),
      );
    }

    // Stable order: name asc. Apply the cap after the merge.
    out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return scope.limit !== undefined ? out.slice(0, scope.limit) : out;
  }

  /**
   * Resolve a single skill the session can see by name. Personal skills
   * shadow globals of the same name when `userId` is supplied.
   */
  async findByName(
    name: string,
    scope: { orgId: string | null; userId?: string },
  ): Promise<AgentSkill | null> {
    if (scope.userId) {
      const personal = await this._query({
        orgId: scope.orgId,
        scope: 'personal',
        ownerId: scope.userId,
        name,
      });
      if (personal[0]) {
        return personal[0];
      }
    }
    const global = await this._query({ orgId: scope.orgId, scope: 'global', name });
    return global[0] ?? null;
  }

  async create(input: CreateSkillInput): Promise<AgentSkill> {
    const id = input.id ?? generateId();
    const now = nowFor(this.database);

    await this.database
      .kysely<AgentsDB>()
      .insertInto('agent_skills')
      .values({
        id,
        org_id: input.orgId,
        name: input.name,
        description: input.description,
        body: input.body,
        scope: input.scope ?? 'personal',
        owner_id: input.ownerId ?? null,
        tags: JSON.stringify(input.tags ?? []),
        created_at: now,
        updated_at: now,
      } as never)
      .execute();

    const created = await this.findById(id, input.orgId);
    if (!created) {
      throw new Error('Failed to load created skill');
    }
    return created;
  }

  async findById(id: string, orgId?: string | null): Promise<AgentSkill | null> {
    let query = this.database
      .kysely<AgentsDB>()
      .selectFrom('agent_skills')
      .selectAll()
      .where('id', '=', id);
    if (orgId !== undefined) {
      query =
        orgId === null ? query.where('org_id', 'is', null) : query.where('org_id', '=', orgId);
    }
    const row = await query.limit(1).executeTakeFirst();
    return row ? mapRow(row as unknown as AgentSkillRow) : null;
  }

  async update(
    id: string,
    patch: UpdateSkillInput,
    orgId?: string | null,
  ): Promise<AgentSkill | null> {
    const set: Record<string, unknown> = {};
    if (patch.name !== undefined) {
      set.name = patch.name;
    }
    if (patch.description !== undefined) {
      set.description = patch.description;
    }
    if (patch.body !== undefined) {
      set.body = patch.body;
    }
    if (patch.scope !== undefined) {
      set.scope = patch.scope;
    }
    if (patch.tags !== undefined) {
      set.tags = JSON.stringify(patch.tags);
    }
    if (Object.keys(set).length === 0) {
      return this.findById(id, orgId);
    }
    set.updated_at = nowFor(this.database);

    let query = this.database
      .kysely<AgentsDB>()
      .updateTable('agent_skills')
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
    let query = this.database.kysely<AgentsDB>().deleteFrom('agent_skills').where('id', '=', id);
    if (orgId !== undefined) {
      query =
        orgId === null ? query.where('org_id', 'is', null) : query.where('org_id', '=', orgId);
    }
    await query.execute();
  }

  /** Shared selector — applies the org / scope / owner / name filters. */
  private async _query(filter: {
    orgId: string | null;
    scope: SkillScope;
    ownerId?: string;
    name?: string;
  }): Promise<AgentSkill[]> {
    let query = this.database
      .kysely<AgentsDB>()
      .selectFrom('agent_skills')
      .selectAll()
      .where('scope', '=', filter.scope);
    query =
      filter.orgId === null
        ? query.where('org_id', 'is', null)
        : query.where('org_id', '=', filter.orgId);
    if (filter.ownerId !== undefined) {
      query = query.where('owner_id', '=', filter.ownerId);
    }
    if (filter.name !== undefined) {
      query = query.where('name', '=', filter.name);
    }
    const rows = await query.execute();
    return rows.map((row) => mapRow(row as unknown as AgentSkillRow));
  }
}
