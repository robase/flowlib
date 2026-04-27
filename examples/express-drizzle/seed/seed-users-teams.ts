#!/usr/bin/env tsx
/**
 * Seed script for testing the Access Control + Teams UI.
 *
 * Creates:
 *  - 8 users (with hashed passwords via Better Auth)
 *  - 3 teams with members
 *  - 6 flows
 *  - Flow access records (user + team grants)
 *
 * Run: cd examples/express-drizzle && pnpm tsx seed/seed-users-teams.ts
 */
import 'dotenv/config';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { hashPassword } from 'better-auth/crypto';
import { createFlowlib, type FlowlibDefinition } from '@flowlib/core';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const sqlitePath = path.resolve(currentDir, '../dev.db');

const now = new Date().toISOString();

// ─── User definitions ────────────────────────────────────────
const USERS = [
  { name: 'Alice Chen', email: 'alice@example.com', role: 'admin' },
  { name: 'Bob Smith', email: 'bob@example.com', role: 'default' },
  { name: 'Carol Reyes', email: 'carol@example.com', role: 'default' },
  { name: 'Dave Patel', email: 'dave@example.com', role: 'default' },
  { name: 'Eva Müller', email: 'eva@example.com', role: 'default' },
  { name: 'Frank Osei', email: 'frank@example.com', role: 'default' },
  { name: 'Grace Kim', email: 'grace@example.com', role: 'default' },
  { name: 'Hiro Tanaka', email: 'hiro@example.com', role: 'default' },
];

const PASSWORD = 'password123';

// ─── Scope definitions ───────────────────────────────────────
const TEAMS = [
  {
    name: 'Engineering',
    description: 'Core engineering team',
    parentName: null,
    memberEmails: ['alice@example.com', 'bob@example.com', 'carol@example.com', 'dave@example.com'],
  },
  {
    name: 'Platform',
    description: 'Shared infrastructure and developer systems',
    parentName: 'Engineering',
    memberEmails: ['bob@example.com', 'grace@example.com', 'hiro@example.com'],
  },
  {
    name: 'Data Science',
    description: 'ML/AI and analytics',
    parentName: 'Engineering',
    memberEmails: ['eva@example.com', 'frank@example.com', 'carol@example.com'],
  },
  {
    name: 'Operations',
    description: 'DevOps and incident response',
    parentName: null,
    memberEmails: ['grace@example.com', 'hiro@example.com'],
  },
];

// ─── Flow definitions (simple, UI-testable) ──────────────────

function simpleFlow(name: string, description: string): FlowlibDefinition {
  return {
    nodes: [
      {
        id: 'input-1',
        type: 'core.input',
        label: 'Input',
        referenceId: 'input',
        params: { variableName: 'data', defaultValue: '{}' },
        position: { x: 100, y: 200 },
      },
      {
        id: 'template-1',
        type: 'core.template_string',
        label: 'Process',
        referenceId: 'result',
        params: { template: `Processing: {{ input }}` },
        position: { x: 400, y: 200 },
      },
    ],
    edges: [{ id: 'e1', source: 'input-1', target: 'template-1' }],
    metadata: { name, description, created: now },
  };
}

const FLOWS = [
  {
    name: 'Customer Onboarding',
    desc: 'Automated customer onboarding pipeline',
    scopeName: 'Engineering',
  },
  {
    name: 'Data Ingestion Pipeline',
    desc: 'ETL pipeline for raw data processing',
    scopeName: 'Data Science',
  },
  {
    name: 'Incident Response Playbook',
    desc: 'Automated incident triage and escalation',
    scopeName: 'Operations',
  },
  { name: 'Weekly Report Generator', desc: 'Summarises KPIs into a Slack digest', scopeName: null },
  {
    name: 'ML Model Retraining',
    desc: 'Scheduled model retrain and evaluation',
    scopeName: 'Data Science',
  },
  {
    name: 'Infrastructure Health Check',
    desc: 'Periodic infra monitoring and alerts',
    scopeName: 'Platform',
  },
];

