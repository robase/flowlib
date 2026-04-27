/**
 * Standalone NestJS + Invect server for E2E test isolation.
 *
 * Usage:  tsx tests/platform/test-server-nestjs.ts
 *
 * Reads from env:
 *   PORT             — port to listen on (0 = random free port)
 *   TEST_DB_PATH     — path to SQLite file (each worker gets its own)
 *
 * Prints the assigned port to stdout as "LISTENING:<port>" so the
 * fixture can parse it.
 */
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { InvectModule } from '../../../pkg/nestjs/dist/index.js';
import {
  startExternalApiMocks,
  stopExternalApiMocks,
} from '../../test-support/mock-external-apis.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const port = parseInt(process.env.PORT || '0', 10);
const dbPath = process.env.TEST_DB_PATH || ':memory:';

startExternalApiMocks();

// ── 1. Run Drizzle migrations on the fresh SQLite file ────────────────
const sqlite = new Database(dbPath === ':memory:' ? ':memory:' : dbPath);
sqlite.pragma('journal_mode = WAL');
const db = drizzle(sqlite);

const migrationsFolder = path.resolve(__dirname, '../../../pkg/core/drizzle/sqlite');
await migrate(db, { migrationsFolder });
sqlite.close();

// ── 2. Build a minimal NestJS app with InvectModule ──────────────────
@Module({
  imports: [
    InvectModule.forRoot({
      encryptionKey: 'dGVzdC1lbmNyeXB0aW9uLWtleS0xMjM0NTY3ODkw',
      database: {
        type: 'sqlite',
        connectionString: `file:${dbPath}`,
      },
      execution: {
        defaultTimeout: 60_000,
        maxConcurrentExecutions: 10,
        enableTracing: true,
        flowTimeoutMs: 600_000,
        heartbeatIntervalMs: 30_000,
        staleRunCheckIntervalMs: 60_000,
      },
      logging: { level: 'warn' },
    }),
  ],
})
class TestAppModule {}

process.on('unhandledRejection', (err) => {
  process.stderr.write(`Unhandled rejection: ${err}\n`);
});

process.on('SIGINT', () => {
  stopExternalApiMocks();
  process.exit(0);
});

process.on('SIGTERM', () => {
  stopExternalApiMocks();
  process.exit(0);
});

async function bootstrap() {
  const app = await NestFactory.create(TestAppModule, { logger: false });
  app.enableCors();
  app.setGlobalPrefix('flowlib');

  await app.listen(port);
  const url = await app.getUrl();
  const assignedPort = new URL(url).port;

  process.stdout.write(`LISTENING:${assignedPort}\n`);
}

void bootstrap();
