/**
 * Standalone Next.js-adapter + Flowlib server for E2E test isolation.
 *
 * Mounts the @flowlib/nextjs Web-API handlers on a plain node:http server,
 * so we don't need the full Next.js build pipeline.
 *
 * Usage:  tsx tests/platform/test-server-nextjs.ts
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
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createFlowlibHandler } from '../../../pkg/nextjs/dist/index.mjs';
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

// ── 2. Create the Next.js adapter handler ─────────────────────────────
const handler = createFlowlibHandler({
  encryptionKey: 'dGVzdC1lbmNyeXB0aW9uLWtleS0xMjM0NTY3ODkw',
  database: {
    type: 'sqlite',
    connectionString: `file:${dbPath}`,
  },
  logging: { level: 'warn' },
});

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

// ── 3. Bridge: node:http → Web Request/Response ───────────────────────
//
// The Next.js handler expects:
//   (request: Request, context: { params: Promise<{ flowlib: string[] }> })
// We strip the /api/flowlib/ prefix and pass the remaining path segments.

const API_PREFIX = '/api/flowlib/';

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);

    // Health check
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    // Only handle /api/flowlib/* routes
    if (!url.pathname.startsWith(API_PREFIX)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not Found' }));
      return;
    }

    // Extract path segments after /api/flowlib/
    const subPath = url.pathname.slice(API_PREFIX.length);
    const pathSegments = subPath ? subPath.split('/') : [];

    // Build a Web Request from the node:http request
    const body = await new Promise<Buffer>((resolve) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => resolve(Buffer.concat(chunks)));
    });

    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value) {
        headers.set(key, Array.isArray(value) ? value.join(', ') : value);
      }
    }

    const webRequest = new Request(url.toString(), {
      method: req.method,
      headers,
      body: ['GET', 'HEAD'].includes(req.method || '') ? undefined : new Uint8Array(body),
    });

    const context = { params: Promise.resolve({ flowlib: pathSegments }) };

    // Dispatch to the correct HTTP method handler
    const method = (req.method || 'GET').toUpperCase();
    let webResponse: Response;

    if (method === 'GET' && handler.GET) {
      webResponse = await handler.GET(webRequest, context);
    } else if (method === 'POST' && handler.POST) {
      webResponse = await handler.POST(webRequest, context);
    } else if (method === 'PUT' && handler.PUT) {
      webResponse = await handler.PUT(webRequest, context);
    } else if (method === 'DELETE' && handler.DELETE) {
      webResponse = await handler.DELETE(webRequest, context);
    } else {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method Not Allowed' }));
      return;
    }

    // Convert Web Response back to node:http
    const headerEntries: Record<string, string> = {};
    webResponse.headers.forEach((value, key) => {
      headerEntries[key] = value;
    });
    res.writeHead(webResponse.status, headerEntries);
    const responseBody = await webResponse.arrayBuffer();
    res.end(Buffer.from(responseBody));
  } catch (err) {
    process.stderr.write(`Request error: ${err}\n`);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal Server Error' }));
  }
});

server.listen(port, () => {
  const addr = server.address();
  const assignedPort = typeof addr === 'object' && addr ? addr.port : port;
  process.stdout.write(`LISTENING:${assignedPort}\n`);
});