// ─── Main ────────────────────────────────────────────────────

async function main() {
  console.log(`📂 Database: ${sqlitePath}\n`);

  const db = new Database(sqlitePath);

  // ── 1. Seed users ──────────────────────────────────────────
  console.log('👤 Seeding users…');

  const hashedPw = await hashPassword(PASSWORD);
  const userIds = new Map<string, string>(); // email → id

  const insertUser = db.prepare(`
    INSERT OR IGNORE INTO user (id, name, email, email_verified, role, created_at, updated_at)
    VALUES (?, ?, ?, 1, ?, ?, ?)
  `);
  const insertAccount = db.prepare(`
    INSERT OR IGNORE INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at)
    VALUES (?, ?, 'credential', ?, ?, ?, ?)
  `);
  const selectUser = db.prepare(`SELECT id FROM user WHERE email = ?`);

  for (const u of USERS) {
    const candidateId = randomUUID();
    insertUser.run(candidateId, u.name, u.email, u.role, now, now);

    const persistedUser = selectUser.get(u.email) as { id: string } | undefined;
    if (!persistedUser) {
      throw new Error(`Failed to resolve user id for ${u.email}`);
    }

    userIds.set(u.email, persistedUser.id);
    insertAccount.run(randomUUID(), u.email, persistedUser.id, hashedPw, now, now);
    console.log(`  ✓ ${u.name} <${u.email}> (${u.role})`);
  }

  // Resolve IDs for users that already existed (INSERT OR IGNORE)
  for (const u of USERS) {
    if (!userIds.has(u.email)) {
      continue;
    }
    const row = selectUser.get(u.email) as { id: string } | undefined;
    if (row) {
      userIds.set(u.email, row.id);
    }
  }

  // ── 2. Seed teams ─────────────────────────────────────────
  console.log('\n👥 Seeding scopes…');

  const adminId = userIds.get('alice@example.com')!;
  const teamIds = new Map<string, string>(); // name → id
  const scopeNames = TEAMS.map((team) => team.name);

  const existingScopeRows = db
    .prepare(
      `SELECT id, name FROM flowlib_rbac_teams WHERE name IN (${scopeNames.map(() => '?').join(', ')})`,
    )
    .all(...scopeNames) as Array<{ id: string; name: string }>;

  if (existingScopeRows.length > 0) {
    const existingScopeIds = existingScopeRows.map((row) => row.id);
    const placeholders = existingScopeIds.map(() => '?').join(', ');

    db.prepare(`UPDATE flowlib_flows SET scope_id = NULL WHERE scope_id IN (${placeholders})`).run(
      ...existingScopeIds,
    );
    db.prepare(`DELETE FROM flowlib_flow_access WHERE team_id IN (${placeholders})`).run(
      ...existingScopeIds,
    );
    db.prepare(
      `DELETE FROM flowlib_rbac_scope_access WHERE scope_id IN (${placeholders}) OR team_id IN (${placeholders})`,
    ).run(...existingScopeIds, ...existingScopeIds);
    db.prepare(`DELETE FROM flowlib_rbac_team_members WHERE team_id IN (${placeholders})`).run(
      ...existingScopeIds,
    );
    db.prepare(`DELETE FROM flowlib_rbac_teams WHERE id IN (${placeholders})`).run(
      ...existingScopeIds,
    );

    console.log(`  ↺ Removed ${existingScopeRows.length} previously seeded scope rows`);
  }

  const insertTeam = db.prepare(`
    INSERT OR REPLACE INTO flowlib_rbac_teams (id, name, description, parent_id, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertMember = db.prepare(`
    INSERT OR IGNORE INTO flowlib_rbac_team_members (id, team_id, user_id, created_at)
    VALUES (?, ?, ?, ?)
  `);

  for (const team of TEAMS) {
    const teamId = randomUUID();
    teamIds.set(team.name, teamId);
  }

  for (const team of TEAMS) {
    insertTeam.run(
      teamIds.get(team.name)!,
      team.name,
      team.description,
      team.parentName ? teamIds.get(team.parentName)! : null,
      adminId,
      now,
      now,
    );
    console.log(
      `  ✓ ${team.name}${team.parentName ? ` (under ${team.parentName})` : ''} — ${team.description}`,
    );

    for (const email of team.memberEmails) {
      const userId = userIds.get(email);
      if (!userId) {
        continue;
      }
      insertMember.run(randomUUID(), teamIds.get(team.name)!, userId, now);
      console.log(`    + ${email}`);
    }
  }

  db.close();

  // ── 3. Seed flows + access ─────────────────────────────────
  console.log('\n📦 Seeding flows…');

  const flowlib = await createFlowlib({
    encryptionKey: process.env.FLOWLIB_ENCRYPTION_KEY || 'dGVzdC1lbmNyeXB0aW9uLWtleS0xMjM0NTY3ODkw',
    database: {
      type: 'sqlite',
      connectionString: `file:${sqlitePath}`,
    },
    logging: { level: 'warn' },
  });

  const createdFlowIds: string[] = [];

  for (const f of FLOWS) {
    // Delete existing by name
    const { data: existing } = await flowlib.flows.list();
    for (const old of existing.filter((fl: { name: string; id: string }) => fl.name === f.name)) {
      await flowlib.flows.delete(old.id);
    }

    const flow = await flowlib.flows.create({ name: f.name, isActive: false });
    await flowlib.versions.create(flow.id, {
      flowlibDefinition: simpleFlow(f.name, f.desc),
    });
    createdFlowIds.push(flow.id);
    console.log(`  ✓ ${f.name} (${flow.id})`);
  }

  await flowlib.shutdown();

  // ── 4. Seed flow_access records ────────────────────────────
  console.log('\n🔒 Seeding flow access…');

  const db2 = new Database(sqlitePath);
  const updateFlowScope = db2.prepare('UPDATE flowlib_flows SET scope_id = ? WHERE id = ?');

  const insertAccess = db2.prepare(`
    INSERT OR IGNORE INTO flowlib_flow_access (id, flow_id, user_id, team_id, permission, granted_by, granted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertScopeAccess = db2.prepare(`
    INSERT OR IGNORE INTO flowlib_rbac_scope_access (id, scope_id, user_id, team_id, permission, granted_by, granted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (const [index, flowId] of createdFlowIds.entries()) {
    const scopeName = FLOWS[index]?.scopeName ?? null;
    updateFlowScope.run(scopeName ? teamIds.get(scopeName)! : null, flowId);
  }

  insertScopeAccess.run(
    randomUUID(),
    teamIds.get('Engineering')!,
    null,
    teamIds.get('Engineering')!,
    'editor',
    adminId,
    now,
  );
  insertScopeAccess.run(
    randomUUID(),
    teamIds.get('Engineering')!,
    userIds.get('alice@example.com')!,
    null,
    'owner',
    adminId,
    now,
  );
  insertScopeAccess.run(
    randomUUID(),
    teamIds.get('Platform')!,
    null,
    teamIds.get('Operations')!,
    'viewer',
    adminId,
    now,
  );
  insertScopeAccess.run(
    randomUUID(),
    teamIds.get('Data Science')!,
    null,
    teamIds.get('Data Science')!,
    'owner',
    adminId,
    now,
  );
  insertScopeAccess.run(
    randomUUID(),
    teamIds.get('Operations')!,
    null,
    teamIds.get('Operations')!,
    'operator',
    adminId,
    now,
  );
  console.log(
    '  ✓ Scope access grants seeded for Engineering, Platform, Data Science, and Operations',
  );

  // Flow 0 (Customer Onboarding): Alice=owner, Bob=editor, Engineering team=viewer
  const f0 = createdFlowIds[0];
  insertAccess.run(
    randomUUID(),
    f0,
    userIds.get('alice@example.com')!,
    null,
    'owner',
    adminId,
    now,
  );
  insertAccess.run(randomUUID(), f0, userIds.get('bob@example.com')!, null, 'editor', adminId, now);
  insertAccess.run(randomUUID(), f0, null, teamIds.get('Engineering')!, 'viewer', adminId, now);
  console.log('  ✓ Customer Onboarding → Alice(owner), Bob(editor), Engineering(viewer)');

  // Flow 1 (Data Ingestion): Alice=owner, Data Science team=editor
  const f1 = createdFlowIds[1];
  insertAccess.run(
    randomUUID(),
    f1,
    userIds.get('alice@example.com')!,
    null,
    'owner',
    adminId,
    now,
  );
  insertAccess.run(randomUUID(), f1, null, teamIds.get('Data Science')!, 'editor', adminId, now);
  console.log('  ✓ Data Ingestion Pipeline → Alice(owner), Data Science(editor)');

  // Flow 2 (Incident Response): Alice=owner, Operations team=operator, Grace=editor
  const f2 = createdFlowIds[2];
  insertAccess.run(
    randomUUID(),
    f2,
    userIds.get('alice@example.com')!,
    null,
    'owner',
    adminId,
    now,
  );
  insertAccess.run(randomUUID(), f2, null, teamIds.get('Operations')!, 'operator', adminId, now);
  insertAccess.run(
    randomUUID(),
    f2,
    userIds.get('grace@example.com')!,
    null,
    'editor',
    adminId,
    now,
  );
  console.log('  ✓ Incident Response → Alice(owner), Operations(operator), Grace(editor)');

  // Flow 3 (Weekly Report): Alice=owner, Carol=viewer, Dave=viewer
  const f3 = createdFlowIds[3];
  insertAccess.run(
    randomUUID(),
    f3,
    userIds.get('alice@example.com')!,
    null,
    'owner',
    adminId,
    now,
  );
  insertAccess.run(
    randomUUID(),
    f3,
    userIds.get('carol@example.com')!,
    null,
    'viewer',
    adminId,
    now,
  );
  insertAccess.run(
    randomUUID(),
    f3,
    userIds.get('dave@example.com')!,
    null,
    'viewer',
    adminId,
    now,
  );
  console.log('  ✓ Weekly Report → Alice(owner), Carol(viewer), Dave(viewer)');

  // Flow 4 (ML Retraining): Alice=owner, Data Science team=owner, Eva=editor
  const f4 = createdFlowIds[4];
  insertAccess.run(
    randomUUID(),
    f4,
    userIds.get('alice@example.com')!,
    null,
    'owner',
    adminId,
    now,
  );
  insertAccess.run(randomUUID(), f4, null, teamIds.get('Data Science')!, 'owner', adminId, now);
  insertAccess.run(randomUUID(), f4, userIds.get('eva@example.com')!, null, 'editor', adminId, now);
  console.log('  ✓ ML Retraining → Alice(owner), Data Science(owner), Eva(editor)');

  // Flow 5 (Infra Health): Alice=owner, Operations team=editor, Engineering team=viewer
  const f5 = createdFlowIds[5];
  insertAccess.run(
    randomUUID(),
    f5,
    userIds.get('alice@example.com')!,
    null,
    'owner',
    adminId,
    now,
  );
  insertAccess.run(randomUUID(), f5, null, teamIds.get('Operations')!, 'editor', adminId, now);
  insertAccess.run(randomUUID(), f5, null, teamIds.get('Engineering')!, 'viewer', adminId, now);
  console.log('  ✓ Infra Health Check → Alice(owner), Operations(editor), Engineering(viewer)');

  db2.close();

  // ── Summary ────────────────────────────────────────────────
  console.log('\n🎉 Seed complete!');
  console.log(`   ${USERS.length} users (password: "${PASSWORD}")`);
  console.log(`   ${TEAMS.length} scopes (with nesting)`);
  console.log(`   ${FLOWS.length} flows with direct and inherited access data`);
}

main().catch((err) => {
  console.error('💥 Seed failed:', err);
  process.exit(1);
});
