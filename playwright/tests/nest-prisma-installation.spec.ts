/**
 * E2E Test — Invect Installation into an Existing NestJS + Prisma + PostgreSQL App
 *
 * Validates the full installation flow that a developer would follow
 * when adding Invect to their pre-existing NestJS SaaS application:
 *
 *   1. Start with a clean PostgreSQL database (via Docker)
 *   2. Push the app-only Prisma schema (SaaS tables, no Invect)
 *   3. Run `npx flowlib generate --adapter prisma` to merge Invect models
 *   4. Push the updated schema (SaaS + Invect tables)
 *   5. Start the NestJS server
 *   6. Verify Invect API is functional (flow CRUD, credentials, agent tools)
 *
 * Requires Docker to be running.
 */

import { test, expect } from '@playwright/test';
import { execSync, spawn, type ChildProcess, type ExecSyncOptions } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// ─── Paths ───────────────────────────────────────────────────────
const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const EXAMPLE_DIR = path.resolve(REPO_ROOT, 'examples/nest-prisma');
const SCHEMA_FILE = path.join(EXAMPLE_DIR, 'prisma/schema.prisma');

// Docker container name and test database — isolated per test run
const CONTAINER_NAME = `flowlib-pw-nestprisma-${process.pid}`;
const PG_PORT = 5490 + (process.pid % 100); // semi-random port to avoid collisions
const DB_NAME = `invect_test_${Date.now()}`;
const DATABASE_URL = `postgresql://flowlib:flowlib@localhost:${PG_PORT}/${DB_NAME}`;

const NEST_PORT = 4100 + (process.pid % 100);

