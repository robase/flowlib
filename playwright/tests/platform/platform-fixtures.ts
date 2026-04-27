/**
 * Playwright fixtures for parallelisable platform API tests.
 *
 * Each Playwright worker gets its own Invect server backed by a
 * disposable SQLite database. This allows all API test files to run
 * fully in parallel without port or data conflicts.
 *
 * Three server variants are available:
 *   - expressTest   → tests/platform/test-server.ts         (Express adapter)
 *   - nestjsTest    → tests/platform/test-server-nestjs.ts  (NestJS adapter)
 *   - nextjsTest    → tests/platform/test-server-nextjs.ts  (Next.js adapter)
 *
 * Usage in spec files:
 *
 *   import { expressTest, expect } from "./platform-fixtures";
 *   expressTest("my test", async ({ isolatedServer }) => {
 *     const res = await fetch(`${isolatedServer.apiBase}/flows/list`);
 *   });
 */
import { test as base, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSqliteIsolatedServer, type ServerFixture } from '../../test-support/sqlite-isolation';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export { expect };

/** Exposed to every test in the worker. */
interface ServerOptions {
  /** Script path relative to tests/platform/ */
  script: string;
  /** DB file prefix used in os.tmpdir() */
  dbFilePrefix: string;
  /** Path prefix where the Invect API is mounted (e.g. "/flowlib") */
  apiPrefix: string;
  /** Readiness probe path (must return 200 when ready) */
  readyPath: string;
}

async function spawnIsolatedServer(
  opts: ServerOptions,
  workerInfo: { workerIndex: number },
): Promise<{ fixture: ServerFixture; cleanup: () => Promise<void> }> {
  const serverScript = path.resolve(__dirname, opts.script);
  return spawnSqliteIsolatedServer(
    {
      apiPrefix: opts.apiPrefix,
      dbFilePrefix: opts.dbFilePrefix,
      readyPath: opts.readyPath,
      serverCwd: path.resolve(__dirname, '../../'),
      serverScript,
    },
    workerInfo.workerIndex,
  );
}

// ── Fixture factories ────────────────────────────────────────────────────

function createServerTest(opts: ServerOptions) {
  return base.extend<{}, { isolatedServer: ServerFixture }>({
    // eslint-disable-next-line no-empty-pattern
    isolatedServer: [
      async ({}, use, workerInfo) => {
        const { fixture, cleanup } = await spawnIsolatedServer(opts, workerInfo);
        await use(fixture);
        await cleanup();
      },
      { scope: 'worker' },
    ],
  });
}

/** Express adapter tests — each worker gets its own Express server */
export const expressTest = createServerTest({
  script: 'test-server.ts',
  dbFilePrefix: 'flowlib-pw-express',
  apiPrefix: '/flowlib',
  readyPath: '/flowlib/flows/list',
});

/** NestJS adapter tests — each worker gets its own NestJS server */
export const nestjsTest = createServerTest({
  script: 'test-server-nestjs.ts',
  dbFilePrefix: 'flowlib-pw-nestjs',
  apiPrefix: '/flowlib',
  readyPath: '/flowlib/flows/list',
});

/** Next.js adapter tests — each worker gets its own lightweight handler server */
export const nextjsTest = createServerTest({
  script: 'test-server-nextjs.ts',
  dbFilePrefix: 'flowlib-pw-nextjs',
  apiPrefix: '/api/flowlib',
  readyPath: '/api/flowlib/credentials',
});

/** Backward compat: default export is the Express test */
export const test = expressTest;
