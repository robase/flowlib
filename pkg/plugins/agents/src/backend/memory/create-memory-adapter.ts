/**
 * `createMemoryAdapter` — the orchestration kernel for the memory layer.
 *
 * Implements Mem0's add/search pattern over a pluggable `MemoryBackend`:
 *
 *   add(infer)  : extract facts → dedup (hash) → embed → for each fact,
 *                 retrieve similar → reconcile (ADD/UPDATE/DELETE/NOOP) →
 *                 apply to the backend (record + vector + keyword index).
 *   add(!infer) : store the raw messages verbatim (no LLM).
 *   search      : embed query → semantic ∪ keyword candidates → hydrate →
 *                 fuse + rank (scoring.ts) → top-K.
 *
 * Provider-agnostic and infra-agnostic: swap `InMemoryBackend` for
 * `VectorizeBackend` (hosted) and the behaviour is identical.
 */

import { extractFacts } from './extract';
import { contentHash } from './hash';
import { reconcileFact } from './reconcile';
import { scoreAndRank } from './scoring';
import type {
  AddMemoryInput,
  Embedder,
  MemoryAdapter,
  MemoryBackend,
  MemoryLlm,
  MemoryRecord,
  StoredMemory,
} from './types';

/** Number of similar memories shown to the reconcile pass per new fact. */
const RETRIEVE_FOR_RECONCILE = 10;

export interface MemoryAdapterDeps {
  backend: MemoryBackend;
  embed: Embedder;
  llm: MemoryLlm;
  /** ISO clock — injected so tests are deterministic. */
  now?: () => string;
  /** Stable id generator — defaults to `crypto.randomUUID`. */
  generateId?: () => string;
  logger?: { warn(message: string, meta?: unknown): void };
}

function toRecord(stored: StoredMemory): MemoryRecord {
  return {
    id: stored.id,
    text: stored.text,
    scope: stored.scope,
    ...(stored.metadata ? { metadata: stored.metadata } : {}),
    createdAt: stored.createdAt,
  };
}

function normaliseMessages(
  messages: AddMemoryInput['messages'],
): Array<{ role: string; content: string }> {
  if (typeof messages === 'string') {
    return [{ role: 'user', content: messages }];
  }
  return messages.filter((m) => typeof m.content === 'string' && m.content.trim() !== '');
}

export function createMemoryAdapter(deps: MemoryAdapterDeps): MemoryAdapter {
  const now = deps.now ?? (() => new Date().toISOString());
  const generateId = deps.generateId ?? (() => crypto.randomUUID());
  const { backend, embed, llm } = deps;

  async function storeRaw(
    texts: string[],
    scope: AddMemoryInput['scope'],
    metadata: AddMemoryInput['metadata'],
  ): Promise<MemoryRecord[]> {
    if (texts.length === 0) {
      return [];
    }
    const vectors = await embed(texts);
    const out: MemoryRecord[] = [];
    for (let i = 0; i < texts.length; i++) {
      const record: StoredMemory = {
        id: generateId(),
        text: texts[i],
        scope,
        hash: contentHash(texts[i]),
        ...(metadata ? { metadata } : {}),
        createdAt: now(),
      };
      await backend.putRecord(record, vectors[i]);
      out.push(toRecord(record));
    }
    return out;
  }

  return {
    async add(input) {
      const messages = normaliseMessages(input.messages);
      if (messages.length === 0) {
        return [];
      }

      // infer=false fast path — store verbatim, no LLM/dedup.
      if (input.infer === false) {
        return storeRaw(
          messages.map((m) => m.content),
          input.scope,
          input.metadata,
        );
      }

      // 1. Extract durable facts.
      const facts = await extractFacts(llm, messages, now());
      if (facts.length === 0) {
        return [];
      }

      // 2. MD5-style dedup BEFORE any embed/LLM spend — within the batch
      //    and against the store.
      const seen = new Set<string>();
      const fresh: Array<{ text: string; hash: string }> = [];
      for (const f of facts) {
        const hash = contentHash(f.text);
        if (seen.has(hash)) {
          continue;
        }
        seen.add(hash);
        if (await backend.existsByHash(hash, input.scope)) {
          continue;
        }
        fresh.push({ text: f.text, hash });
      }
      if (fresh.length === 0) {
        return [];
      }

      // 3. Embed all fresh facts in one batch.
      const vectors = await embed(fresh.map((f) => f.text));

      // 4. Per fact: retrieve similar → reconcile → apply.
      const results: MemoryRecord[] = [];
      for (let i = 0; i < fresh.length; i++) {
        const fact = fresh[i];
        const vector = vectors[i];

        const matches = await backend.semanticSearch(vector, input.scope, RETRIEVE_FOR_RECONCILE);
        const candidates = await backend.getRecords(matches.map((m) => m.id));
        // No similar memories → nothing to reconcile against; ADD directly
        // and skip the LLM call.
        const ops =
          candidates.length === 0
            ? [{ event: 'ADD' as const, text: fact.text }]
            : await reconcileFact(
                llm,
                fact.text,
                candidates.map((c) => ({ id: c.id, text: c.text })),
              );

        for (const op of ops) {
          if (op.event === 'ADD') {
            const id = generateId();
            // Reuse the fact's embedding when the ADD text is unchanged;
            // otherwise re-embed the (possibly merged) text.
            const vec = op.text === fact.text ? vector : (await embed([op.text]))[0];
            const record: StoredMemory = {
              id,
              text: op.text,
              scope: input.scope,
              hash: contentHash(op.text),
              ...(input.metadata ? { metadata: input.metadata } : {}),
              createdAt: now(),
            };
            await backend.putRecord(record, vec);
            results.push(toRecord(record));
          } else if (op.event === 'UPDATE') {
            const vec = (await embed([op.text]))[0];
            const updated = await backend.updateRecord(op.id, { text: op.text, vector: vec });
            if (updated) {
              results.push(toRecord(updated));
            }
          } else if (op.event === 'DELETE') {
            await backend.deleteRecord(op.id);
          }
          // NOOP: nothing
        }
      }
      return results;
    },

    async search(input) {
      const limit = input.topK ?? 10;
      const overfetch = Math.min(Math.max(limit * 4, 60), 100);
      const [queryVec] = await embed([input.query]);

      const [semantic, keyword] = await Promise.all([
        backend.semanticSearch(queryVec, input.scope, overfetch),
        backend.keywordSearch(input.query, input.scope, overfetch),
      ]);

      const ids = [...new Set([...semantic.map((s) => s.id), ...keyword.map((k) => k.id)])];
      const rows = await backend.getRecords(ids);

      const ranked = scoreAndRank(rows.map(toRecord), {
        semantic: new Map(semantic.map((s) => [s.id, s.score])),
        bm25: new Map(keyword.map((k) => [k.id, k.bm25Raw])),
      });
      return ranked.slice(0, limit);
    },

    async get(id, scope) {
      const rec = await backend.getRecord(id);
      if (!rec) {
        return null;
      }
      // Tenant guard — never return a record outside the query scope.
      if (rec.scope.orgId !== scope.orgId) {
        return null;
      }
      return toRecord(rec);
    },

    async getAll(scope, limit) {
      const rows = await backend.listByScope(scope, limit);
      return rows.map(toRecord);
    },

    async delete(id, scope) {
      const rec = await backend.getRecord(id);
      if (rec && rec.scope.orgId === scope.orgId) {
        await backend.deleteRecord(id);
      }
    },

    async deleteAll(scope) {
      await backend.deleteScope(scope);
    },
  };
}
