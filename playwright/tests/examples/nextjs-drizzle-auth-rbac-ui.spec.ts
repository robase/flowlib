import { test, expect, type Browser, type Page } from '@playwright/test';
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const EXAMPLE_DIR = path.resolve(REPO_ROOT, 'examples/nextjs-drizzle-auth-rbac');
const DRIZZLE_KIT_BIN = path.join(EXAMPLE_DIR, 'node_modules', 'drizzle-kit', 'bin.cjs');
const NEXT_BIN = path.join(EXAMPLE_DIR, 'node_modules', 'next', 'dist', 'bin', 'next');
const TSX_BIN = path.join(EXAMPLE_DIR, 'node_modules', 'tsx', 'dist', 'cli.mjs');

const ADMIN_EMAIL = 'admin@acme.com';
const ADMIN_PASSWORD = 'admin1234';
const PG_USER = 'acme';
const PG_PASSWORD = 'acme';
const PG_DB = 'acme_dashboard';

const exampleEnvBase = {
  BETTER_AUTH_SECRET: 'playwright-nextjs-auth-rbac-secret-1234567890',
  INVECT_ADMIN_EMAIL: ADMIN_EMAIL,
  INVECT_ADMIN_PASSWORD: ADMIN_PASSWORD,
};

let appPort = 3003;
let appOrigin = `http://127.0.0.1:${appPort}`;
let workflowsBase = `${appOrigin}/dashboard/workflows`;
let apiBase = `${appOrigin}/api/flowlib`;

let containerName = '';
let databaseUrl = '';
let serverProcess: ChildProcess | null = null;
let serverLogs = '';

let createdUser: {
  email: string;
  id: string;
  name: string;
  password: string;
} | null = null;
let sharedFlow: {
  id: string;
  name: string;
} | null = null;

function exampleEnv(overrides: Record<string, string> = {}) {
  return {
    ...process.env,
    ...exampleEnvBase,
    DATABASE_URL: databaseUrl,
    BETTER_AUTH_URL: appOrigin,
    NEXT_PUBLIC_APP_URL: appOrigin,
    PORT: String(appPort),
    ...overrides,
  };
}

function setRuntimeUrls(port: number) {
  appPort = port;
  appOrigin = `http://127.0.0.1:${port}`;
  workflowsBase = `${appOrigin}/dashboard/workflows`;
  apiBase = `${appOrigin}/api/flowlib`;
}

async function getFreePort() {
  const server = createServer();

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Failed to allocate a free port for the auth/RBAC example test server.');
  }

  const port = address.port;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  return port;
}

async function startPostgresContainer(): Promise<{ containerName: string; port: number }> {
  const name = `flowlib-pw-pg-${Date.now()}`;
  const pgPort = await getFreePort();

  execSync(
    `docker run -d --name ${name} ` +
      `-e POSTGRES_USER=${PG_USER} ` +
      `-e POSTGRES_PASSWORD=${PG_PASSWORD} ` +
      `-e POSTGRES_DB=${PG_DB} ` +
      `-p ${pgPort}:5432 ` +
      `postgres:16-alpine`,
    { stdio: 'pipe' },
  );

  // Wait for PostgreSQL to be ready
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      execSync(`docker exec ${name} pg_isready -U ${PG_USER} -d ${PG_DB}`, { stdio: 'pipe' });
      return { containerName: name, port: pgPort };
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  throw new Error(`Timed out waiting for PostgreSQL container ${name} to be ready.`);
}

function stopPostgresContainer(name: string) {
  if (!name) {
    return;
  }
  try {
    execSync(`docker rm -f ${name}`, { stdio: 'pipe' });
  } catch {
    // Container may already be stopped/removed.
  }
}

async function runNodeScript(scriptPath: string, args: string[], env: NodeJS.ProcessEnv) {
  const logs: string[] = [];

  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: EXAMPLE_DIR,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout?.on('data', (chunk: Buffer) => {
      logs.push(chunk.toString());
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      logs.push(chunk.toString());
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `Command failed: ${path.basename(scriptPath)} ${args.join(' ')}\n${logs.join('').slice(-4000)}`,
        ),
      );
    });
  });
}

