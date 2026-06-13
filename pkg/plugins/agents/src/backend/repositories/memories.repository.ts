/**
 * Persistence for `agent_memories`.
 *
 * A memory is a durable note the agent can recall across sessions —
 * "the user prefers TypeScript", "the prod DB is Postgres on Neon", etc.
 * Scope is `personal` (a single user), `project` (a project), or
 * `global` (everyone in the org). The agent reads relevant memories at
 * the start of a turn (via the prompt's "Relevant memories" section and
 * the `memory.search` tool) and writes new ones via `memory.write`.
 *
 * **Search**: v1 ranks by keyword overlap + recency in JS rather than
 * vector similarity — it loads the in-scope candidates with index-friendly
 * equality filters (`scope`/`org`/`user`/`project`), then scores them in
 * memory. This is dialect-portable (no FTS / `LIKE`), runs anywhere
 * (SQLite, D1, Postgres, the in-memory test fake), and needs no embedder.
 * A vector backend can replace `search()` later without changing callers.
 *
 * Tenant scoped — every query is bounded by `orgId`.
 */

import type { PluginDatabaseApi } from '@flowlib/core';
import type { AgentsDB } from './db-types';
import { generateId, nowFor, parseJson, toIso, toIsoOrNull } from './util';

export type MemoryScope = 'personal' | 'project' | 'global';

export interface AgentMemory {
  id: string;
  orgId: string | null;
  scope: MemoryScope;
  userId: string | null;
  projectId: string | null;
  content: string;
  tags: string[];
  createdBy: string;
  createdAt: string;
  lastUsedAt: string | null;
}

interface AgentMemoryRow {
  id: string;
  org_id: string | null;
  scope: string;
  user_id: string | null;
  project_id: string | null;
  content: string;
  embedding: string | null;
  tags: string | string[] | null;
  created_by: string;
  created_at: string | Date;
  last_used_at: string | Date | null;
}

export interface CreateMemoryInput {
  id?: string;
  orgId: string | null;
  scope: MemoryScope;
  userId?: string | null;
  projectId?: string | null;
  content: string;
  tags?: string[];
  createdBy: string;
}

export interface UpdateMemoryInput {
  content?: string;
  tags?: string[];
  scope?: MemoryScope;
  projectId?: string | null;
}

/**
 * Which memories a session can see: the org's `global` memories, the
 * user's `personal` memories, and (when a project is in play) that
 * project's `project` memories.
 */
export interface MemoryReadScope {
  orgId: string | null;
  userId?: string;
  projectId?: string | null;
  /** Cap the number returned. */
  limit?: number;
}

function coerceScope(value: string): MemoryScope {
  return value === 'global' || value === 'project' ? value : 'personal';
}

function mapRow(row: AgentMemoryRow): AgentMemory {
  return {
    id: row.id,
    orgId: row.org_id,
    scope: coerceScope(row.scope),
    userId: row.user_id,
    projectId: row.project_id,
    content: row.content,
    tags: parseJson<string[]>(row.tags, []),
    createdBy: row.created_by,
    createdAt: toIso(row.created_at),
    lastUsedAt: toIsoOrNull(row.last_used_at),
  };
}

/** Tokenise to lowercase word set for keyword scoring. */
function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
}

export class MemoriesRepository {
  constructor(private readonly database: PluginDatabaseApi) {}

  /**
   * Memories visible to a session: org `global` + user `personal` +
   * (optional) `project`. Three precise equality queries keep each one
   * index-friendly and dialect-portable. Sorted most-recent-first.
   */
  async listForScope(scope: MemoryReadScope): Promise<AgentMemory[]> {
    const out: AgentMemory[] = [];
    out.push(...(await this._query({ orgId: scope.orgId, scope: 'global' })));
    if (scope.userId) {
      out.push(
        ...(await this._query({ orgId: scope.orgId, scope: 'personal', userId: scope.userId })),
      );
    }
    if (scope.projectId) {
      out.push(
        ...(await this._query({
          orgId: scope.orgId,
          scope: 'project',
          projectId: scope.projectId,
        })),
      );
    }
    out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    return scope.limit !== undefined ? out.slice(0, scope.limit) : out;
  }

