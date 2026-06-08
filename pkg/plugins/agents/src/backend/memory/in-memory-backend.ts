/**
 * In-memory `MemoryBackend` — the dev/test storage backend.
 *
 * Exercises the full extract → reconcile → hybrid-retrieve orchestration
 * without any infrastructure: vectors are compared by cosine in JS, the
 * keyword signal is a naive term-overlap (negated to mimic SQLite's
 * "lower bm25 = better" convention), records live in a Map.
 *
 * The hosted `VectorizeBackend` (Workers AI + Vectorize + D1 FTS) and a
 * `PgvectorBackend` implement the same interface — only the storage calls
 * differ; the orchestration in `create-memory-adapter.ts` is identical.
 */

import { contentHash } from './hash';
import {
  scopeMatches,
  type KeywordMatch,
  type MemoryBackend,
  type MemoryScope,
  type SemanticMatch,
  type StoredMemory,
} from './types';

interface Entry {
  record: StoredMemory;
  vector: number[];
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

function terms(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length > 0);
}

export function createInMemoryBackend(): MemoryBackend & { _size(): number } {
  const entries = new Map<string, Entry>();

  function inScope(record: StoredMemory, scope: MemoryScope): boolean {
    return scopeMatches(record.scope, scope);
  }

  return {
    async putRecord(record, vector) {
      entries.set(record.id, { record, vector });
    },

    async getRecord(id) {
      return entries.get(id)?.record ?? null;
    },

    async getRecords(ids) {
      const out: StoredMemory[] = [];
      for (const id of ids) {
        const e = entries.get(id);
        if (e) {
          out.push(e.record);
        }
      }
      return out;
    },

    async updateRecord(id, patch) {
      const e = entries.get(id);
      if (!e) {
        return null;
      }
      const updated: StoredMemory = {
        ...e.record,
        text: patch.text,
        hash: contentHash(patch.text),
      };
      entries.set(id, { record: updated, vector: patch.vector });
      return updated;
    },

    async deleteRecord(id) {
      entries.delete(id);
    },

    async deleteScope(scope) {
      for (const [id, e] of entries) {
        if (inScope(e.record, scope)) {
          entries.delete(id);
        }
      }
    },

    async listByScope(scope, limit) {
      const out = [...entries.values()]
        .filter((e) => inScope(e.record, scope))
        .map((e) => e.record);
      return limit !== undefined ? out.slice(0, limit) : out;
    },

    async existsByHash(hash, scope) {
      for (const e of entries.values()) {
        if (e.record.hash === hash && inScope(e.record, scope)) {
          return true;
        }
      }
      return false;
    },

    async semanticSearch(vector, scope, topK) {
      const hits: SemanticMatch[] = [];
      for (const e of entries.values()) {
        if (!inScope(e.record, scope)) {
          continue;
        }
        hits.push({ id: e.record.id, score: cosine(vector, e.vector) });
      }
      hits.sort((a, b) => b.score - a.score);
      return hits.slice(0, topK);
    },

    async keywordSearch(text, scope, topK) {
      const queryTerms = new Set(terms(text));
      const hits: KeywordMatch[] = [];
      for (const e of entries.values()) {
        if (!inScope(e.record, scope)) {
          continue;
        }
        let matches = 0;
        for (const t of terms(e.record.text)) {
          if (queryTerms.has(t)) {
            matches++;
          }
        }
        if (matches > 0) {
          // Negate so "more matches → more negative → better", matching
          // SQLite bm25()'s sign that the real backend returns.
          hits.push({ id: e.record.id, bm25Raw: -matches });
        }
      }
      hits.sort((a, b) => a.bm25Raw - b.bm25Raw);
      return hits.slice(0, topK);
    },

    _size() {
      return entries.size;
    },
  };
}
