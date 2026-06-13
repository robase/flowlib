/**
 * SessionPlansRepository — upsert (create then replace), get, status
 * coercion, id generation, tenant isolation.
 */
import { describe, it, expect } from 'vitest';
import { SessionPlansRepository } from '../session-plans.repository';
import { makeFakeDatabase } from './fake-db';

function makeRepo() {
  const db = makeFakeDatabase('sqlite');
  return { db, repo: new SessionPlansRepository(db) };
}

describe('SessionPlansRepository', () => {
  it('creates a plan, generating ids and coercing status', async () => {
    const { db, repo } = makeRepo();
    const saved = await repo.upsert('s1', 'acme', [
      { label: 'explore', status: 'doing' },
      { label: 'edit', status: 'nonsense' }, // coerced to 'todo'
    ]);
    expect(saved.checkpoints).toHaveLength(2);
    expect(saved.checkpoints[0]).toMatchObject({ label: 'explore', status: 'doing' });
    expect(typeof saved.checkpoints[0].id).toBe('string');
    expect(saved.checkpoints[1].status).toBe('todo');

    // exactly one row persisted
    expect(db._tables.get('agent_session_plans')?.length).toBe(1);
  });

  it('upsert replaces the whole list and keeps one row per session', async () => {
    const { db, repo } = makeRepo();
    await repo.upsert('s1', 'acme', [{ label: 'a' }]);
    await repo.upsert('s1', 'acme', [{ label: 'b', status: 'done' }, { label: 'c' }]);

    expect(db._tables.get('agent_session_plans')?.length).toBe(1); // updated, not appended
    const got = await repo.get('s1', 'acme');
    expect(got?.checkpoints.map((c) => c.label)).toEqual(['b', 'c']);
    expect(got?.checkpoints[0].status).toBe('done');
  });

  it('get returns null for an unknown session', async () => {
    const { repo } = makeRepo();
    expect(await repo.get('nope', 'acme')).toBeNull();
  });

  it('enforces tenant isolation', async () => {
    const { repo } = makeRepo();
    await repo.upsert('s1', 'acme', [{ label: 'secret' }]);
    expect(await repo.get('s1', 'other')).toBeNull();
    expect((await repo.get('s1', 'acme'))?.checkpoints[0].label).toBe('secret');
  });
});
