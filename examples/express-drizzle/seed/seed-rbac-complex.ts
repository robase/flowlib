#!/usr/bin/env tsx
/**
 * Complex RBAC seed — deep team hierarchy for UI testing.
 *
 * Hierarchy (3 levels):
 *
 *  Product
 *  ├── Mobile
 *  │   ├── iOS
 *  │   └── Android
 *  └── Web
 *
 *  Engineering
 *  ├── Backend
 *  ├── Frontend
 *  └── Platform
 *      └── Infrastructure
 *
 *  Business
 *  ├── Marketing
 *  └── Sales
 *
 * Users: 12 (all with password "password123")
 * Flows: 22 (spread across scopes + 3 unscoped)
 * Access: team-role grants at each scope level, per-user grants on specific flows
 *
 * Run:  cd examples/express-drizzle && pnpm seed:rbac
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
const PASSWORD = 'password123';

// ─── Users ───────────────────────────────────────────────────

const USERS = [
  { name: 'Alice Chen', email: 'alice@example.com', role: 'admin' },
  { name: 'Bob Smith', email: 'bob@example.com', role: 'default' },
  { name: 'Carol Reyes', email: 'carol@example.com', role: 'default' },
  { name: 'Dave Patel', email: 'dave@example.com', role: 'default' },
  { name: 'Eva Müller', email: 'eva@example.com', role: 'default' },
  { name: 'Frank Osei', email: 'frank@example.com', role: 'default' },
  { name: 'Grace Kim', email: 'grace@example.com', role: 'default' },
  { name: 'Hiro Tanaka', email: 'hiro@example.com', role: 'default' },
  { name: 'Isabella Santos', email: 'isabella@example.com', role: 'default' },
  { name: 'Jake Wilson', email: 'jake@example.com', role: 'default' },
  { name: 'Karen Lee', email: 'karen@example.com', role: 'default' },
  { name: 'Leo Martinez', email: 'leo@example.com', role: 'default' },
];

// ─── Team hierarchy ──────────────────────────────────────────
// parentName: null = root team

const TEAMS = [
  // ── Product pillar ──
  {
    name: 'Product',
    description: 'Product management and design',
    parentName: null,
    memberEmails: ['alice@example.com', 'karen@example.com', 'leo@example.com'],
    teamRole: 'viewer' as const,
  },
  {
    name: 'Mobile',
    description: 'iOS and Android product',
    parentName: 'Product',
    memberEmails: ['karen@example.com', 'jake@example.com'],
    teamRole: 'editor' as const,
  },
  {
    name: 'iOS',
    description: 'Apple platform squad',
    parentName: 'Mobile',
    memberEmails: ['jake@example.com', 'isabella@example.com'],
    teamRole: null,
  },
  {
    name: 'Android',
    description: 'Android platform squad',
    parentName: 'Mobile',
    memberEmails: ['leo@example.com', 'grace@example.com'],
    teamRole: null,
  },
  {
    name: 'Web',
    description: 'Web product team',
    parentName: 'Product',
    memberEmails: ['carol@example.com', 'dave@example.com'],
    teamRole: 'editor' as const,
  },

  // ── Engineering pillar ──
  {
    name: 'Engineering',
    description: 'Core engineering org',
    parentName: null,
    memberEmails: [
      'alice@example.com',
      'bob@example.com',
      'carol@example.com',
      'dave@example.com',
      'eva@example.com',
    ],
    teamRole: 'viewer' as const,
  },
  {
    name: 'Backend',
    description: 'API and services',
    parentName: 'Engineering',
    memberEmails: ['bob@example.com', 'eva@example.com', 'frank@example.com'],
    teamRole: 'operator' as const,
  },
  {
    name: 'Frontend',
    description: 'React / web client',
    parentName: 'Engineering',
    memberEmails: ['carol@example.com', 'dave@example.com'],
    teamRole: 'editor' as const,
  },
  {
    name: 'Platform',
    description: 'Shared infra and developer experience',
    parentName: 'Engineering',
    memberEmails: ['grace@example.com', 'hiro@example.com'],
    teamRole: 'editor' as const,
  },
  {
    name: 'Infrastructure',
    description: 'Cloud, Kubernetes, networking',
    parentName: 'Platform',
    memberEmails: ['hiro@example.com', 'frank@example.com'],
    teamRole: 'owner' as const,
  },

  // ── Business pillar ──
  {
    name: 'Business',
    description: 'Revenue and go-to-market',
    parentName: null,
    memberEmails: ['alice@example.com', 'isabella@example.com', 'jake@example.com'],
    teamRole: 'viewer' as const,
  },
  {
    name: 'Marketing',
    description: 'Growth and campaigns',
    parentName: 'Business',
    memberEmails: ['isabella@example.com', 'karen@example.com'],
    teamRole: 'editor' as const,
  },
  {
    name: 'Sales',
    description: 'Revenue and partnerships',
    parentName: 'Business',
    memberEmails: ['jake@example.com', 'leo@example.com', 'frank@example.com'],
    teamRole: 'operator' as const,
  },
];

// ─── Flows ───────────────────────────────────────────────────

const FLOWS: Array<{
  name: string;
  desc: string;
  scopeName: string | null;
  directGrants?: Array<{ email: string; permission: 'viewer' | 'operator' | 'editor' | 'owner' }>;
}> = [
  // Product
  {
    name: 'Feature Request Tracker',
    desc: 'Aggregates and prioritises incoming feature requests',
    scopeName: 'Product',
    directGrants: [
      { email: 'alice@example.com', permission: 'owner' },
      { email: 'karen@example.com', permission: 'editor' },
    ],
  },
  {
    name: 'A/B Test Runner',
    desc: 'Configures and monitors A/B experiments',
    scopeName: 'Product',
    directGrants: [{ email: 'alice@example.com', permission: 'owner' }],
  },
  {
    name: 'User Feedback Processor',
    desc: 'Ingests NPS surveys and routes feedback',
    scopeName: 'Product',
  },

  // Mobile
  {
    name: 'App Crash Reporter',
    desc: 'Collects crash logs and creates Jira tickets',
    scopeName: 'Mobile',
    directGrants: [
      { email: 'alice@example.com', permission: 'owner' },
      { email: 'jake@example.com', permission: 'editor' },
    ],
  },
  {
    name: 'Push Notification Sender',
    desc: 'Scheduled and triggered push campaigns',
    scopeName: 'Mobile',
  },

  // iOS
  {
    name: 'App Store Review Monitor',
    desc: 'Tracks App Store ratings and surfaces issues',
    scopeName: 'iOS',
    directGrants: [
      { email: 'alice@example.com', permission: 'owner' },
      { email: 'isabella@example.com', permission: 'editor' },
    ],
  },

  // Android
  {
    name: 'Play Store Review Monitor',
    desc: 'Tracks Play Store ratings and surfaces issues',
    scopeName: 'Android',
    directGrants: [
      { email: 'alice@example.com', permission: 'owner' },
      { email: 'grace@example.com', permission: 'editor' },
    ],
  },

  // Web
  {
    name: 'Performance Monitor',
    desc: 'Core Web Vitals tracking and alerting',
    scopeName: 'Web',
    directGrants: [
      { email: 'alice@example.com', permission: 'owner' },
      { email: 'carol@example.com', permission: 'editor' },
    ],
  },
  {
    name: 'SEO Audit Scheduler',
    desc: 'Weekly crawl and SEO health scoring',
    scopeName: 'Web',
  },

  // Engineering
  {
    name: 'Code Review Notifier',
    desc: 'Routes PR reviews to Slack based on ownership',
    scopeName: 'Engineering',
    directGrants: [
      { email: 'alice@example.com', permission: 'owner' },
      { email: 'bob@example.com', permission: 'editor' },
    ],
  },
  {
    name: 'Deploy Rollback Handler',
    desc: 'Automated rollback on health check failure',
    scopeName: 'Engineering',
    directGrants: [
      { email: 'alice@example.com', permission: 'owner' },
      { email: 'eva@example.com', permission: 'operator' },
    ],
  },

  // Backend
  {
    name: 'API Health Check',
    desc: 'Monitors API endpoints and pages on-call',
    scopeName: 'Backend',
    directGrants: [
      { email: 'alice@example.com', permission: 'owner' },
      { email: 'frank@example.com', permission: 'operator' },
    ],
  },
  {
    name: 'Database Migration Runner',
    desc: 'Applies schema migrations with dry-run preview',
    scopeName: 'Backend',
    directGrants: [{ email: 'alice@example.com', permission: 'owner' }],
  },

  // Frontend
  {
    name: 'Component Library Publisher',
    desc: 'Packages and publishes design system to npm',
    scopeName: 'Frontend',
    directGrants: [
      { email: 'alice@example.com', permission: 'owner' },
      { email: 'carol@example.com', permission: 'owner' },
    ],
  },

  // Platform
  {
    name: 'Service Mesh Monitor',
    desc: 'Observes inter-service latency and errors',
    scopeName: 'Platform',
    directGrants: [{ email: 'alice@example.com', permission: 'owner' }],
  },

  // Infrastructure
  {
    name: 'Disaster Recovery Drill',
    desc: 'Scheduled automated DR exercises and reporting',
    scopeName: 'Infrastructure',
    directGrants: [
      { email: 'alice@example.com', permission: 'owner' },
      { email: 'hiro@example.com', permission: 'owner' },
    ],
  },
  {
    name: 'Cost Anomaly Detector',
    desc: 'Detects cloud spend spikes and alerts finance',
    scopeName: 'Infrastructure',
    directGrants: [
      { email: 'alice@example.com', permission: 'owner' },
      { email: 'frank@example.com', permission: 'viewer' },
    ],
  },

  // Business
  {
    name: 'Revenue Report Generator',
    desc: 'Weekly consolidated revenue digest to leadership',
    scopeName: 'Business',
    directGrants: [
      { email: 'alice@example.com', permission: 'owner' },
      { email: 'jake@example.com', permission: 'viewer' },
    ],
  },

  // Marketing
  {
    name: 'Campaign Performance Tracker',
    desc: 'Aggregates ad data and updates dashboards',
    scopeName: 'Marketing',
    directGrants: [
      { email: 'alice@example.com', permission: 'owner' },
      { email: 'isabella@example.com', permission: 'editor' },
    ],
  },
  {
    name: 'Lead Nurturing Sequence',
    desc: 'Automated email sequences for new leads',
    scopeName: 'Marketing',
  },

  // Sales
  {
    name: 'CRM Sync Pipeline',
    desc: 'Bi-directional sync between CRM and data warehouse',
    scopeName: 'Sales',
    directGrants: [
      { email: 'alice@example.com', permission: 'owner' },
      { email: 'leo@example.com', permission: 'editor' },
    ],
  },
  {
    name: 'Quota Tracker',
    desc: 'Real-time rep quota attainment dashboard',
    scopeName: 'Sales',
    directGrants: [{ email: 'alice@example.com', permission: 'owner' }],
  },

  // Unscoped (root level)
  { name: 'Global Alerting Router', desc: 'Cross-team alert fan-out', scopeName: null },
  { name: 'Audit Log Exporter', desc: 'Compliance log export to S3', scopeName: null },
  { name: 'Sandbox Playground', desc: 'Developer testing area', scopeName: null },
];

// ─── Flow definition factory ─────────────────────────────────

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
        params: { template: 'Processing: {{ input }}' },
        position: { x: 400, y: 200 },
      },
    ],
    edges: [{ id: 'e1', source: 'input-1', target: 'template-1' }],
    metadata: { name, description, created: now },
  };
}

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
  const selectUser = db.prepare<[string], { id: string }>(`SELECT id FROM user WHERE email = ?`);

  for (const u of USERS) {
    insertUser.run(randomUUID(), u.name, u.email, u.role, now, now);
    const row = selectUser.get(u.email);
    if (!row) {
      throw new Error(`Failed to resolve user id for ${u.email}`);
    }
    userIds.set(u.email, row.id);
    insertAccount.run(randomUUID(), u.email, row.id, hashedPw, now, now);
    console.log(`  ✓ ${u.name} <${u.email}>`);
  }

  const adminId = userIds.get('alice@example.com')!;

  // ── 2. Clean existing seeded teams ────────────────────────
  console.log('\n🧹 Clearing previously seeded teams…');
  const teamNames = TEAMS.map((t) => t.name);
  const placeholders = teamNames.map(() => '?').join(', ');
  const existingRows = db
    .prepare<string[], { id: string; name: string }>(
      `SELECT id, name FROM flowlib_rbac_teams WHERE name IN (${placeholders})`,
    )
    .all(...teamNames);

  if (existingRows.length > 0) {
    const ids = existingRows.map((r) => r.id);
    const ph = ids.map(() => '?').join(', ');
    db.prepare(`UPDATE flowlib_flows SET scope_id = NULL WHERE scope_id IN (${ph})`).run(...ids);
    db.prepare(`DELETE FROM flowlib_flow_access WHERE team_id IN (${ph})`).run(...ids);
    db.prepare(
      `DELETE FROM flowlib_rbac_scope_access WHERE scope_id IN (${ph}) OR team_id IN (${ph})`,
    ).run(...ids, ...ids);
    db.prepare(`DELETE FROM flowlib_rbac_team_members WHERE team_id IN (${ph})`).run(...ids);
    db.prepare(`DELETE FROM flowlib_rbac_teams WHERE id IN (${ph})`).run(...ids);
    console.log(`  ↺ Removed ${ids.length} stale team rows`);
  }

  // ── 3. Seed teams ──────────────────────────────────────────
  console.log('\n👥 Seeding teams…');

  const teamIds = new Map<string, string>(); // name → id
  for (const t of TEAMS) {
    teamIds.set(t.name, randomUUID());
  }

  const insertTeam = db.prepare(`
    INSERT OR REPLACE INTO flowlib_rbac_teams (id, name, description, parent_id, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertMember = db.prepare(`
    INSERT OR IGNORE INTO flowlib_rbac_team_members (id, team_id, user_id, created_at)
    VALUES (?, ?, ?, ?)
  `);

  for (const t of TEAMS) {
    insertTeam.run(
      teamIds.get(t.name)!,
      t.name,
      t.description,
      t.parentName ? teamIds.get(t.parentName)! : null,
      adminId,
      now,
      now,
    );
    const indent = t.parentName
      ? TEAMS.find((p) => p.name === t.parentName)?.parentName
        ? '      '
        : '    '
      : '  ';
    console.log(`${indent}✓ ${t.name}${t.parentName ? ` (↳ ${t.parentName})` : ''}`);

    for (const email of t.memberEmails) {
      const uid = userIds.get(email);
      if (uid) {
        insertMember.run(randomUUID(), teamIds.get(t.name)!, uid, now);
      }
    }
  }

  db.close();

  // ── 4. Seed flows ──────────────────────────────────────────
  console.log('\n📦 Seeding flows…');

  const flowlib = await createFlowlib({
    encryptionKey: process.env.FLOWLIB_ENCRYPTION_KEY || 'dGVzdC1lbmNyeXB0aW9uLWtleS0xMjM0NTY3ODkw',
    database: {
      type: 'sqlite',
      connectionString: `file:${sqlitePath}`,
    },
    logging: { level: 'warn' },
  });

  const { data: existingFlows } = await flowlib.flows.list();
  const flowNameSet = new Set(FLOWS.map((f) => f.name));
  for (const old of existingFlows.filter((fl) => flowNameSet.has(fl.name))) {
    await flowlib.flows.delete(old.id);
  }

  const createdFlowIds: string[] = [];
  for (const f of FLOWS) {
    const flow = await flowlib.flows.create({ name: f.name, isActive: false });
    await flowlib.versions.create(flow.id, {
      flowlibDefinition: simpleFlow(f.name, f.desc),
    });
    createdFlowIds.push(flow.id);
    console.log(`  ✓ ${f.name}${f.scopeName ? ` [${f.scopeName}]` : ' [unscoped]'}`);
  }

  await flowlib.shutdown();

  // ── 5. Assign scopes + seed access ────────────────────────
  console.log('\n🔒 Seeding access grants…');

  const db2 = new Database(sqlitePath);
  const updateScope = db2.prepare('UPDATE flowlib_flows SET scope_id = ? WHERE id = ?');
  const insertAccess = db2.prepare(`
    INSERT OR IGNORE INTO flowlib_flow_access (id, flow_id, user_id, team_id, permission, granted_by, granted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertScopeAccess = db2.prepare(`
    INSERT OR IGNORE INTO flowlib_rbac_scope_access (id, scope_id, user_id, team_id, permission, granted_by, granted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  // Assign flow → scope
  for (const [index, flowId] of createdFlowIds.entries()) {
    const scopeName = FLOWS[index]?.scopeName ?? null;
    updateScope.run(scopeName ? teamIds.get(scopeName)! : null, flowId);
  }

  // Scope-level team-role grants (inherited by all flows in scope + children)
  for (const t of TEAMS) {
    if (!t.teamRole) {
      continue;
    }
    insertScopeAccess.run(
      randomUUID(),
      teamIds.get(t.name)!,
      null,
      teamIds.get(t.name)!,
      t.teamRole,
      adminId,
      now,
    );
    console.log(`  ✓ ${t.name} team → ${t.teamRole} (base role on all flows in scope)`);
  }

  // Direct flow-level grants
  for (const [index, flowId] of createdFlowIds.entries()) {
    const f = FLOWS[index];
    if (!f?.directGrants?.length) {
      continue;
    }
    for (const g of f.directGrants) {
      const uid = userIds.get(g.email);
      if (!uid) {
        continue;
      }
      insertAccess.run(randomUUID(), flowId, uid, null, g.permission, adminId, now);
    }
    const names = f.directGrants.map((g) => `${g.email.split('@')[0]}(${g.permission})`).join(', ');
    console.log(`  ✓ ${f.name} → ${names}`);
  }

  db2.close();

  // ── Summary ────────────────────────────────────────────────
  console.log('\n🎉 RBAC complex seed complete!');
  console.log(`   ${USERS.length} users  (password: "${PASSWORD}")`);
  console.log(`   ${TEAMS.length} teams  (3 pillars, up to 3 levels deep)`);
  console.log(`   ${FLOWS.length} flows  (19 scoped + 3 unscoped)`);
  console.log(
    `   All users: alice/bob/carol/dave/eva/frank/grace/hiro/isabella/jake/karen/leo @example.com`,
  );
}

main().catch((err) => {
  console.error('💥 Seed failed:', err);
  process.exit(1);
});
