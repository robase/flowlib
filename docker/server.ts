/**
 * Docker entry server.
 *
 * Thin Express shell that mounts the **same `flowlibConfig`** the
 * `express-drizzle` example uses (`./flowlib.config`) and serves the
 * pre-built SPA. By reusing that config we get the full plugin set —
 * auth, rbac, webhooks, mcp, vercel-workflows, version-control, and the
 * code-editing agents (chat over HTTP/SSE, with an optional local Docker
 * sandbox) — without re-declaring it here, so the image never drifts out
 * of sync with the example.
 *
 * Everything is env-driven (see `flowlib.config.ts` + `docker-compose.yml`):
 *   DATABASE_URL / FLOWLIB_DB_TYPE   — database
 *   FLOWLIB_ENCRYPTION_KEY           — credential encryption + auth (required)
 *   FLOWLIB_ADMIN_EMAIL / _PASSWORD  — seeded admin
 *   FLOWLIB_TRUSTED_ORIGINS          — extra CORS/auth origins
 *   SEED_*                           — seeded credentials (LLM keys, OAuth)
 *   AGENT_DOCKER_SANDBOX_IMAGE       — agent sandbox (needs the docker socket)
 *
 * The Dockerfile copies this file to `examples/express-drizzle/docker-server.ts`
 * so the `./flowlib.config` import + workspace deps resolve.
 */
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import type { ErrorRequestHandler } from 'express';
import cors from 'cors';
import { createFlowlibRouter } from '@flowlib/express';
import { flowlibConfig } from './flowlib.config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = parseInt(process.env.PORT || '3000', 10);
// The built SPA. The Dockerfile sets STATIC_DIR to the vite build output.
const staticDir = process.env.STATIC_DIR || path.resolve(__dirname, '../vite-react-frontend/dist');

if (!process.env.FLOWLIB_ENCRYPTION_KEY) {
  console.error(
    'FATAL: FLOWLIB_ENCRYPTION_KEY is required. Generate one with `npx flowlib-cli secret` ' +
      'and set it in the environment (docker-compose.yml).',
  );
  process.exit(1);
}

const app = express();

// CORS for cross-origin frontends (when not served from this container).
const trustedOrigins = process.env.FLOWLIB_TRUSTED_ORIGINS
  ? process.env.FLOWLIB_TRUSTED_ORIGINS.split(',')
      .map((o) => o.trim())
      .filter(Boolean)
  : true;
app.use(cors({ origin: trustedOrigins, credentials: true }));
app.use(express.json({ limit: '10mb' }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Mount the full Flowlib API (all plugins from the shared config).
const flowlibRouter = await createFlowlibRouter(flowlibConfig);
app.use('/flowlib', flowlibRouter);

// Serve the pre-built SPA + fallback for client-side routes.
// Express 5 (path-to-regexp v8) requires named wildcards — bare '*' throws.
app.use(express.static(staticDir));
app.get('/*splat', (_req, res) => {
  res.sendFile(path.join(staticDir, 'index.html'));
});

const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  console.error('Unhandled error:', error);
  if (res.headersSent) {
    return next(error);
  }
  res.status(500).json({ error: 'Internal Server Error' });
};
app.use(errorHandler);

app.listen(port, '0.0.0.0', () => {
  console.log(`Flowlib running on http://0.0.0.0:${port}`);
  console.log(
    `  Database: ${flowlibConfig.database.type} (${flowlibConfig.database.connectionString})`,
  );
  console.log(`  Static:   ${staticDir}`);
  console.log(
    `  Agent sandbox: ${process.env.AGENT_DOCKER_SANDBOX_IMAGE || '(disabled — pure chat)'}`,
  );
});

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