async function waitForUrl(url: string, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = 0;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: 'manual' });
      lastStatus = response.status;
      if (response.ok || (response.status >= 300 && response.status < 500)) {
        return;
      }
    } catch {
      // Server not ready yet.
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(
    `Timed out waiting for ${url} (last status: ${lastStatus}).\nLogs:\n${serverLogs.slice(-4000)}`,
  );
}

async function gotoSignIn(page: Page) {
  await page.goto(workflowsBase);
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByRole('button', { name: 'Login' })).toBeVisible();
}

async function waitForInvectDashboard(page: Page) {
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('Loading flows'))
    .not.toBeVisible({ timeout: 30_000 })
    .catch(() => {});
}

async function login(page: Page, email: string, password: string) {
  await gotoSignIn(page);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Login' }).click();
  await waitForInvectDashboard(page);
}

async function createBrowserContextAndLogin(
  browser: Browser,
  credentials: { email: string; password: string },
) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, credentials.email, credentials.password);
  return { context, page };
}

function uniqueValue(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function fetchUserId(page: Page, email: string) {
  const response = await page.context().request.get(`${apiBase}/plugins/auth/users?limit=200`);
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { users: Array<{ email: string; id: string }> };
  const user = body.users.find((entry) => entry.email === email);
  expect(user).toBeTruthy();
  return user!.id;
}

async function createFlow(page: Page, name: string) {
  const createResponse = await page.context().request.post(`${apiBase}/flows`, {
    data: { name },
  });
  expect(createResponse.ok()).toBeTruthy();

  const flow = (await createResponse.json()) as { id: string; name: string };
  const versionResponse = await page
    .context()
    .request.post(`${apiBase}/flows/${flow.id}/versions`, {
      data: {
        invectDefinition: {
          nodes: [
            {
              id: 'input-1',
              type: 'core.input',
              label: 'Seed Input',
              referenceId: 'seed_input',
              params: { variableName: 'seed_input', defaultValue: '"hello"' },
              position: { x: 100, y: 150 },
            },
          ],
          edges: [],
        },
      },
    });
  expect(versionResponse.ok()).toBeTruthy();

  return flow;
}

test.describe('Next.js auth + RBAC example UI', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    setRuntimeUrls(await getFreePort());

    const pg = await startPostgresContainer();
    containerName = pg.containerName;
    databaseUrl = `postgresql://${PG_USER}:${PG_PASSWORD}@127.0.0.1:${pg.port}/${PG_DB}`;

    await runNodeScript(
      DRIZZLE_KIT_BIN,
      ['push', '--config=drizzle.config.ts', '--force'],
      exampleEnv(),
    );
    await runNodeScript(TSX_BIN, ['db/seed.ts'], exampleEnv());

    serverProcess = spawn(process.execPath, [NEXT_BIN, 'dev', '-p', String(appPort)], {
      cwd: EXAMPLE_DIR,
      env: exampleEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    serverProcess.stdout?.on('data', (chunk: Buffer) => {
      serverLogs += chunk.toString();
    });
    serverProcess.stderr?.on('data', (chunk: Buffer) => {
      serverLogs += chunk.toString();
    });

    await waitForUrl(workflowsBase);
  });

  test.afterAll(async () => {
    if (serverProcess) {
      serverProcess.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          serverProcess?.kill('SIGKILL');
          resolve();
        }, 5_000);
        serverProcess?.on('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    }

    stopPostgresContainer(containerName);
  });

  test('sign-in validates, profile renders, and sign-out returns to the auth gate', async ({
    page,
  }) => {
    await gotoSignIn(page);

    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);

    await page.goto(`${workflowsBase}/profile`);
    await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(ADMIN_EMAIL)).toBeVisible();

    await page.getByRole('button', { name: 'Sign Out' }).click();
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible({
      timeout: 30_000,
    });
  });

  test('admin can create a non-admin user from User Management', async ({ page }) => {
    const name = uniqueValue('Playwright Viewer');
    const email = `${uniqueValue('viewer')}@acme.test`;
    const password = 'viewer-pass-123';

    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto(`${workflowsBase}/users`);

    await expect(page.getByRole('heading', { name: 'User Management' })).toBeVisible({
      timeout: 30_000,
    });

    await page.getByRole('button', { name: 'Create User' }).click();
    const form = page.locator('form').filter({ hasText: 'Create New User' });

    await form.getByRole('button', { name: 'Create User' }).click();
    await expect(form.getByText('Email and password are required')).toBeVisible();

    await form.locator('input[placeholder="User name"]').fill(name);
    await form.locator('select').first().selectOption('viewer');
    await form.locator('input[placeholder="user@example.com"]').fill(email);
    await form.locator('input[placeholder="Min 8 characters"]').fill(password);
    await form.getByRole('button', { name: 'Create User' }).click();

    await expect(page.getByText(email)).toBeVisible({ timeout: 30_000 });

    const search = page.getByPlaceholder('Search users...');
    await search.fill(email);
    await expect(page.getByText(email)).toBeVisible();

    createdUser = {
      email,
      id: await fetchUserId(page, email),
      name,
      password,
    };
  });

  test('non-admin users see the admin-only warning on the users route', async ({ browser }) => {
    expect(createdUser).not.toBeNull();

    const { context, page } = await createBrowserContextAndLogin(browser, {
      email: createdUser!.email,
      password: createdUser!.password,
    });

    try {
      await page.goto(`${workflowsBase}/users`);
      await expect(page.getByRole('heading', { name: 'User Management' })).toBeVisible({
        timeout: 30_000,
      });
      await expect(
        page.getByText('Only administrators can manage users. Contact an admin for access.'),
      ).toBeVisible();
      await expect(page.getByRole('button', { name: 'Create User' })).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test('admin can create a team and add a member from Access Control', async ({ page }) => {
    expect(createdUser).not.toBeNull();
    const teamName = uniqueValue('Playwright Team');

    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto(`${workflowsBase}/access`);

    await expect(page.getByRole('heading', { name: 'Access Control' })).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole('button', { name: /New Team/i }).click();
    await page.getByPlaceholder('Team name').fill(teamName);
    await page.getByRole('button', { name: 'Create' }).click();

    await expect(page.getByText(teamName)).toBeVisible({ timeout: 30_000 });

    const treeSearch = page.getByPlaceholder('Search teams & flows…');
    await treeSearch.fill(teamName);
    await page.getByText(teamName).click();
    await expect(page.getByRole('heading', { name: teamName })).toBeVisible({ timeout: 30_000 });

    await page.getByRole('button', { name: /Add Member/i }).click();
    await page.getByPlaceholder('Search users…').fill(createdUser!.email);
    await page.getByRole('button', { name: createdUser!.name }).click();
    await page.getByRole('button', { name: 'Add' }).click();

    await expect(page.getByText(createdUser!.name)).toBeVisible({ timeout: 30_000 });
  });

  test('admin can share a flow and non-owners do not see the Share action', async ({
    browser,
    page,
  }) => {
    expect(createdUser).not.toBeNull();

    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);

    sharedFlow = await createFlow(page, uniqueValue('Shared Flow'));
    await page.goto(`${workflowsBase}/flow/${sharedFlow.id}`);

    const shareButton = page.getByRole('button', { name: 'Share' });
    await expect(shareButton).toBeVisible({ timeout: 60_000 });
    await shareButton.click();

    await expect(page.getByRole('heading', { name: 'Share Flow' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText('No flow-specific access records yet.')).toBeVisible();

    await page.locator('input[placeholder="User ID"]').fill(createdUser!.id);
    await page.locator('select').nth(1).selectOption('viewer');
    await page.getByRole('button', { name: 'Share' }).last().click();
    await expect(page.getByText(createdUser!.id)).toBeVisible({ timeout: 30_000 });

    const viewerContext = await browser.newContext();
    const viewerPage = await viewerContext.newPage();

    try {
      await login(viewerPage, createdUser!.email, createdUser!.password);
      await viewerPage.goto(`${workflowsBase}/flow/${sharedFlow.id}`);
      await expect(viewerPage).toHaveURL(new RegExp(`/dashboard/workflows/flow/${sharedFlow.id}$`));
      await expect(viewerPage.getByRole('button', { name: 'Share' })).toHaveCount(0);
    } finally {
      await viewerContext.close();
    }
  });
});
