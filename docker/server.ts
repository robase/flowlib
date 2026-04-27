import express from 'express';
import type { ErrorRequestHandler } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createInvectRouter } from '@flowlib/express';
import { auth } from '@flowlib/user-auth';
import { rbac } from '@flowlib/rbac';
import { webhooks } from '@flowlib/webhooks';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const port = parseInt(process.env.PORT || '3000', 10);
const staticDir = process.env.STATIC_DIR || '/app/frontend';

// --- Database ---
const dbType = (process.env.INVECT_DB_TYPE as 'sqlite' | 'postgres' | 'mysql') || 'sqlite';
const dbConnectionString = process.env.DATABASE_URL || 'file:./data/flowlib.db';

// --- Encryption key (required) ---
const encryptionKey = process.env.INVECT_ENCRYPTION_KEY;
if (!encryptionKey) {
  console.error(
    'FATAL: INVECT_ENCRYPTION_KEY is required. Generate one with: npx flowlib-cli secret',
  );
  process.exit(1);
}

// --- Auth ---
const adminEmail = process.env.INVECT_ADMIN_EMAIL || 'admin@flowlib.local';
const adminPassword = process.env.INVECT_ADMIN_PASSWORD || 'changeme';

// --- Webhooks ---
const webhookBaseUrl = process.env.INVECT_WEBHOOK_BASE_URL || `http://localhost:${port}/flowlib`;

// --- Trusted Origins (comma-separated) ---
const trustedOrigins = process.env.INVECT_TRUSTED_ORIGINS
  ? process.env.INVECT_TRUSTED_ORIGINS.split(',').map((o) => o.trim())
  : [`http://localhost:${port}`];

// --- Logging ---
const logLevel = (process.env.INVECT_LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error') || 'info';

// --- Plugins ---
const plugins = [
  auth({
    trustedOrigins,
    betterAuthOptions: {
      secret: encryptionKey,
    },
    globalAdmins: [
      {
        email: adminEmail,
        pw: adminPassword,
        name: 'Admin',
      },
    ],
  }),
  rbac(),
  webhooks({ webhookBaseUrl }),
];

// --- Body parsing ---
app.use(express.json());

// --- Mount Invect API ---
const invectRouter = await createInvectRouter({
  encryptionKey,
  database: {
    id: 'flowlib-docker',
    type: dbType,
    connectionString: dbConnectionString,
  },
  logging: {
    level: logLevel,
  },
  plugins,
});

// --- Health check (before other routes) ---
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// --- Mount Invect API ---
app.use('/flowlib', invectRouter);

// --- Serve static frontend ---
app.use(express.static(staticDir));

// --- SPA fallback (all non-API routes serve index.html) ---
app.get('*', (req, res) => {
  res.sendFile(path.join(staticDir, 'index.html'));
});

// --- Error handler ---
const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  console.error('Unhandled error:', error);
  if (res.headersSent) {
    return next(error);
  }
  res.status(500).json({ error: 'Internal Server Error' });
};
app.use(errorHandler);

// --- Start ---
app.listen(port, '0.0.0.0', () => {
  console.log(`Invect server running on http://0.0.0.0:${port}`);
  console.log(`  Database: ${dbType} (${dbConnectionString})`);
  console.log(`  Admin: ${adminEmail}`);
  console.log(`  Static: ${staticDir}`);
});

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
