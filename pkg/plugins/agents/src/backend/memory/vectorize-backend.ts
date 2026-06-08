/**
 * `VectorizeBackend` — the hosted `MemoryBackend` (Cloudflare).
 *
 * Storage split (see plans/agents/memory-worker-port.md):
 *   - **D1 `agent_memories`** — system of record (content, scope, tags).
 *   - **D1 `agent_memories_fts`** — a backend-owned FTS5 table for the
 *     keyword (bm25) signal *and* the dedup hash. Owning it here avoids an
 *     `agent_memories` migration just to add a `content_hash` column.
 *   - **Vectorize** — the semantic index (one vector per memory id).
 *
 * Embeddings are NOT produced here — the `MemoryAdapter`'s `embed` dep
 * does that and passes vectors in. This backend only stores/queries them.
 *
 * Scope conventions:
 *   - `agent_memories` stores the real owner (`user_id` / `project_id`
 *     nullable) + a derived `scope` enum, mirroring the plugin schema.
 *   - the FTS table + Vectorize use a `'*'` sentinel for "no owner"
 *     (global), so a single query can match `{X, '*'}` via `$in` / `OR`
 *     — Vectorize/SQL can't express "= X OR IS NULL" cheaply.
 *
 * Testability: every D1 path uses Kysely (works against the in-memory
 * fake DB) and Vectorize is injected; only `keywordSearch` (raw FTS
 * `MATCH`) and `ensureSchema` (raw `CREATE VIRTUAL TABLE`) are
 * integration-only — both validated by the FTS5-on-D1 spike.
 */

import type { PluginDatabaseApi } from '@flowlib/core';
import { contentHash } from './hash';
import {
  scopeMatches,
  type KeywordMatch,
  type MemoryBackend,
  type MemoryScope,
  type SemanticMatch,
  type StoredMemory,
} from './types';

const SENTINEL = '*';
const FTS_TABLE = 'agent_memories_fts';

/** Minimal subset of the Cloudflare Vectorize binding this backend uses. */
export interface VectorizeLike {
  upsert(
    vectors: ReadonlyArray<{
      id: string;
      values: number[];
      namespace?: string;
      metadata?: Record<string, string>;
    }>,
  ): Promise<unknown>;
  query(
    vector: number[],
    options: {
      topK: number;
      namespace?: string;
      returnValues?: boolean;
      returnMetadata?: 'none' | 'indexed' | 'all';
      filter?: Record<string, unknown>;
    },
  ): Promise<{ matches: ReadonlyArray<{ id: string; score: number }> }>;
  deleteByIds(ids: string[]): Promise<unknown>;
}

interface MemoriesRow {
  id: string;
  org_id: string | null;
  scope: string;
  user_id: string | null;
  project_id: string | null;
  content: string;
  tags: string | null;
  created_by: string;
  created_at: string;
  last_used_at: string | null;
}

interface FtsRow {
  memory_id: string;
  org_id: string;
  user_id: string;
  project_id: string;
  content_hash: string;
  content: string;
}

interface MemoryDb {
  agent_memories: MemoriesRow;
  agent_memories_fts: FtsRow;
}

export interface VectorizeBackendDeps {
  db: PluginDatabaseApi;
  vectorize: VectorizeLike;
  logger?: { warn(message: string, meta?: unknown): void };
}

// ─── Scope mapping ─────────────────────────────────────────────────────

function deriveScopeEnum(scope: MemoryScope): string {
  if (scope.projectId) {
    return 'project';
  }
  if (scope.userId) {
    return 'personal';
  }
  return 'global';
}
function namespaceFor(scope: MemoryScope): string {
  return scope.orgId ?? '_default';
}
function ownerSentinel(value: string | undefined | null): string {
  return value ?? SENTINEL;
}

/** Vectorize / FTS metadata filter that matches `{value, '*'}` per dimension. */
function membershipFilter(scope: MemoryScope): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  filter.user_id = scope.userId ? { $in: [scope.userId, SENTINEL] } : SENTINEL;
  filter.project_id = scope.projectId ? { $in: [scope.projectId, SENTINEL] } : SENTINEL;
  return filter;
}

