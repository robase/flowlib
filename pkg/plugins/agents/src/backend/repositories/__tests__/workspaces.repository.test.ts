import { describe, expect, it } from 'vitest';
import { WorkspacesRepository } from '../workspaces.repository';
import { makeFakeDatabase } from './fake-db';

function makeRepo() {
  const db = makeFakeDatabase('sqlite');
  return { db, repo: new WorkspacesRepository(db) };
}

describe('WorkspacesRepository', () => {
  it('creates a workspace with sandbox config persisted as JSON', async () => {
    const { db, repo } = makeRepo();
    const created = await repo.create({
      orgId: 'acme',
      name: 'sandbox-1',
      workspaceProviderId: 'cloudflare-sandbox',
      sandboxConfig: { region: 'iad', cpu: 1 },
      createdBy: 'u',
    });

    expect(created.workspaceProviderId).toBe('cloudflare-sandbox');
    expect(created.sandboxConfig).toEqual({ region: 'iad', cpu: 1 });
    const row = db._tables.get('agent_workspaces')?.[0];
    expect(typeof row?.sandbox_config).toBe('string');
  });

  it('null sandboxConfig stays null on the row and on read', async () => {
    const { db, repo } = makeRepo();
    const created = await repo.create({
      orgId: 'acme',
      name: 'plain',
      workspaceProviderId: 'none',
      createdBy: 'u',
    });
    expect(created.sandboxConfig).toBeNull();
    const row = db._tables.get('agent_workspaces')?.[0];
    expect(row?.sandbox_config).toBeNull();
  });

  it('list filters by projectId and workspaceProviderId', async () => {
    const { repo } = makeRepo();
    await repo.create({
      orgId: 'acme',
      name: 'a',
      workspaceProviderId: 'local-fs',
      projectId: 'proj-1',
      createdBy: 'u',
    });
    await repo.create({
      orgId: 'acme',
      name: 'b',
      workspaceProviderId: 'git-clone',
      projectId: 'proj-1',
      createdBy: 'u',
    });
    await repo.create({
      orgId: 'acme',
      name: 'c',
      workspaceProviderId: 'local-fs',
      projectId: 'proj-2',
      createdBy: 'u',
    });

    const proj1 = await repo.list({ projectId: 'proj-1' });
    expect(proj1).toHaveLength(2);

    const localFs = await repo.list({ workspaceProviderId: 'local-fs' });
    expect(localFs).toHaveLength(2);

    const both = await repo.list({ projectId: 'proj-1', workspaceProviderId: 'local-fs' });
    expect(both).toHaveLength(1);
    expect(both[0]!.name).toBe('a');
  });

  it('update merges fields', async () => {
    const { repo } = makeRepo();
    const created = await repo.create({
      orgId: 'acme',
      name: 'old',
      workspaceProviderId: 'local-fs',
      rootPath: '/old',
      createdBy: 'u',
    });
    const updated = await repo.update(
      created.id,
      { name: 'new', rootPath: '/new', visibility: 'shared' },
      'acme',
    );
    expect(updated?.name).toBe('new');
    expect(updated?.rootPath).toBe('/new');
    expect(updated?.visibility).toBe('shared');
    expect(updated?.workspaceProviderId).toBe('local-fs');
  });

  it('tenant isolation on update + delete', async () => {
    const { repo } = makeRepo();
    const created = await repo.create({
      orgId: 'acme',
      name: 'a',
      workspaceProviderId: 'local-fs',
      createdBy: 'u',
    });

    expect(await repo.update(created.id, { name: 'b' }, 'rival')).toBeNull();
    await repo.delete(created.id, 'rival');
    expect(await repo.findById(created.id, 'acme')).not.toBeNull();
  });
});
