import { describe, expect, it } from 'vitest';
import { ProjectsRepository } from '../projects.repository';
import { makeFakeDatabase } from './fake-db';

function makeRepo() {
  const db = makeFakeDatabase('sqlite');
  return { db, repo: new ProjectsRepository(db) };
}

describe('ProjectsRepository', () => {
  it('creates and retrieves a project', async () => {
    const { repo } = makeRepo();
    const created = await repo.create({
      orgId: 'acme',
      name: 'flow-backend',
      description: 'main repo',
      gitRemote: 'https://github.com/acme/flow-backend.git',
      createdBy: 'user-1',
    });
    expect(created.id).toBeTruthy();
    expect(created.name).toBe('flow-backend');
    expect(created.gitRemote).toBe('https://github.com/acme/flow-backend.git');

    const fetched = await repo.findById(created.id, 'acme');
    expect(fetched?.name).toBe('flow-backend');
  });

  it('list filters by createdBy and gitRemote', async () => {
    const { repo } = makeRepo();
    await repo.create({ orgId: 'acme', name: 'a', createdBy: 'alice' });
    await repo.create({ orgId: 'acme', name: 'b', createdBy: 'bob', gitRemote: 'g1' });
    await repo.create({ orgId: 'acme', name: 'c', createdBy: 'bob', gitRemote: 'g2' });

    const aliceOnly = await repo.list({ createdBy: 'alice' });
    expect(aliceOnly).toHaveLength(1);
    expect(aliceOnly[0]!.name).toBe('a');

    const g2 = await repo.list({ gitRemote: 'g2' });
    expect(g2).toHaveLength(1);
    expect(g2[0]!.name).toBe('c');
  });

  it('update merges fields', async () => {
    const { repo } = makeRepo();
    const created = await repo.create({ orgId: 'acme', name: 'old', createdBy: 'u' });
    const updated = await repo.update(created.id, { name: 'new', description: 'd' }, 'acme');
    expect(updated?.name).toBe('new');
    expect(updated?.description).toBe('d');
  });

  it('tenant isolation', async () => {
    const { repo } = makeRepo();
    const created = await repo.create({ orgId: 'acme', name: 'a', createdBy: 'u' });
    expect(await repo.findById(created.id, 'rival')).toBeNull();
    expect(await repo.update(created.id, { name: 'b' }, 'rival')).toBeNull();
    await repo.delete(created.id, 'rival');
    expect(await repo.findById(created.id, 'acme')).not.toBeNull();
  });
});
