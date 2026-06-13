/**
 * McpServersRepository — CRUD + tenant isolation over the fake DB.
 */
import { describe, it, expect } from 'vitest';
import { McpServersRepository } from '../mcp-servers.repository';
import { makeFakeDatabase } from './fake-db';

function makeRepo() {
  const db = makeFakeDatabase('sqlite');
  return { db, repo: new McpServersRepository(db) };
}

describe('McpServersRepository', () => {
  it('creates an http server and persists config as JSON', async () => {
    const { db, repo } = makeRepo();
    const created = await repo.create({
      orgId: 'acme',
      name: 'github-mcp',
      description: 'GitHub MCP',
      transport: 'http',
      config: { url: 'https://mcp.example.com', headers: { Authorization: 'Bearer x' } },
      createdBy: 'u1',
    });

    expect(created.name).toBe('github-mcp');
    expect(created.transport).toBe('http');
    expect(created.config).toEqual({
      url: 'https://mcp.example.com',
      headers: { Authorization: 'Bearer x' },
    });
    expect(created.orgId).toBe('acme');

    const row = db._tables.get('agent_mcp_servers')?.[0];
    expect(typeof row?.config).toBe('string'); // stored as JSON string
  });

  it('lists only the org’s servers', async () => {
    const { repo } = makeRepo();
    await repo.create({
      orgId: 'acme',
      name: 'a',
      transport: 'http',
      config: { url: 'https://a' },
      createdBy: 'u1',
    });
    await repo.create({
      orgId: 'other',
      name: 'b',
      transport: 'http',
      config: { url: 'https://b' },
      createdBy: 'u9',
    });

    const acme = await repo.list({ orgId: 'acme' });
    expect(acme.map((s) => s.name)).toEqual(['a']);
  });

  it('updates fields and deletes', async () => {
    const { repo } = makeRepo();
    const s = await repo.create({
      orgId: 'acme',
      name: 'srv',
      transport: 'http',
      config: { url: 'https://old' },
      createdBy: 'u1',
    });
    const updated = await repo.update(
      s.id,
      { name: 'renamed', config: { url: 'https://new' } },
      'acme',
    );
    expect(updated?.name).toBe('renamed');
    expect(updated?.config).toEqual({ url: 'https://new' });

    await repo.delete(s.id, 'acme');
    expect(await repo.findById(s.id, 'acme')).toBeNull();
  });

  it('enforces tenant isolation on read / update', async () => {
    const { repo } = makeRepo();
    const s = await repo.create({
      orgId: 'acme',
      name: 'srv',
      transport: 'sse',
      config: { url: 'https://x' },
      createdBy: 'u1',
    });
    expect(await repo.findById(s.id, 'other')).toBeNull();
    expect(await repo.update(s.id, { name: 'hacked' }, 'other')).toBeNull();
    expect((await repo.findById(s.id, 'acme'))?.name).toBe('srv');
  });
});
