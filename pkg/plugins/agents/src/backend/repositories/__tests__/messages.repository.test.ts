import { describe, expect, it } from 'vitest';
import { MessagesRepository } from '../messages.repository';
import { makeFakeDatabase } from './fake-db';

function makeRepo() {
  const db = makeFakeDatabase('sqlite');
  return { db, repo: new MessagesRepository(db) };
}

describe('MessagesRepository', () => {
  it('creates messages with parts JSON-encoded', async () => {
    const { db, repo } = makeRepo();
    const created = await repo.create({
      orgId: 'acme',
      sessionId: 'sess-1',
      sequence: 1,
      role: 'user',
      parts: [{ type: 'text', text: 'hello' }],
      userId: 'user-1',
    });

    expect(created.role).toBe('user');
    expect(created.parts).toEqual([{ type: 'text', text: 'hello' }]);
    expect(created.usage).toBeNull();
    expect(created.costUsd).toBe('0');

    const row = db._tables.get('agent_messages')?.[0];
    expect(typeof row?.parts).toBe('string');
    expect(JSON.parse(row?.parts as string)).toEqual([{ type: 'text', text: 'hello' }]);
  });

  it('list filters by session and afterSequence', async () => {
    const { repo } = makeRepo();
    for (let i = 1; i <= 5; i++) {
      await repo.create({
        orgId: 'acme',
        sessionId: 'sess-1',
        sequence: i,
        role: i % 2 === 0 ? 'assistant' : 'user',
        parts: [{ type: 'text', text: `msg-${i}` }],
      });
    }
    await repo.create({
      orgId: 'acme',
      sessionId: 'sess-2',
      sequence: 1,
      role: 'user',
      parts: [{ type: 'text', text: 'other' }],
    });

    const sess1 = await repo.list({ sessionId: 'sess-1' });
    expect(sess1).toHaveLength(5);
    expect(sess1.map((m) => m.sequence)).toEqual([1, 2, 3, 4, 5]);

    const tail = await repo.list({ sessionId: 'sess-1', afterSequence: 2 });
    expect(tail).toHaveLength(3);
    expect(tail[0]!.sequence).toBe(3);
  });

  it('persists usage when supplied', async () => {
    const { repo } = makeRepo();
    const created = await repo.create({
      orgId: 'acme',
      sessionId: 'sess-1',
      sequence: 1,
      role: 'assistant',
      parts: [{ type: 'text', text: 'response' }],
      usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 25 },
      costUsd: '0.001',
    });
    expect(created.usage).toEqual({ inputTokens: 100, outputTokens: 50, cacheReadTokens: 25 });
    expect(created.costUsd).toBe('0.001');
  });

  it('tenant isolation on findById', async () => {
    const { repo } = makeRepo();
    const created = await repo.create({
      orgId: 'acme',
      sessionId: 'sess-1',
      sequence: 1,
      role: 'user',
      parts: [],
    });
    expect(await repo.findById(created.id, 'rival')).toBeNull();
    expect(await repo.findById(created.id, 'acme')).not.toBeNull();
  });
});
