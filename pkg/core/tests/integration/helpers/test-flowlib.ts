/**
 * Shared test helper for integration tests.
 *
 * Creates a fully-wired Flowlib instance backed by an in-memory SQLite
 * database. Every call returns a fresh, isolated instance — no shared
 * state between tests.
 */
import { randomBytes } from 'crypto';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { createFlowlib } from '../../../src/api/create-flowlib';
import type { FlowlibInstance } from '../../../src/api/types';
import type { FlowlibPlugin } from '../../../src/types/plugin.types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Drizzle SQLite migrations live here relative to pkg/core */
const MIGRATIONS_FOLDER = resolve(__dirname, '../../../drizzle/sqlite');

/**
 * Create a fully initialized Flowlib instance for integration testing.
 *
 * Uses a temporary on-disk SQLite file per instance so that Drizzle
 * migrations can run before Flowlib starts. The helper returns both the
 * Flowlib instance and a cleanup function that removes the temp file.
 */
export async function createTestFlowlib(opts?: {
  plugins?: FlowlibPlugin[];
}): Promise<FlowlibInstance> {
  // Set encryption key for credential tests
  process.env.FLOWLIB_ENCRYPTION_KEY = randomBytes(32).toString('base64');

  // Create a temporary SQLite file for this test instance
  const tmpDir = mkdtempSync(join(tmpdir(), 'flowlib-test-'));
  const dbPath = join(tmpDir, 'test.db');

  // Run Drizzle migrations to create all tables
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  sqlite.close();

  const flowlib = await createFlowlib({
    encryptionKey: 'dGVzdC1lbmNyeXB0aW9uLWtleS0xMjM0NTY3ODkw',
    database: {
      type: 'sqlite',
      connectionString: `file:${dbPath}`,
    },
    logging: {
      level: 'warn',
    },
    plugins: (opts?.plugins ?? []).map((p) => ({ id: p.id, backend: p })),
  });

  // Attach cleanup to shutdown so temp files are removed
  const originalShutdown = flowlib.shutdown.bind(flowlib);
  flowlib.shutdown = async () => {
    await originalShutdown();
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  };

  return flowlib;
}
