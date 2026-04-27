import path from 'node:path';

import { defineConfig, devices } from '@playwright/test';

const playwrightArtifactsDir = path.resolve(process.cwd(), 'playwright');
const vitePort = Number.parseInt(process.env.PLAYWRIGHT_VITE_PORT ?? '41731', 10);
const nextjsPort = Number.parseInt(process.env.PLAYWRIGHT_NEXTJS_PORT ?? '43002', 10);
const viteBaseUrl = process.env.PLAYWRIGHT_VITE_URL ?? `http://localhost:${vitePort}`;
const nextjsBaseUrl = process.env.NEXTJS_URL ?? `http://localhost:${nextjsPort}`;

/**
 * Playwright config for Invect cross-platform E2E tests.
 *
 * ALL API tests (Express, NestJS, Next.js) spin up isolated per-worker
 * servers with disposable SQLite databases — no shared state, fully parallel.
 *
 * Browser tests use worker-local isolated backends via shared fixtures.
 * Only the frontend app servers themselves remain shared.
 *
 * Run: pnpm test:pw
 */
export default defineConfig({
  testDir: './tests',
  outputDir: path.join(playwrightArtifactsDir, 'test-results'),

  /* Timeout per test */
  timeout: 60_000,

  /* Enable parallel execution — worker-local DB isolation prevents data conflicts */
  fullyParallel: true,

  /* Shared settings for all projects */
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
  },

  /* Fail the build on CI if test.only is left in source */
  forbidOnly: !!process.env.CI,

  /* Retry once on CI */
  retries: process.env.CI ? 1 : 0,

  /* Reporter */
  reporter: process.env.CI
    ? 'github'
    : [
        [
          'json',
          {
            open: 'never',
            outputFolder: path.join(playwrightArtifactsDir),
            outputFile: 'results.json',
          },
        ],
        [
          'html',
          { open: 'never', outputFolder: path.join(playwrightArtifactsDir, 'playwright-report') },
        ],
      ],

  projects: [
    /* API tests — fully isolated, each worker spawns its own server */
    {
      name: 'api',
      testMatch: /platform\/(express|nestjs|nextjs)-api\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    /* Frontend tests — shared frontend app, isolated backend per worker */
    {
      name: 'frontend',
      testMatch: /platform\/(express|nextjs)-frontend\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: viteBaseUrl,
      },
    },
    /* Other tests (config-panel, credentials, seed, etc.) — shared frontend, isolated backend */
    {
      name: 'e2e',
      testIgnore: [
        /platform\//,
        /examples\//,
        /nest-prisma-installation/,
        /critical-paths\//,
        /visual-audit\//,
      ],
      use: {
        ...devices['Desktop Chrome'],
        baseURL: viteBaseUrl,
      },
    },
    /* Critical-path tests — shared frontend, isolated backend per worker */
    {
      name: 'critical-paths',
      testMatch: /critical-paths\/.*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: viteBaseUrl,
      },
    },
    /* NestJS + Prisma installation test — self-contained (Docker + own server) */
    {
      name: 'nest-prisma',
      testMatch: /nest-prisma-installation\.spec\.ts/,
      timeout: 180_000,
      use: { ...devices['Desktop Chrome'] },
    },
    /* Next.js + Drizzle + Auth + RBAC example installation flow */
    {
      name: 'nextjs-drizzle-auth-rbac',
      testMatch: /examples\/nextjs-drizzle-auth-rbac-.*\.spec\.ts/,
      timeout: 120_000,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:3003',
      },
    },
    /* Visual audit — on-demand screenshot capture for UX analysis */
    {
      name: 'visual-audit',
      testDir: './visual-audit',
      testMatch: /capture\.ts/,
      timeout: 120_000,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: viteBaseUrl,
        screenshot: 'off',
        video: 'off',
        trace: 'off',
      },
    },
  ],

  /*
   * Shared frontend app servers only.
   * All Playwright backend data access uses per-worker isolated servers/DBs.
   */
  webServer: [
    {
      command: `pnpm --filter flow-executor exec vite --force --host localhost --port ${vitePort}`,
      url: viteBaseUrl,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: `pnpm --filter flowlib-nextjs-example exec next dev --hostname localhost -p ${nextjsPort}`,
      url: nextjsBaseUrl,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
