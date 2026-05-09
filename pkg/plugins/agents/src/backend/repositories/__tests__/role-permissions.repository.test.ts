import { describe, expect, it } from 'vitest';
import { RolePermissionsRepository } from '../role-permissions.repository';
import { makeFakeDatabase } from './fake-db';

function makeRepo() {
  const db = makeFakeDatabase('sqlite');
  return { db, repo: new RolePermissionsRepository(db) };
}

describe('RolePermissionsRepository', () => {
  it('creates and reads a permission row', async () => {
    const { repo } = makeRepo();
    const created = await repo.create({
      roleId: 'admin',
      toolName: 'Bash',
      enabled: true,
      reason: 'admins can shell out',
    });

    expect(created.roleId).toBe('admin');
    expect(created.toolName).toBe('Bash');
    expect(created.enabled).toBe(true);
    expect(created.reason).toBe('admins can shell out');

    const fetched = await repo.findById('admin', 'Bash');
    expect(fetched?.enabled).toBe(true);
  });

  it('upsert inserts then updates the same composite key', async () => {
    const { repo } = makeRepo();
    await repo.upsert({ roleId: 'user', toolName: 'Bash', enabled: false });
    const first = await repo.findById('user', 'Bash');
    expect(first?.enabled).toBe(false);

    await repo.upsert({ roleId: 'user', toolName: 'Bash', enabled: true, reason: 'upgraded' });
    const second = await repo.findById('user', 'Bash');
    expect(second?.enabled).toBe(true);
    expect(second?.reason).toBe('upgraded');

    // Still a single row.
    const all = await repo.list({ roleId: 'user', toolName: 'Bash' });
    expect(all).toHaveLength(1);
  });

  it('list filters by enabled and toolName', async () => {
    const { repo } = makeRepo();
    await repo.upsert({ roleId: 'admin', toolName: 'Bash', enabled: true });
    await repo.upsert({ roleId: 'admin', toolName: 'Edit', enabled: true });
    await repo.upsert({ roleId: 'user', toolName: 'Bash', enabled: false });

    const enabled = await repo.list({ enabled: true });
    expect(enabled).toHaveLength(2);

    const bashOnly = await repo.list({ toolName: 'Bash' });
    expect(bashOnly).toHaveLength(2);

    const adminBash = await repo.list({ roleId: 'admin', toolName: 'Bash' });
    expect(adminBash).toHaveLength(1);
    expect(adminBash[0]!.enabled).toBe(true);
  });

  it('update changes the enabled flag and reason', async () => {
    const { repo } = makeRepo();
    await repo.create({ roleId: 'admin', toolName: 'Bash', enabled: true });
    const updated = await repo.update('admin', 'Bash', { enabled: false, reason: 'tightened' });
    expect(updated?.enabled).toBe(false);
    expect(updated?.reason).toBe('tightened');
  });

  it('delete removes only the composite key', async () => {
    const { repo } = makeRepo();
    await repo.create({ roleId: 'admin', toolName: 'Bash', enabled: true });
    await repo.create({ roleId: 'admin', toolName: 'Edit', enabled: true });
    await repo.delete('admin', 'Bash');
    expect(await repo.findById('admin', 'Bash')).toBeNull();
    expect(await repo.findById('admin', 'Edit')).not.toBeNull();
  });
});
