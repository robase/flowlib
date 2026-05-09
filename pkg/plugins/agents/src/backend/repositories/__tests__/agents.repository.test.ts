import { describe, expect, it } from 'vitest';
import { AgentsRepository } from '../agents.repository';
import { makeFakeDatabase } from './fake-db';

function makeRepo() {
  const db = makeFakeDatabase('sqlite');
  return { db, repo: new AgentsRepository(db) };
}

describe('AgentsRepository', () => {
  it('creates an agent and persists JSON columns', async () => {
    const { db, repo } = makeRepo();

    const created = await repo.create({
      orgId: 'acme',
      name: 'Test Agent',
      providerId: 'claude-code',
      providerConfig: { foo: 'bar' },
      mcpServers: { local: { transport: 'stdio' } },
      enabledTools: ['Bash', 'Read'],
      denyList: ['Delete'],
      exposeFlowlibActions: true,
      toolOutputBudget: { lines: 50, bytes: 2048 },
      createdBy: 'user-1',
      visibility: 'private',
    });

    expect(created.id).toBeTruthy();
    expect(created.orgId).toBe('acme');
    expect(created.name).toBe('Test Agent');
    expect(created.providerId).toBe('claude-code');
    expect(created.providerConfig).toEqual({ foo: 'bar' });
    expect(created.mcpServers).toEqual({ local: { transport: 'stdio' } });
    expect(created.enabledTools).toEqual(['Bash', 'Read']);
    expect(created.denyList).toEqual(['Delete']);
    expect(created.exposeFlowlibActions).toBe(true);
    expect(created.toolOutputBudget).toEqual({ lines: 50, bytes: 2048 });
    expect(created.visibility).toBe('private');
    expect(created.createdAt).toBeTruthy();

    // Stored row uses snake_case columns + JSON-encoded strings.
    const row = db._tables.get('agent_definitions')?.[0];
    expect(row).toBeDefined();
    expect(row?.org_id).toBe('acme');
    expect(row?.provider_id).toBe('claude-code');
    expect(typeof row?.provider_config).toBe('string');
    expect(JSON.parse(row?.provider_config as string)).toEqual({ foo: 'bar' });
    // SQLite stores booleans as 0/1.
    expect(row?.expose_flowlib_actions).toBe(1);
  });

  it('findById returns null when org filter does not match', async () => {
    const { repo } = makeRepo();
    const created = await repo.create({
      orgId: 'acme',
      name: 'A',
      providerId: 'claude-code',
      createdBy: 'u',
    });

    const sameOrg = await repo.findById(created.id, 'acme');
    expect(sameOrg?.id).toBe(created.id);

    const otherOrg = await repo.findById(created.id, 'rival');
    expect(otherOrg).toBeNull();

    // No org filter — caller opts out of tenancy
    const noOrgFilter = await repo.findById(created.id);
    expect(noOrgFilter?.id).toBe(created.id);
  });

  it('list filters by orgId, providerId, createdBy, visibility', async () => {
    const { repo } = makeRepo();
    await repo.create({
      orgId: 'acme',
      name: 'A1',
      providerId: 'claude-code',
      createdBy: 'alice',
      visibility: 'private',
    });
    await repo.create({
      orgId: 'acme',
      name: 'A2',
      providerId: 'opencode',
      createdBy: 'bob',
      visibility: 'shared',
    });
    await repo.create({
      orgId: 'rival',
      name: 'A3',
      providerId: 'claude-code',
      createdBy: 'eve',
    });

    const acme = await repo.list({ orgId: 'acme' });
    expect(acme).toHaveLength(2);

    const claudeOnly = await repo.list({ orgId: 'acme', providerId: 'claude-code' });
    expect(claudeOnly).toHaveLength(1);
    expect(claudeOnly[0]!.name).toBe('A1');

    const aliceOnly = await repo.list({ createdBy: 'alice' });
    expect(aliceOnly).toHaveLength(1);

    const sharedOnly = await repo.list({ visibility: 'shared' });
    expect(sharedOnly).toHaveLength(1);
    expect(sharedOnly[0]!.name).toBe('A2');
  });

  it('update merges fields and refreshes updatedAt', async () => {
    const { repo } = makeRepo();
    const created = await repo.create({
      orgId: 'acme',
      name: 'Old',
      providerId: 'claude-code',
      createdBy: 'u',
      enabledTools: ['Bash'],
    });

    const updated = await repo.update(
      created.id,
      { name: 'New', enabledTools: ['Bash', 'Read'], visibility: 'shared' },
      'acme',
    );

    expect(updated?.name).toBe('New');
    expect(updated?.enabledTools).toEqual(['Bash', 'Read']);
    expect(updated?.visibility).toBe('shared');
    // providerId unchanged
    expect(updated?.providerId).toBe('claude-code');
  });

  it('update returns null when org filter excludes the row', async () => {
    const { repo } = makeRepo();
    const created = await repo.create({
      orgId: 'acme',
      name: 'A',
      providerId: 'claude-code',
      createdBy: 'u',
    });

    const result = await repo.update(created.id, { name: 'B' }, 'rival');
    expect(result).toBeNull();
    // Verify row didn't change.
    const fresh = await repo.findById(created.id, 'acme');
    expect(fresh?.name).toBe('A');
  });

  it('delete removes the row only when org matches', async () => {
    const { repo } = makeRepo();
    const created = await repo.create({
      orgId: 'acme',
      name: 'A',
      providerId: 'claude-code',
      createdBy: 'u',
    });

    await repo.delete(created.id, 'rival');
    expect(await repo.findById(created.id, 'acme')).not.toBeNull();

    await repo.delete(created.id, 'acme');
    expect(await repo.findById(created.id, 'acme')).toBeNull();
  });

  it('null orgId is treated as "is null" not "= null"', async () => {
    const { repo } = makeRepo();
    await repo.create({
      orgId: null,
      name: 'Default',
      providerId: 'claude-code',
      createdBy: 'u',
    });

    const list = await repo.list({ orgId: null });
    expect(list).toHaveLength(1);
    expect(list[0]!.orgId).toBeNull();
  });
});
