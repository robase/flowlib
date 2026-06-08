import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createVectorizeBackend, ftsEscape, type VectorizeLike } from '../vectorize-backend';
import { contentHash } from '../hash';
import type { StoredMemory } from '../types';
import { makeFakeDatabase, type Row } from '../../repositories/__tests__/fake-db';

function fakeVectorize() {
  const upserts: Array<{ id: string; namespace?: string; metadata?: Record<string, string> }> = [];
  const deletes: string[] = [];
  const queries: Array<{ namespace?: string; filter?: Record<string, unknown>; topK: number }> = [];
  let nextMatches: ReadonlyArray<{ id: string; score: number }> = [];

  const vectorize: VectorizeLike = {
    upsert: vi.fn(async (vectors) => {
      for (const v of vectors) {
        upserts.push({ id: v.id, namespace: v.namespace, metadata: v.metadata });
      }
    }),
    query: vi.fn(async (_vector, options) => {
      queries.push({ namespace: options.namespace, filter: options.filter, topK: options.topK });
      return { matches: nextMatches };
    }),
    deleteByIds: vi.fn(async (ids) => {
      deletes.push(...ids);
    }),
  };
  return {
    vectorize,
    upserts,
    deletes,
    queries,
    setMatches: (m: typeof nextMatches) => (nextMatches = m),
  };
}

function stored(id: string, text: string, scope: StoredMemory['scope']): StoredMemory {
  return { id, text, scope, hash: contentHash(text), createdAt: '2026-01-01T00:00:00Z' };
}

describe('VectorizeBackend (D1 + fake Vectorize)', () => {
  let db: ReturnType<typeof makeFakeDatabase>;
  let vec: ReturnType<typeof fakeVectorize>;
  let backend: ReturnType<typeof createVectorizeBackend>;

  beforeEach(() => {
    db = makeFakeDatabase();
    vec = fakeVectorize();
    backend = createVectorizeBackend({ db, vectorize: vec.vectorize });
  });

  it('putRecord writes the canonical row, the FTS row, and upserts the vector', async () => {
    const rec = stored('m1', 'User loves cheese pizza', { orgId: 'org-a', userId: 'u1' });
    await backend.putRecord(rec, [0.1, 0.2, 0.3]);

    const mem = (db._tables.get('agent_memories') ?? []) as Row[];
    expect(mem).toHaveLength(1);
    expect(mem[0]).toMatchObject({ id: 'm1', org_id: 'org-a', user_id: 'u1', scope: 'personal' });

    const fts = (db._tables.get('agent_memories_fts') ?? []) as Row[];
    expect(fts[0]).toMatchObject({ memory_id: 'm1', content_hash: rec.hash, user_id: 'u1' });

    expect(vec.upserts).toEqual([
      { id: 'm1', namespace: 'org-a', metadata: { user_id: 'u1', project_id: '*' } },
    ]);
  });

  it('global memories store the "*" sentinel for absent owner', async () => {
    await backend.putRecord(stored('g1', 'org fact', { orgId: 'org-a' }), [1]);
    const fts = (db._tables.get('agent_memories_fts') ?? []) as Row[];
    expect(fts[0]).toMatchObject({ user_id: '*', project_id: '*' });
    expect(vec.upserts[0].metadata).toEqual({ user_id: '*', project_id: '*' });
  });

  it('getRecord round-trips the scope from columns', async () => {
    await backend.putRecord(stored('m1', 'hello', { orgId: 'org-a', userId: 'u1' }), [1]);
    const got = await backend.getRecord('m1');
    expect(got).toMatchObject({ id: 'm1', text: 'hello', scope: { orgId: 'org-a', userId: 'u1' } });
  });

  it('existsByHash respects scope (a different user does not see it)', async () => {
    const rec = stored('m1', 'secret note', { orgId: 'org-a', userId: 'u1' });
    await backend.putRecord(rec, [1]);
    expect(await backend.existsByHash(rec.hash, { orgId: 'org-a', userId: 'u1' })).toBe(true);
    expect(await backend.existsByHash(rec.hash, { orgId: 'org-a', userId: 'u2' })).toBe(false);
    expect(await backend.existsByHash(rec.hash, { orgId: 'org-b', userId: 'u1' })).toBe(false);
  });

  it('listByScope returns org-global + own personal, hides other users', async () => {
    await backend.putRecord(stored('g1', 'global', { orgId: 'org-a' }), [1]);
    await backend.putRecord(stored('p1', 'u1 personal', { orgId: 'org-a', userId: 'u1' }), [1]);
    await backend.putRecord(stored('p2', 'u2 personal', { orgId: 'org-a', userId: 'u2' }), [1]);

    const forU1 = await backend.listByScope({ orgId: 'org-a', userId: 'u1' });
    expect(forU1.map((m) => m.id).sort()).toEqual(['g1', 'p1']);
  });

  it('deleteRecord removes the canonical row, the FTS row, and the vector', async () => {
    await backend.putRecord(stored('m1', 'x', { orgId: 'org-a' }), [1]);
    await backend.deleteRecord('m1');
    expect((db._tables.get('agent_memories') ?? []).length).toBe(0);
    expect((db._tables.get('agent_memories_fts') ?? []).length).toBe(0);
    expect(vec.deletes).toEqual(['m1']);
  });

  it('semanticSearch queries Vectorize with the org namespace + membership filter', async () => {
    vec.setMatches([{ id: 'm1', score: 0.91 }]);
    const hits = await backend.semanticSearch([0.1], { orgId: 'org-a', userId: 'u1' }, 10);
    expect(hits).toEqual([{ id: 'm1', score: 0.91 }]);
    expect(vec.queries[0]).toMatchObject({
      namespace: 'org-a',
      topK: 10,
      filter: { user_id: { $in: ['u1', '*'] }, project_id: '*' },
    });
  });
});

describe('ftsEscape', () => {
  it('quotes each token (literal terms) and ORs them', () => {
    expect(ftsEscape('cheese pizza')).toBe('"cheese" OR "pizza"');
  });
  it('neutralises FTS5 operators / injection', () => {
    expect(ftsEscape('a OR b- NEAR(x)')).toBe('"a" OR "or" OR "b" OR "near" OR "x"');
  });
  it('returns an always-empty match for no tokens', () => {
    expect(ftsEscape('   -*: ')).toBe('""');
  });
});