  /**
   * Rank in-scope memories against a free-text query by keyword overlap,
   * tie-broken by recency. Returns the top `limit` (default 5). Pure JS
   * scoring — see the file header for why we don't use FTS / vectors yet.
   */
  async search(query: string, scope: MemoryReadScope & { limit?: number }): Promise<AgentMemory[]> {
    const candidates = await this.listForScope({ ...scope, limit: undefined });
    const limit = scope.limit ?? 5;
    const q = new Set(tokens(query));
    if (q.size === 0) {
      return candidates.slice(0, limit);
    }
    const scored = candidates.map((m) => {
      const words = tokens(`${m.content} ${m.tags.join(' ')}`);
      let overlap = 0;
      for (const w of words) {
        if (q.has(w)) {
          overlap += 1;
        }
      }
      return { m, overlap };
    });
    return scored
      .filter((s) => s.overlap > 0)
      .sort((a, b) =>
        b.overlap !== a.overlap ? b.overlap - a.overlap : a.m.createdAt < b.m.createdAt ? 1 : -1,
      )
      .slice(0, limit)
      .map((s) => s.m);
  }

  async create(input: CreateMemoryInput): Promise<AgentMemory> {
    const id = input.id ?? generateId();
    const now = nowFor(this.database);
    await this.database
      .kysely<AgentsDB>()
      .insertInto('agent_memories')
      .values({
        id,
        org_id: input.orgId,
        scope: input.scope,
        user_id: input.userId ?? null,
        project_id: input.projectId ?? null,
        content: input.content,
        embedding: null,
        tags: JSON.stringify(input.tags ?? []),
        created_by: input.createdBy,
        created_at: now,
        last_used_at: null,
      } as never)
      .execute();
    const created = await this.findById(id, input.orgId);
    if (!created) {
      throw new Error('Failed to load created memory');
    }
    return created;
  }

  async list(filter: { orgId?: string | null } = {}): Promise<AgentMemory[]> {
    let query = this.database.kysely<AgentsDB>().selectFrom('agent_memories').selectAll();
    if (filter.orgId !== undefined) {
      query =
        filter.orgId === null
          ? query.where('org_id', 'is', null)
          : query.where('org_id', '=', filter.orgId);
    }
    const rows = await query.execute();
    return rows
      .map((row) => mapRow(row as unknown as AgentMemoryRow))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  }

  async findById(id: string, orgId?: string | null): Promise<AgentMemory | null> {
    let query = this.database
      .kysely<AgentsDB>()
      .selectFrom('agent_memories')
      .selectAll()
      .where('id', '=', id);
    if (orgId !== undefined) {
      query =
        orgId === null ? query.where('org_id', 'is', null) : query.where('org_id', '=', orgId);
    }
    const row = await query.limit(1).executeTakeFirst();
    return row ? mapRow(row as unknown as AgentMemoryRow) : null;
  }

  async update(
    id: string,
    patch: UpdateMemoryInput,
    orgId?: string | null,
  ): Promise<AgentMemory | null> {
    const set: Record<string, unknown> = {};
    if (patch.content !== undefined) {
      set.content = patch.content;
    }
    if (patch.tags !== undefined) {
      set.tags = JSON.stringify(patch.tags);
    }
    if (patch.scope !== undefined) {
      set.scope = patch.scope;
    }
    if (patch.projectId !== undefined) {
      set.project_id = patch.projectId;
    }
    if (Object.keys(set).length === 0) {
      return this.findById(id, orgId);
    }
    let query = this.database
      .kysely<AgentsDB>()
      .updateTable('agent_memories')
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
    let query = this.database.kysely<AgentsDB>().deleteFrom('agent_memories').where('id', '=', id);
    if (orgId !== undefined) {
      query =
        orgId === null ? query.where('org_id', 'is', null) : query.where('org_id', '=', orgId);
    }
    await query.execute();
  }

  /** Shared selector — equality filters only (index-friendly, fake-DB-safe). */
  private async _query(filter: {
    orgId: string | null;
    scope: MemoryScope;
    userId?: string;
    projectId?: string | null;
  }): Promise<AgentMemory[]> {
    let query = this.database
      .kysely<AgentsDB>()
      .selectFrom('agent_memories')
      .selectAll()
      .where('scope', '=', filter.scope);
    query =
      filter.orgId === null
        ? query.where('org_id', 'is', null)
        : query.where('org_id', '=', filter.orgId);
    if (filter.userId !== undefined) {
      query = query.where('user_id', '=', filter.userId);
    }
    if (filter.projectId !== undefined && filter.projectId !== null) {
      query = query.where('project_id', '=', filter.projectId);
    }
    const rows = await query.execute();
    return rows.map((row) => mapRow(row as unknown as AgentMemoryRow));
  }
}
