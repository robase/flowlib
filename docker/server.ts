import express from 'express';
import type { ErrorRequestHandler } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createFlowlibRouter } from '@flowlib/express';
import { auth } from '@flowlib/user-auth';
import { rbac } from '@flowlib/rbac';
import { webhooks } from '@flowlib/webhooks';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const port = parseInt(process.env.PORT || '3000', 10);
const staticDir = process.env.STATIC_DIR || '/app/frontend';

// --- Database ---
const dbType = (process.env.FLOWLIB_DB_TYPE as 'sqlite' | 'postgres' | 'mysql') || 'sqlite';
const dbConnectionString = process.env.DATABASE_URL || 'file:./data/flowlib.db';

// --- Encryption key (required) ---
const encryptionKey = process.env.FLOWLIB_ENCRYPTION_KEY;
if (!encryptionKey) {
  console.error(
    'FATAL: FLOWLIB_ENCRYPTION_KEY is required. Generate one with: npx flowlib-cli secret',
  );
  process.exit(1);
}

// --- Auth ---
const adminEmail = process.env.FLOWLIB_ADMIN_EMAIL || 'admin@flowlib.local';
const adminPassword = process.env.FLOWLIB_ADMIN_PASSWORD || 'changeme';

// --- Webhooks ---
const webhookBaseUrl = process.env.FLOWLIB_WEBHOOK_BASE_URL || `http://localhost:${port}/flowlib`;

// --- Trusted Origins (comma-separated) ---
const trustedOrigins = process.env.FLOWLIB_TRUSTED_ORIGINS
  ? process.env.FLOWLIB_TRUSTED_ORIGINS.split(',').map((o) => o.trim())
  : [`http://localhost:${port}`];

// --- Logging ---
const logLevel = (process.env.FLOWLIB_LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error') || 'info';

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

// --- Mount Flowlib API ---
const flowlibRouter = await createFlowlibRouter({
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

// --- Mount Flowlib API ---
app.use('/flowlib', flowlibRouter);

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
  console.log(`Flowlib server running on http://0.0.0.0:${port}`);
  console.log(`  Database: ${dbType} (${dbConnectionString})`);
  console.log(`  Admin: ${adminEmail}`);
  console.log(`  Static: ${staticDir}`);
});

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
