/**
 * Isolated test fixtures for critical-path E2E tests.
 *
 * Each Playwright WORKER gets its own disposable SQLite database + Express
 * server (same pattern as the platform API tests). The browser still loads
 * the Vite frontend at the shared Playwright frontend origin, but all API calls the browser makes
 * are intercepted via page.route() and forwarded to the worker-local server.
 *
 * Key design:
 *  - `isolatedServer` and `apiBase` are WORKER-scoped → accessible in beforeAll
 *  - `_routeInterception` is test-scoped with auto=true → routes every page
 *  - Other helpers (navigateToFlow etc.) are test-scoped
 *
 * Usage in spec files:
 *
 *   import { test, expect } from "./fixtures";
 *
 *   test.beforeAll(async ({ apiBase, request }) => {
 *     await request.post(`${apiBase}/flows`, { data: { name: "My Flow" } });
 *   });
 *
 *   test("...", async ({ page, apiBase, navigateToFlow }) => {
 *     await navigateToFlow("My Flow");
 *   });
 */

import { expect, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  createSqliteBrowserIsolationTest,
  type BrowserIsolationWorkerFixtures,
} from '../../test-support/sqlite-isolation';

export { expect };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const VITE_BASE = process.env.PLAYWRIGHT_VITE_URL ?? 'http://localhost:41731';
const rootDir = path.resolve(__dirname, '../../..');
const serverCwd = path.join(rootDir, 'playwright');
const serverScript = path.join(serverCwd, 'test-support/express-test-server.ts');
const isolatedBrowserBase = createSqliteBrowserIsolationTest({
  apiPrefix: '/flowlib',
  apiRoutePrefix: '/api/flowlib',
  dbFilePrefix: 'flowlib-cp',
  readyPath: '/flowlib/credentials',
  serverCwd,
  serverScript,
  sharedOrigin: VITE_BASE,
});

// ---------------------------------------------------------------------------
// Fixture type declarations
// ---------------------------------------------------------------------------

type TestFixtures = {
  /** Auto route-interception — runs for every test, no explicit use needed */
  _routeInterception: void;
  /** Mock auth session so tests bypass the sign-in gate */
  _authMock: void;
  /** Navigate to a named flow in the isolated worker's DB */
  navigateToFlow: (flowName: string) => Promise<void>;
  openNodeConfigPanel: (nodeName: string) => Promise<void>;
  closeConfigPanel: () => Promise<void>;
  getInputPanelText: () => Promise<string>;
  getOutputPanelText: () => Promise<string>;
};

type WorkerFixtures = {
  /** Short-hand: e.g. "http://127.0.0.1:54321/flowlib" — usable in beforeAll */
  apiBase: string;
} & BrowserIsolationWorkerFixtures;

// ---------------------------------------------------------------------------
// Extended test
// ---------------------------------------------------------------------------

export const test = isolatedBrowserBase.extend<TestFixtures, WorkerFixtures>({
  // ── Test fixtures ────────────────────────────────────────────────────────

  _authMock: [
    async ({ page }, use) => {
      await page.route('**/plugins/auth/api/auth/get-session', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            user: { id: 'test-user', email: 'admin@test.com', name: 'Test User', role: 'admin' },
            session: { id: 'test-session' },
          }),
        });
      });
      await use();
    },
    { auto: true },
  ],

  navigateToFlow: async ({ page }, use) => {
    await use(async (flowName: string) => {
      await page.goto(`${VITE_BASE}/flowlib`);
      await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({
        timeout: 15_000,
      });
      await page
        .getByText('Loading flows')
        .waitFor({ state: 'hidden', timeout: 10_000 })
        .catch(() => {});
      const card = page.locator('.bg-card').filter({
        has: page.getByRole('heading', { level: 3, name: flowName, exact: true }),
      });
      await expect(card).toBeVisible({ timeout: 10_000 });
      await card.click();
      await expect(page.locator('.react-flow')).toBeVisible({ timeout: 15_000 });
    });
  },

  openNodeConfigPanel: async ({ page }, use) => {
    await use(async (nodeName: string) => {
      const node = page.locator('.react-flow__node').filter({ hasText: nodeName });
      await expect(node).toBeVisible({ timeout: 10_000 });
      await node.dblclick();
      await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });
    });
  },

  closeConfigPanel: async ({ page }, use) => {
    await use(async () => {
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5_000 });
    });
  },

  getInputPanelText: async ({ page }, use) => {
    await use(async () =>
      page.getByRole('dialog').locator('.cm-editor').first().locator('.cm-content').innerText(),
    );
  },

  getOutputPanelText: async ({ page }, use) => {
    await use(async () =>
      page.getByRole('dialog').locator('.cm-editor').last().locator('.cm-content').innerText(),
    );
  },
});
