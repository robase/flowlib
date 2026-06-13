/**
 * MemoriesRepository — CRUD, scope-aware listing, keyword search, and
 * tenant isolation, exercised against the in-memory fake database.
 */
import { describe, it, expect } from 'vitest';
import { MemoriesRepository } from '../memories.repository';
import { makeFakeDatabase } from './fake-db';

function makeRepo() {
  const db = makeFakeDatabase('sqlite');
  return { db, repo: new MemoriesRepository(db) };
}

describe('MemoriesRepository', () => {
  it('creates a personal memory and persists tags as JSON', async () => {
    const { db, repo } = makeRepo();
    const created = await repo.create({
      orgId: 'acme',
      scope: 'personal',
      userId: 'u1',
      content: 'User prefers TypeScript',
      tags: ['pref', 'lang'],
      createdBy: 'u1',
    });

    expect(created.scope).toBe('personal');
    expect(created.userId).toBe('u1');
    expect(created.content).toBe('User prefers TypeScript');
    expect(created.tags).toEqual(['pref', 'lang']);
    expect(created.orgId).toBe('acme');

    const row = db._tables.get('agent_memories')?.[0];
    expect(typeof row?.tags).toBe('string'); // stored as JSON string
    expect(row?.user_id).toBe('u1');
  });

  it('listForScope returns org globals + the user’s personal + project memories only', async () => {
    const { repo } = makeRepo();
    await repo.create({ orgId: 'acme', scope: 'global', content: 'org fact', createdBy: 'admin' });
    await repo.create({
      orgId: 'acme',
      scope: 'personal',
      userId: 'u1',
      content: 'u1 personal',
      createdBy: 'u1',
    });
    await repo.create({
      orgId: 'acme',
      scope: 'personal',
      userId: 'u2',
      content: 'u2 personal',
      createdBy: 'u2',
    });
    await repo.create({
      orgId: 'acme',
      scope: 'project',
      projectId: 'p1',
      content: 'project p1 fact',
      createdBy: 'u1',
    });

    const forU1 = await repo.listForScope({ orgId: 'acme', userId: 'u1', projectId: 'p1' });
    const contents = forU1.map((m) => m.content).sort();
    expect(contents).toEqual(['org fact', 'project p1 fact', 'u1 personal']);
    // u2's personal memory must NOT leak to u1
    expect(contents).not.toContain('u2 personal');

    // Without the project, project memories are excluded
    const noProject = await repo.listForScope({ orgId: 'acme', userId: 'u1' });
    expect(noProject.map((m) => m.content).sort()).toEqual(['org fact', 'u1 personal']);
  });

  it('search ranks by keyword overlap and respects scope', async () => {
    const { repo } = makeRepo();
    await repo.create({
      orgId: 'acme',
      scope: 'global',
      content: 'The production database is Postgres on Neon',
      createdBy: 'admin',
    });
    await repo.create({
      orgId: 'acme',
      scope: 'global',
      content: 'The user likes concise replies',
      createdBy: 'admin',
    });
    await repo.create({
      orgId: 'acme',
      scope: 'personal',
      userId: 'u2',
      content: 'u2 secret postgres note',
      createdBy: 'u2',
    });

    const hits = await repo.search('what database do we use in production', {
      orgId: 'acme',
      userId: 'u1',
    });
    expect(hits[0]?.content).toContain('Postgres on Neon');
    // u2's personal memory is out of scope for u1 even though it matches "postgres"
    expect(hits.map((m) => m.content)).not.toContain('u2 secret postgres note');
  });

  it('search returns recent memories when the query has no usable tokens', async () => {
    const { repo } = makeRepo();
    await repo.create({ orgId: 'acme', scope: 'global', content: 'alpha', createdBy: 'a' });
    const hits = await repo.search('  ??  ', { orgId: 'acme', userId: 'u1', limit: 5 });
    expect(hits.map((m) => m.content)).toContain('alpha');
  });

  it('update edits content + tags; delete removes', async () => {
    const { repo } = makeRepo();
    const m = await repo.create({
      orgId: 'acme',
      scope: 'personal',
      userId: 'u1',
      content: 'old',
      createdBy: 'u1',
    });
    const updated = await repo.update(m.id, { content: 'new', tags: ['x'] }, 'acme');
    expect(updated?.content).toBe('new');
    expect(updated?.tags).toEqual(['x']);

    await repo.delete(m.id, 'acme');
    expect(await repo.findById(m.id, 'acme')).toBeNull();
  });

  it('enforces tenant isolation on findById / update / delete', async () => {
    const { repo } = makeRepo();
    const m = await repo.create({
      orgId: 'acme',
      scope: 'global',
      content: 'acme only',
      createdBy: 'u1',
    });
    // Wrong org can't read it
    expect(await repo.findById(m.id, 'other')).toBeNull();
    // Wrong-org update is a no-op (returns null because the row isn't found in that org)
    expect(await repo.update(m.id, { content: 'hacked' }, 'other')).toBeNull();
    // Still intact under the right org
    expect((await repo.findById(m.id, 'acme'))?.content).toBe('acme only');
  });
});
