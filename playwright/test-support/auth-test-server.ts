/**
 * Playwright test server — Express + Flowlib with the auth + rbac plugins
 * (and apiKey enabled). Mirrors the express-test-server.ts pattern, but adds
 * the auth surface so the auth-flows specs can drive sign-in / profile /
 * api-keys / sessions UI against a real, isolated backend.
 *
 * Per Playwright worker:
 *   - Disposable SQLite database (TEST_DB_PATH)
 *   - Express server on PORT (0 = random free port — actual port emitted as
 *     "LISTENING:<port>" on stdout)
 *
 * Required env:
 *   ADMIN_EMAIL       — seeded global admin email (used by tests to sign in)
 *   ADMIN_PASSWORD    — seeded global admin password
 *   TRUSTED_ORIGIN    — origin the shared Vite frontend is served from
 *                       (added to better-auth's trustedOrigins so requests
 *                       routed through the browser are accepted)
 */
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { createFlowlibRouter } from '../../pkg/express/dist/index.js';
import { auth } from '../../pkg/plugins/auth/src/backend/index.ts';
import { rbac } from '../../pkg/plugins/rbac/src/backend/index.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const port = parseInt(process.env.PORT || '0', 10);
const dbPath = process.env.TEST_DB_PATH || ':memory:';
const adminEmail = process.env.ADMIN_EMAIL ?? 'admin@auth-test.local';
const adminPassword = process.env.ADMIN_PASSWORD ?? 'admin1234';
const trustedOrigin = process.env.TRUSTED_ORIGIN ?? 'http://localhost:41731';

// ── 1. Run migrations on the fresh SQLite file ────────────────────────────
// The express-drizzle example ships SQLite migrations that already include
// every flowlib_* table (core + auth + apikey + rbac + webhooks + 2fa + …),
// so a single migrate() pass is enough to satisfy the auth/rbac startup
// table existence checks.
const sqlite = new Database(dbPath === ':memory:' ? ':memory:' : dbPath);
sqlite.pragma('journal_mode = WAL');
const db = drizzle(sqlite);

const migrationsFolder = path.resolve(__dirname, '../../examples/express-drizzle/drizzle');
await migrate(db, { migrationsFolder });
sqlite.close();

// ── 2. Boot Express + Flowlib (auth + rbac, apiKey enabled) ───────────────
const app = express();
app.use(
  cors({
    origin: trustedOrigin,
    credentials: true,
  }),
);
app.use(express.json());

process.on('unhandledRejection', (err) => {
  process.stderr.write(`Unhandled rejection: ${err}\n`);
});

app.use(
  '/flowlib',
  await createFlowlibRouter({
    encryptionKey: 'dGVzdC1lbmNyeXB0aW9uLWtleS0xMjM0NTY3ODkw',
    database: {
      type: 'sqlite',
      connectionString: `file:${dbPath}`,
    },
    logging: { level: 'warn' },
    plugins: [
      auth({
        trustedOrigins: [trustedOrigin],
        betterAuthOptions: {
          secret: 'playwright-auth-test-secret-1234567890',
        },
        apiKey: true,
        // The auth plugin's onRequest hook short-circuits with 401 for any
        // path not in publicPaths (and not on the better-auth proxy). The
        // sign-in shell needs `/auth/public-config` to know whether sign-up
        // is enabled — without this it falls back to the sign-in page even
        // for `/sign-up` routes. Path matched here is the request path inside
        // the Flowlib router (mounted at `/flowlib`), e.g. `/plugins/auth/...`.
        publicPaths: ['/plugins/auth/public-config'],
        globalAdmins: [{ email: adminEmail, pw: adminPassword, name: 'Admin' }],
      }),
      rbac(),
    ],
  }),
);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

const server = app.listen(port, () => {
  const addr = server.address();
  const assignedPort = typeof addr === 'object' && addr ? addr.port : port;
  process.stdout.write(`LISTENING:${assignedPort}\n`);
});

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