export function createVectorizeBackend(deps: VectorizeBackendDeps): MemoryBackend & {
  ensureSchema(): Promise<void>;
} {
  const { db, vectorize } = deps;
  const k = () => db.kysely<MemoryDb>();

  function rowToStored(row: MemoriesRow): StoredMemory {
    const scope: MemoryScope = {
      orgId: row.org_id,
      ...(row.user_id ? { userId: row.user_id } : {}),
      ...(row.project_id ? { projectId: row.project_id } : {}),
    };
    return {
      id: row.id,
      text: row.content,
      scope,
      hash: contentHash(row.content),
      createdAt: typeof row.created_at === 'string' ? row.created_at : String(row.created_at),
    };
  }

  async function indexFts(record: StoredMemory): Promise<void> {
    // Standalone FTS5 row keyed by memory_id; '*' sentinel for absent owner.
    await k()
      .insertInto('agent_memories_fts')
      .values({
        memory_id: record.id,
        org_id: record.scope.orgId ?? SENTINEL,
        user_id: ownerSentinel(record.scope.userId),
        project_id: ownerSentinel(record.scope.projectId),
        content_hash: record.hash,
        content: record.text,
      } as never)
      .execute();
  }

  async function unindexFts(id: string): Promise<void> {
    await k().deleteFrom('agent_memories_fts').where('memory_id', '=', id).execute();
  }

  return {
    async ensureSchema() {
      // Standalone FTS5 table (not external-content): supports plain
      // INSERT/DELETE plus MATCH. UNINDEXED columns are stored + filterable.
      await db.execute(
        `CREATE VIRTUAL TABLE IF NOT EXISTS ${FTS_TABLE} USING fts5(` +
          `memory_id UNINDEXED, org_id UNINDEXED, user_id UNINDEXED, ` +
          `project_id UNINDEXED, content_hash UNINDEXED, content, ` +
          `tokenize = 'porter unicode61')`,
      );
    },

    async putRecord(record, vector) {
      await k()
        .insertInto('agent_memories')
        .values({
          id: record.id,
          org_id: record.scope.orgId,
          scope: deriveScopeEnum(record.scope),
          user_id: record.scope.userId ?? null,
          project_id: record.scope.projectId ?? null,
          content: record.text,
          tags: null,
          created_by: record.scope.userId ?? 'system',
          created_at: record.createdAt,
          last_used_at: null,
        } as never)
        .execute();
      await indexFts(record);
      await vectorize.upsert([
        {
          id: record.id,
          values: vector,
          namespace: namespaceFor(record.scope),
          metadata: {
            user_id: ownerSentinel(record.scope.userId),
            project_id: ownerSentinel(record.scope.projectId),
          },
        },
      ]);
    },

    async getRecord(id) {
      const row = await k()
        .selectFrom('agent_memories')
        .selectAll()
        .where('id', '=', id)
        .limit(1)
        .executeTakeFirst();
      return row ? rowToStored(row as unknown as MemoriesRow) : null;
    },

    async getRecords(ids) {
      if (ids.length === 0) {
        return [];
      }
      // One round-trip per id keeps this dialect-portable and fake-DB
      // friendly; the candidate set is small (top-K), so the cost is bounded.
      const out: StoredMemory[] = [];
      for (const id of ids) {
        const row = await k()
          .selectFrom('agent_memories')
          .selectAll()
          .where('id', '=', id)
          .limit(1)
          .executeTakeFirst();
        if (row) {
          out.push(rowToStored(row as unknown as MemoriesRow));
        }
      }
      return out;
    },

    async updateRecord(id, patch) {
      await k()
        .updateTable('agent_memories')
        .set({ content: patch.text } as never)
        .where('id', '=', id)
        .execute();
      // Refresh the FTS row (hash + content) and the vector.
      const current = await this.getRecord(id);
      if (!current) {
        return null;
      }
      const updated: StoredMemory = { ...current, text: patch.text, hash: contentHash(patch.text) };
      await unindexFts(id);
      await indexFts(updated);
      await vectorize.upsert([
        {
          id,
          values: patch.vector,
          namespace: namespaceFor(updated.scope),
          metadata: {
            user_id: ownerSentinel(updated.scope.userId),
            project_id: ownerSentinel(updated.scope.projectId),
          },
        },
      ]);
      return updated;
    },

    async deleteRecord(id) {
      await k().deleteFrom('agent_memories').where('id', '=', id).execute();
      await unindexFts(id);
      await vectorize.deleteByIds([id]);
    },

    async deleteScope(scope) {
      const victims = await this.listByScope(scope);
      for (const v of victims) {
        await this.deleteRecord(v.id);
      }
    },

    async listByScope(scope, limit) {
      // Fetch by org then filter scope in JS (avoids OR-with-null in SQL;
      // memory sets are small). Mirrors `scopeMatches`.
      let query = k().selectFrom('agent_memories').selectAll();
      query =
        scope.orgId === null
          ? query.where('org_id', 'is', null)
          : query.where('org_id', '=', scope.orgId);
      const rows = (await query.execute()) as unknown as MemoriesRow[];
      const matched = rows.map(rowToStored).filter((r) => scopeMatches(r.scope, scope));
      return limit !== undefined ? matched.slice(0, limit) : matched;
    },

    async existsByHash(hash, scope) {
      const rows = (await k()
        .selectFrom('agent_memories_fts')
        .selectAll()
        .where('content_hash', '=', hash)
        .where('org_id', '=', scope.orgId ?? SENTINEL)
        .execute()) as unknown as FtsRow[];
      // The FTS row uses the '*' sentinel; reconstruct a scope to compare.
      return rows.some((r) =>
        scopeMatches(
          {
            orgId: scope.orgId,
            ...(r.user_id !== SENTINEL ? { userId: r.user_id } : {}),
            ...(r.project_id !== SENTINEL ? { projectId: r.project_id } : {}),
          },
          scope,
        ),
      );
    },

    async semanticSearch(vector, scope, topK) {
      const res = await vectorize.query(vector, {
        topK,
        namespace: namespaceFor(scope),
        returnValues: false,
        returnMetadata: 'none',
        filter: membershipFilter(scope),
      });
      return res.matches.map((m): SemanticMatch => ({ id: m.id, score: m.score }));
    },

    async keywordSearch(text, scope, topK) {
      // Raw FTS5 MATCH — validated by the FTS5-on-D1 spike. Not exercised
      // by the in-memory fake DB (it can't MATCH); integration-only.
      const sql =
        `SELECT memory_id AS id, bm25(${FTS_TABLE}) AS bm25_raw ` +
        `FROM ${FTS_TABLE} ` +
        `WHERE ${FTS_TABLE} MATCH ?1 AND org_id = ?2 ` +
        `AND (user_id = ?3 OR user_id = '${SENTINEL}') ` +
        `AND (project_id = ?4 OR project_id = '${SENTINEL}') ` +
        `ORDER BY bm25_raw ASC LIMIT ?5`;
      const rows = await db.query<{ id: string; bm25_raw: number }>(sql, [
        ftsEscape(text),
        scope.orgId ?? SENTINEL,
        scope.userId ?? SENTINEL,
        scope.projectId ?? SENTINEL,
        topK,
      ]);
      return rows.map((r): KeywordMatch => ({ id: r.id, bm25Raw: r.bm25_raw }));
    },
  };
}

/**
 * Escape a user query for an FTS5 `MATCH`. Wrapping each token in double
 * quotes treats it as a literal phrase term, neutralising FTS5 operators
 * (`-`, `*`, `:`, `(`, `OR`, …) that would otherwise be a syntax-error or
 * injection vector.
 */
export function ftsEscape(query: string): string {
  const tokens = query.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
  if (tokens.length === 0) {
    return '""';
  }
  return tokens.map((t) => `"${t}"`).join(' OR ');
}
