import { beforeEach, describe, expect, it } from 'vitest';

import { SkillsRepository } from '../skills.repository';
import { makeFakeDatabase, type Row } from './fake-db';

describe('SkillsRepository', () => {
  let db: ReturnType<typeof makeFakeDatabase>;
  let repo: SkillsRepository;

  beforeEach(async () => {
    db = makeFakeDatabase();
    repo = new SkillsRepository(db);
    // org-a: one global, two personal (u1, u2); plus a global in another org.
    await repo.create({
      orgId: 'org-a',
      name: 'release',
      description: 'cut a release',
      body: 'g-body',
      scope: 'global',
    });
    await repo.create({
      orgId: 'org-a',
      name: 'my-notes',
      description: 'u1 notes',
      body: 'u1-body',
      scope: 'personal',
      ownerId: 'u1',
    });
    await repo.create({
      orgId: 'org-a',
      name: 'secret',
      description: 'u2 only',
      body: 'u2-body',
      scope: 'personal',
      ownerId: 'u2',
    });
    await repo.create({
      orgId: 'org-b',
      name: 'release',
      description: 'other org',
      body: 'x',
      scope: 'global',
    });
  });

  it('listForScope returns org globals + the user’s personal skills, sorted by name', async () => {
    const skills = await repo.listForScope({ orgId: 'org-a', userId: 'u1' });
    expect(skills.map((s) => s.name)).toEqual(['my-notes', 'release']); // sorted, u2 excluded
    expect(skills.find((s) => s.name === 'release')?.body).toBe('g-body');
  });

  it('listForScope without a userId returns only globals', async () => {
    const skills = await repo.listForScope({ orgId: 'org-a' });
    expect(skills.map((s) => s.name)).toEqual(['release']);
  });

  it('does not leak skills across orgs', async () => {
    const skills = await repo.listForScope({ orgId: 'org-a', userId: 'u1' });
    expect(skills.every((s) => s.orgId === 'org-a')).toBe(true);
    expect(skills.find((s) => s.body === 'x')).toBeUndefined();
  });

  it('findByName: personal shadows a same-named global', async () => {
    await repo.create({
      orgId: 'org-a',
      name: 'release',
      description: 'u1 override',
      body: 'u1-release',
      scope: 'personal',
      ownerId: 'u1',
    });
    const found = await repo.findByName('release', { orgId: 'org-a', userId: 'u1' });
    expect(found?.body).toBe('u1-release'); // personal wins
    // Without the user, the global is resolved.
    const global = await repo.findByName('release', { orgId: 'org-a' });
    expect(global?.body).toBe('g-body');
  });

  it('findByName returns null for an unknown skill', async () => {
    expect(await repo.findByName('nope', { orgId: 'org-a', userId: 'u1' })).toBeNull();
  });

  it('delete removes the skill', async () => {
    const [s] = await repo.listForScope({ orgId: 'org-a' });
    await repo.delete(s.id, 'org-a');
    const rows = (db._tables.get('agent_skills') ?? []) as Row[];
    expect(rows.find((r) => r.id === s.id)).toBeUndefined();
  });

  it('parses tags from the JSON column', async () => {
    await repo.create({
      orgId: 'org-a',
      name: 'tagged',
      description: 'has tags',
      body: 'b',
      scope: 'global',
      tags: ['ci', 'deploy'],
    });
    const found = await repo.findByName('tagged', { orgId: 'org-a' });
    expect(found?.tags).toEqual(['ci', 'deploy']);
  });
});
