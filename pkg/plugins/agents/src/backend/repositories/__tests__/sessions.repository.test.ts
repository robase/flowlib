import { describe, expect, it } from 'vitest';
import { SessionsRepository } from '../sessions.repository';
import { makeFakeDatabase } from './fake-db';

function makeRepo() {
  const db = makeFakeDatabase('sqlite');
  return { db, repo: new SessionsRepository(db) };
}

describe('SessionsRepository', () => {
  it('creates a session with defaults applied', async () => {
    const { repo } = makeRepo();
    const created = await repo.create({
      orgId: 'acme',
      agentId: 'agent-1',
      providerSessionId: 'p-123',
      createdBy: 'user-1',
    });

    expect(created.id).toBeTruthy();
    expect(created.title).toBe('New chat');
    expect(created.status).toBe('active');
    expect(created.visibility).toBe('private');
    expect(created.messageCount).toBe(0);
    expect(created.lastMessageAt).toBeNull();
    expect(created.costUsd).toBe('0');
  });

  it('list filters by agentId and status', async () => {
    const { repo } = makeRepo();
    await repo.create({
      orgId: 'acme',
      agentId: 'agent-1',
      providerSessionId: 'p1',
      createdBy: 'u',
    });
    const s2 = await repo.create({
      orgId: 'acme',
      agentId: 'agent-1',
      providerSessionId: 'p2',
      createdBy: 'u',
    });
    await repo.update(s2.id, { status: 'archived' }, 'acme');

    await repo.create({
      orgId: 'acme',
      agentId: 'agent-2',
      providerSessionId: 'p3',
      createdBy: 'u',
    });

    const agent1 = await repo.list({ agentId: 'agent-1' });
    expect(agent1).toHaveLength(2);

    const active = await repo.list({ status: 'active' });
    expect(active).toHaveLength(2);

    const archived = await repo.list({ status: 'archived' });
    expect(archived).toHaveLength(1);
    expect(archived[0]!.id).toBe(s2.id);
  });

  it('update can bump messageCount, tokens, lastMessageAt', async () => {
    const { repo } = makeRepo();
    const created = await repo.create({
      orgId: 'acme',
      agentId: 'agent-1',
      providerSessionId: 'p1',
      createdBy: 'u',
    });

    const ts = new Date('2025-01-01T00:00:00Z');
    const updated = await repo.update(
      created.id,
      {
        messageCount: 5,
        inputTokensTotal: 100,
        outputTokensTotal: 50,
        costUsd: '0.0123',
        lastMessageAt: ts,
      },
      'acme',
    );

    expect(updated?.messageCount).toBe(5);
    expect(updated?.inputTokensTotal).toBe(100);
    expect(updated?.outputTokensTotal).toBe(50);
    expect(updated?.costUsd).toBe('0.0123');
    expect(updated?.lastMessageAt).toBe(ts.toISOString());
  });

  it('tenant isolation on findById', async () => {
    const { repo } = makeRepo();
    const created = await repo.create({
      orgId: 'acme',
      agentId: 'agent-1',
      providerSessionId: 'p1',
      createdBy: 'u',
    });
    expect(await repo.findById(created.id, 'rival')).toBeNull();
    expect(await repo.findById(created.id, 'acme')).not.toBeNull();
  });

  it('delete is tenant-scoped', async () => {
    const { repo } = makeRepo();
    const created = await repo.create({
      orgId: 'acme',
      agentId: 'agent-1',
      providerSessionId: 'p1',
      createdBy: 'u',
    });
    await repo.delete(created.id, 'rival');
    expect(await repo.findById(created.id, 'acme')).not.toBeNull();
    await repo.delete(created.id, 'acme');
    expect(await repo.findById(created.id, 'acme')).toBeNull();
  });
});
