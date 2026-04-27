/**
 * Minimal Express + Invect server for E2E test isolation.
 *
 * Usage:  tsx tests/platform/test-server.ts
 *
 * Reads from env:
 *   PORT             — port to listen on (0 = random free port)
 *   TEST_DB_PATH     — path to SQLite file (each worker gets its own)
 *
 * Prints the assigned port to stdout as "LISTENING:<port>" so the
 * fixture can parse it.
 *
 * Runs Drizzle migrations on the fresh SQLite file before booting
 * Invect so that all tables exist.
 */
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { createInvectRouter } from '../../../pkg/express/dist/index.js';
import { webhooks } from '../../../pkg/plugins/webhooks/src/backend/index.ts';
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
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS invect_webhook_triggers (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    webhook_path TEXT NOT NULL UNIQUE,
    provider TEXT NOT NULL DEFAULT 'generic',
    is_enabled INTEGER NOT NULL DEFAULT 1,
    allowed_methods TEXT NOT NULL DEFAULT 'POST',
    hmac_enabled INTEGER NOT NULL DEFAULT 0,
    hmac_header_name TEXT,
    hmac_secret TEXT,
    allowed_ips TEXT,
    flow_id TEXT,
    node_id TEXT,
    last_triggered_at TEXT,
    last_payload TEXT,
    trigger_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (flow_id) REFERENCES invect_flows(id) ON DELETE NO ACTION
  );
`);
sqlite.close();

// ── 2. Boot Express + Invect ─────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());

// Log initialization errors to stderr so the fixture can see them
process.on('unhandledRejection', (err) => {
  process.stderr.write(`Unhandled rejection: ${err}\n`);
});

app.use(
  '/flowlib',
  await createInvectRouter({
    encryptionKey: 'dGVzdC1lbmNyeXB0aW9uLWtleS0xMjM0NTY3ODkw',
    database: {
      type: 'sqlite',
      connectionString: `file:${dbPath}`,
    },
    logging: { level: 'warn' },
    plugins: [webhooks()],
  }),
);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

const server = app.listen(port, () => {
  const addr = server.address();
  const assignedPort = typeof addr === 'object' && addr ? addr.port : port;
  // Signal to parent process that we're ready
  process.stdout.write(`LISTENING:${assignedPort}\n`);
});

process.on('SIGINT', () => {
  stopExternalApiMocks();
  process.exit(0);
});

process.on('SIGTERM', () => {
  stopExternalApiMocks();
  process.exit(0);
});
