import { describe, expect, it } from 'vitest';

import { createInMemoryBackend } from '../in-memory-backend';
import { createMemoryAdapter } from '../create-memory-adapter';
import type { MemoryLlm } from '../types';

/**
 * Deterministic hashing bag-of-words embedder: cosine of two texts grows
 * with shared terms. Enough to make semantic retrieval + the gate
 * meaningful without a real embedding model.
 */
function fakeEmbed(texts: string[]): Promise<number[][]> {
  const D = 64;
  return Promise.resolve(
    texts.map((text) => {
      const v = Array.from({ length: D }, () => 0);
      for (const w of text.toLowerCase().split(/\W+/).filter(Boolean)) {
        let h = 0;
        for (let i = 0; i < w.length; i++) {
          h = (h * 31 + w.charCodeAt(i)) >>> 0;
        }
        v[h % D] += 1;
      }
      const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
      return v.map((x) => x / norm);
    }),
  );
}

/** A MemoryLlm that returns queued JSON responses in call order. */
function queuedLlm(queue: unknown[]): MemoryLlm {
  return {
    json: async () => {
      if (queue.length === 0) {
        throw new Error('fake llm: queue exhausted (unexpected extra call)');
      }
      return queue.shift() as never;
    },
  };
}

function counterIds(): () => string {
  let n = 0;
  return () => `mem-${++n}`;
}

const scope = { orgId: 'org-a', userId: 'u1' };

describe('createMemoryAdapter (in-memory backend, end to end)', () => {
  it('adds a brand-new fact (no reconcile LLM call when the store is empty)', async () => {
    const backend = createInMemoryBackend();
    // Only an extract response is consumed — empty store short-circuits reconcile.
    const llm = queuedLlm([{ facts: [{ text: 'User loves cheese pizza' }] }]);
    const adapter = createMemoryAdapter({
      backend,
      embed: fakeEmbed,
      llm,
      now: () => '2026-01-01T00:00:00Z',
      generateId: counterIds(),
    });

    const added = await adapter.add({ messages: 'I love cheese pizza', scope });
    expect(added).toHaveLength(1);
    expect(added[0].text).toBe('User loves cheese pizza');
    expect(backend._size()).toBe(1);
  });

  it('dedups an identical fact before any embed/LLM spend', async () => {
    const backend = createInMemoryBackend();
    const adapter = createMemoryAdapter({
      backend,
      embed: fakeEmbed,
      llm: queuedLlm([
        { facts: [{ text: 'User loves cheese pizza' }] }, // first add
        { facts: [{ text: 'User loves cheese pizza' }] }, // second add — same fact
      ]),
      now: () => 't',
      generateId: counterIds(),
    });

    await adapter.add({ messages: 'I love cheese pizza', scope });
    const second = await adapter.add({ messages: 'cheese pizza again', scope });
    expect(second).toHaveLength(0); // hash already present
    expect(backend._size()).toBe(1);
  });

  it('UPDATEs in place when a new fact supersedes an existing one (conflict resolution)', async () => {
    const backend = createInMemoryBackend();
    const adapter = createMemoryAdapter({
      backend,
      embed: fakeEmbed,
      llm: queuedLlm([
        { facts: [{ text: 'User loves cheese pizza' }] }, // add 1 (no reconcile — empty store)
        { facts: [{ text: 'User loves cheese and chicken pizza' }] }, // add 2 extract
        // reconcile add 2: candidate 0 is the existing memory → UPDATE it.
        { memory: [{ id: '0', event: 'UPDATE', text: 'User loves cheese and chicken pizza' }] },
      ]),
      now: () => 't',
      generateId: counterIds(),
    });

    await adapter.add({ messages: 'I love cheese pizza', scope });
    const updated = await adapter.add({ messages: 'actually cheese and chicken pizza', scope });

    // One memory, merged in place — NOT two contradictory rows.
    expect(backend._size()).toBe(1);
    expect(updated).toHaveLength(1);
    const all = await adapter.getAll(scope);
    expect(all).toHaveLength(1);
    expect(all[0].text).toBe('User loves cheese and chicken pizza');
  });

  it('hybrid search returns the relevant memory above the semantic gate', async () => {
    const backend = createInMemoryBackend();
    const adapter = createMemoryAdapter({
      backend,
      embed: fakeEmbed,
      llm: queuedLlm([{ facts: [{ text: 'User loves cheese and chicken pizza' }] }]),
      now: () => 't',
      generateId: counterIds(),
    });
    await adapter.add({ messages: 'cheese and chicken pizza', scope });

    const hits = await adapter.search({ query: 'cheese and chicken pizza', scope, topK: 5 });
    expect(hits).toHaveLength(1);
    expect(hits[0].text).toBe('User loves cheese and chicken pizza');
    expect(hits[0].score).toBeGreaterThan(0.5);
  });

  it('infer=false stores the raw message with no LLM call', async () => {
    const backend = createInMemoryBackend();
    const adapter = createMemoryAdapter({
      backend,
      embed: fakeEmbed,
      llm: queuedLlm([]), // must not be called
      now: () => 't',
      generateId: counterIds(),
    });
    const added = await adapter.add({ messages: 'remember this verbatim', scope, infer: false });
    expect(added).toHaveLength(1);
    expect(added[0].text).toBe('remember this verbatim');
    expect(backend._size()).toBe(1);
  });

  it('isolates memories across orgs (search + get)', async () => {
    const backend = createInMemoryBackend();
    const adapter = createMemoryAdapter({
      backend,
      embed: fakeEmbed,
      llm: queuedLlm([{ facts: [{ text: 'secret for org a' }] }]),
      now: () => 't',
      generateId: counterIds(),
    });
    const [mem] = await adapter.add({ messages: 'secret', scope: { orgId: 'org-a' } });

    // Different org sees nothing.
    expect(await adapter.search({ query: 'secret', scope: { orgId: 'org-b' } })).toHaveLength(0);
    expect(await adapter.get(mem.id, { orgId: 'org-b' })).toBeNull();
    // Same org does.
    expect(await adapter.get(mem.id, { orgId: 'org-a' })).not.toBeNull();
  });
});