function isDockerAvailable(): boolean {
  try {
    execSync('docker info', { stdio: 'pipe', timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

test.skip(
  !isDockerAvailable(),
  'Docker is required for the NestJS + Prisma + PostgreSQL installation test.',
);

// ─── Helpers ─────────────────────────────────────────────────────

const execOpts: ExecSyncOptions = {
  cwd: EXAMPLE_DIR,
  timeout: 120_000,
  encoding: 'utf-8' as const,
  stdio: ['pipe', 'pipe', 'pipe'],
};

function run(cmd: string, env?: Record<string, string>): string {
  return execSync(cmd, {
    ...execOpts,
    env: { ...process.env, ...env },
  }) as string;
}

/** Query PostgreSQL for table names in the public schema. */
function getTableNames(): string[] {
  const output = run(
    `docker exec ${CONTAINER_NAME} psql -U flowlib -d ${DB_NAME} -t -A -c "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name"`,
  );
  return output
    .trim()
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

/** Wait for a URL to return a 2xx or 3xx status. */
async function waitForUrl(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status < 500) {
        return true;
      }
    } catch {
      // not ready
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  return false;
}

/** Wait until the Docker postgres container is accepting connections. */
function waitForPostgres(timeoutMs = 30_000): void {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      execSync(`docker exec ${CONTAINER_NAME} pg_isready -U flowlib -d ${DB_NAME}`, {
        stdio: 'pipe',
        timeout: 5_000,
      });
      return;
    } catch {
      execSync('sleep 1', { stdio: 'pipe' });
    }
  }
  throw new Error('PostgreSQL did not become ready in time');
}

// ─── Test Suite ──────────────────────────────────────────────────

test.describe('NestJS + Prisma + PostgreSQL — Invect Installation', () => {
  let serverProcess: ChildProcess | null = null;
  let originalSchema: string;

  test.beforeAll(async () => {
    // Save the original prisma schema so we can restore it
    originalSchema = fs.readFileSync(SCHEMA_FILE, 'utf-8');

    // Start a Docker postgres container
    try {
      execSync(`docker rm -f ${CONTAINER_NAME}`, { stdio: 'pipe' });
    } catch {
      /* container didn't exist */
    }

    execSync(
      `docker run -d --name ${CONTAINER_NAME} ` +
        `-e POSTGRES_USER=flowlib ` +
        `-e POSTGRES_PASSWORD=flowlib ` +
        `-e POSTGRES_DB=${DB_NAME} ` +
        `-p ${PG_PORT}:5432 ` +
        `postgres:16-alpine`,
      { stdio: 'pipe', timeout: 60_000 },
    );

    waitForPostgres();
  });

  test.afterAll(async () => {
    // Kill the NestJS server
    if (serverProcess) {
      serverProcess.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        const t = setTimeout(() => {
          serverProcess?.kill('SIGKILL');
          resolve();
        }, 5_000);
        serverProcess!.on('exit', () => {
          clearTimeout(t);
          resolve();
        });
      });
    }

    // Restore original prisma schema
    fs.writeFileSync(SCHEMA_FILE, originalSchema, 'utf-8');

    // Tear down the Docker container
    try {
      execSync(`docker rm -f ${CONTAINER_NAME}`, { stdio: 'pipe' });
    } catch {
      /* ok */
    }
  });

  // ─── Step 1: Push app-only schema ─────────────────────────────

  test('Step 1: Push SaaS-only schema to PostgreSQL', () => {
    // The prisma schema currently has only SaaS tables (no Invect).
    // Push it to the test database.
    run('npx prisma db push --skip-generate --accept-data-loss', {
      DATABASE_URL,
    });

    // Verify SaaS tables exist
    const tables = getTableNames();
    expect(tables).toContain('organizations');
    expect(tables).toContain('users');
    expect(tables).toContain('members');
    expect(tables).toContain('projects');
    expect(tables).toContain('api_keys');

    // Invect tables should NOT exist yet
    expect(tables).not.toContain('flows');
    expect(tables).not.toContain('flow_versions');
    expect(tables).not.toContain('flow_executions');
    expect(tables).not.toContain('credentials');
  });

  // ─── Step 2: Run flowlib generate ─────────────────────────────

  test('Step 2: Run `npx flowlib generate --adapter prisma` to merge Invect tables', () => {
    const output = run(
      'npx flowlib generate --adapter prisma --config flowlib.config.ts --dialect postgresql --yes',
      { DATABASE_URL },
    );

    // The schema file should now include Invect models
    const schema = fs.readFileSync(SCHEMA_FILE, 'utf-8');

    // Original SaaS models preserved
    expect(schema).toContain('model Organization');
    expect(schema).toContain('model User');
    expect(schema).toContain('model Member');
    expect(schema).toContain('model Project');
    expect(schema).toContain('model ApiKey');

    // Invect core models added
    expect(schema).toContain('flows');
    expect(schema).toContain('flow_versions');
    expect(schema).toContain('flow_executions');
    expect(schema).toContain('credentials');

    // CLI output should confirm generation
    expect(output).toMatch(/Prisma schema (updated|created)/i);
  });

  // ─── Step 3: Push merged schema ───────────────────────────────

  test('Step 3: Push merged schema (SaaS + Invect) to PostgreSQL', () => {
    run('npx prisma db push --skip-generate --accept-data-loss', {
      DATABASE_URL,
    });

    const tables = getTableNames();

    // SaaS tables still present
    expect(tables).toContain('organizations');
    expect(tables).toContain('users');
    expect(tables).toContain('members');
    expect(tables).toContain('projects');
    expect(tables).toContain('api_keys');

    // Invect core tables now present
    expect(tables).toContain('flows');
    expect(tables).toContain('flow_versions');
    expect(tables).toContain('flow_executions');
    expect(tables).toContain('execution_traces'); // TODO: rename to action_traces after migration
    expect(tables).toContain('batch_jobs');
    expect(tables).toContain('credentials');
  });

  // ─── Step 4: Boot NestJS server and verify API ────────────────

  test('Step 4: Start NestJS server and verify Invect API works', async ({ request }) => {
    // Spawn the NestJS server against the test database
    serverProcess = spawn('npx', ['nest', 'start'], {
      cwd: EXAMPLE_DIR,
      env: {
        ...process.env,
        DATABASE_URL,
        PORT: String(NEST_PORT),
        INVECT_BASE_PATH: '/flowlib',
        NODE_ENV: 'development',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const stderr: string[] = [];
    serverProcess.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk.toString()));
    serverProcess.stdout?.on('data', (chunk: Buffer) => {
      const msg = chunk.toString();
      if (msg.includes('running') || msg.includes('Nest') || msg.includes('listen')) {
        // Server started
      }
    });

    const apiBase = `http://localhost:${NEST_PORT}/flowlib`;

    // Wait for server readiness
    const ready = await waitForUrl(`${apiBase}/flows/list`, 60_000);
    expect(ready, `NestJS server did not start.\nstderr: ${stderr.join('').slice(-3000)}`).toBe(
      true,
    );

    // ── Flow CRUD ──────────────────────────────────────────────

    // List flows (empty initially)
    const listRes = await request.get(`${apiBase}/flows/list`);
    expect(listRes.ok()).toBeTruthy();
    const listBody = await listRes.json();
    expect(listBody).toHaveProperty('data');
    expect(Array.isArray(listBody.data)).toBeTruthy();

    // Create a flow
    const createRes = await request.post(`${apiBase}/flows`, {
      data: {
        name: 'NestJS Prisma Test Flow',
        description: 'Created by Playwright E2E test',
      },
    });
    expect(createRes.ok()).toBeTruthy();
    const flow = await createRes.json();
    expect(flow).toHaveProperty('id');
    expect(flow.name).toBe('NestJS Prisma Test Flow');

    // Get flow by ID
    const getRes = await request.get(`${apiBase}/flows/${flow.id}`);
    expect(getRes.ok()).toBeTruthy();
    const fetched = await getRes.json();
    expect(fetched.id).toBe(flow.id);

    // Get react-flow representation
    const rfRes = await request.get(`${apiBase}/flows/${flow.id}/react-flow`);
    expect(rfRes.ok()).toBeTruthy();
    const rfData = await rfRes.json();
    expect(rfData).toHaveProperty('nodes');
    expect(rfData).toHaveProperty('edges');

    // ── Credential CRUD ────────────────────────────────────────

    const createCredRes = await request.post(`${apiBase}/credentials`, {
      data: {
        name: 'Test Credential',
        type: 'http-api',
        authType: 'bearer',
        config: { token: 'test-token-abc' },
        description: 'E2E test credential',
      },
    });
    expect(createCredRes.ok()).toBeTruthy();
    const cred = await createCredRes.json();
    expect(cred).toHaveProperty('id');

    // Get credential
    const getCredRes = await request.get(`${apiBase}/credentials/${cred.id}`);
    expect(getCredRes.ok()).toBeTruthy();

    // ── Agent tools ────────────────────────────────────────────

    const toolsRes = await request.get(`${apiBase}/agent/tools`);
    expect(toolsRes.ok()).toBeTruthy();
    const tools = await toolsRes.json();
    expect(Array.isArray(tools)).toBeTruthy();
    expect(tools.length).toBeGreaterThan(0);

    // ── Cleanup ────────────────────────────────────────────────

    // Delete the test flow
    const delFlowRes = await request.delete(`${apiBase}/flows/${flow.id}`);
    expect(delFlowRes.ok()).toBeTruthy();

    // Delete the test credential
    const delCredRes = await request.delete(`${apiBase}/credentials/${cred.id}`);
    expect(delCredRes.ok()).toBeTruthy();
  });
});
