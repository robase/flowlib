import { describe, expect, it } from 'vitest';
import { AuditRepository } from '../audit.repository';
import { makeFakeDatabase } from './fake-db';

function makeRepo() {
  const db = makeFakeDatabase('sqlite');
  return { db, repo: new AuditRepository(db) };
}

describe('AuditRepository', () => {
  it('creates an audit event with payload as JSON', async () => {
    const { db, repo } = makeRepo();
    const created = await repo.create({
      orgId: 'acme',
      sessionId: 'sess-1',
      userId: 'user-1',
      eventType: 'tool_blocked',
      toolName: 'Bash',
      payload: { reason: 'deny-list', input: { cmd: 'rm -rf /' } },
    });

    expect(created.eventType).toBe('tool_blocked');
    expect(created.toolName).toBe('Bash');
    expect(created.payload).toEqual({ reason: 'deny-list', input: { cmd: 'rm -rf /' } });

    const row = db._tables.get('agent_audit_events')?.[0];
    expect(typeof row?.payload).toBe('string');
  });

  it('list filters by sessionId, eventType, toolName', async () => {
    const { repo } = makeRepo();
    await repo.create({
      orgId: 'acme',
      sessionId: 'sess-1',
      userId: 'u',
      eventType: 'tool_blocked',
      toolName: 'Bash',
    });
    await repo.create({
      orgId: 'acme',
      sessionId: 'sess-1',
      userId: 'u',
      eventType: 'secret_redacted',
    });
    await repo.create({
      orgId: 'acme',
      sessionId: 'sess-2',
      userId: 'u',
      eventType: 'tool_blocked',
      toolName: 'Edit',
    });

    const sess1 = await repo.list({ sessionId: 'sess-1' });
    expect(sess1).toHaveLength(2);

    const blocked = await repo.list({ eventType: 'tool_blocked' });
    expect(blocked).toHaveLength(2);

    const bashOnly = await repo.list({ toolName: 'Bash' });
    expect(bashOnly).toHaveLength(1);
    expect(bashOnly[0]!.sessionId).toBe('sess-1');
  });

  it('findById is tenant-scoped', async () => {
    const { repo } = makeRepo();
    const created = await repo.create({
      orgId: 'acme',
      sessionId: 's',
      userId: 'u',
      eventType: 'tool_blocked',
    });
    expect(await repo.findById(created.id, 'rival')).toBeNull();
    expect(await repo.findById(created.id, 'acme')).not.toBeNull();
  });

  it('payload defaults to empty object when omitted', async () => {
    const { repo } = makeRepo();
    const created = await repo.create({
      orgId: 'acme',
      sessionId: 's',
      userId: 'u',
      eventType: 'sanitizer_warning',
    });
    expect(created.payload).toEqual({});
  });
});
