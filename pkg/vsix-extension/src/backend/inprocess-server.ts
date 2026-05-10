/**
 * Boot a real `@flowlib/express` server inside the extension process and
 * return the URL. Replaces the previous "headless FlowlibInstance" model
 * — now the embedded backend IS an HTTP backend, just one that happens
 * to be running on `127.0.0.1:<random>` inside this extension.
 *
 * Why an actual server: it lets the webview render the full `<Flowlib>`
 * UI pointed at this URL and get every feature for free (Edit/Runs
 * toggle, runs view, dashboard, credentials, etc.) without per-feature
 * shimming through a fake `InMemoryApiClient`.
 *
 * Lifecycle:
 *   - First call to `getEmbeddedServer(ctx)` runs the schema bootstrap
 *     and starts the HTTP server. Subsequent calls return the cached
 *     handle.
 *   - `disposeEmbeddedServer()` closes the HTTP listener (called from
 *     the extension's `deactivate` path / `ctx.subscriptions`).
 *
 * Note: `createFlowlib` does NOT run migrations on its own — we still
 * have to generate + execute the Drizzle DDL ourselves before the core
 * boots, exactly like the previous embedded.ts did.
 */

import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import type { RequestHandler } from 'express';

import { getExtensionLogger } from '../util/logger';

const SECRET_KEY = 'flowlib.embedded.encryptionKey';

let initPromise: Promise<EmbeddedServer> | undefined;

export interface EmbeddedServer {
  /** Base URL of the in-process server, e.g. `http://127.0.0.1:54321/flowlib`. */
  url: string;
  /** Underlying HTTP server — owned by this module; do not close directly. */
  server: Server;
  dbPath: string;
  /**
   * The shared ExecutionEventBus singleton. Same instance the @flowlib/express
   * router uses for SSE; consumers in the extension host subscribe directly
   * (via `bus.subscribeFlow(flowId, cb)`) to push live run updates into
   * the sidebar without polling.
   */
  bus: import('@flowlib/core').ExecutionEventBus;
}

export interface EmbeddedServerOptions {
  /**
   * Optional middleware mounted UNDER `/flowlib` BEFORE the Flowlib
   * router. The express JSON parser runs first so `req.body` is
   * populated. Used by `FileSync` to intercept canvas-driven flow
   * mutations and write them back to `.flow.ts` files.
   */
  preRouterMiddleware?: RequestHandler;
}

export async function getEmbeddedServer(
  ctx: vscode.ExtensionContext,
  options: EmbeddedServerOptions = {},
): Promise<EmbeddedServer> {
  if (!initPromise) {
    initPromise = init(ctx, options).catch((err) => {
      initPromise = undefined;
      throw err;
    });
  }
  return initPromise;
}

async function init(
  ctx: vscode.ExtensionContext,
  options: EmbeddedServerOptions,
): Promise<EmbeddedServer> {
  const logger = getExtensionLogger();
  const t0 = Date.now();
  const dbDir = ctx.globalStorageUri.fsPath;
  // VSCode owns globalStorageUri — extension-private path, never user input.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  mkdirSync(dbDir, { recursive: true });
  const dbPath = join(dbDir, 'flowlib.db');
  logger.info('embedded server: bootstrapping', { dbPath });

  // Encryption key (auto-generate on first run).
  let encryptionKey = await ctx.secrets.get(SECRET_KEY);
  if (!encryptionKey) {
    encryptionKey = randomBytes(32).toString('base64');
    await ctx.secrets.store(SECRET_KEY, encryptionKey);
    logger.info('embedded server: generated new encryption key');
  }

  // DDL bootstrap — required because `createFlowlib` doesn't run
  // migrations itself.
  await runSchemaBootstrap(dbPath, logger);

  // Build the Express app + Flowlib router.
  const expressMod = await import('express');
  const corsMod = await import('cors');
  const { createFlowlibRouter } = await import('@flowlib/express');

  const express = (expressMod as { default?: typeof import('express') }).default ?? expressMod;
  const cors = (corsMod as { default?: typeof import('cors') }).default ?? corsMod;
  const app = (express as unknown as () => import('express').Express)();
  // Flowlib's ApiClient sends `credentials: 'include'`; CORS forbids the
  // wildcard `Access-Control-Allow-Origin: *` for credentialed requests.
  // Reflect the request's `Origin` header back instead so the webview's
  // `vscode-webview://...` origin is whitelisted, with credentials on.
  type CorsFn = (opts: {
    origin: boolean;
    credentials: boolean;
  }) => import('express').RequestHandler;
  app.use((cors as unknown as CorsFn)({ origin: true, credentials: true }));
  // Parse JSON BEFORE the file-sync middleware so it can introspect
  // request bodies. The Flowlib router parses again internally — that's
  // a no-op when `req.body` is already set, so harmless.
  const exp = express as unknown as typeof import('express');
  app.use(exp.json({ limit: '10mb' }));

  const { webhooks } = await import('@flowlib/webhooks');
  const { mcp } = await import('@flowlib/mcp');

  const router = await createFlowlibRouter({
    database: { type: 'sqlite', connectionString: `file:${dbPath}`, driver: 'better-sqlite3' },
    encryptionKey,
    // MCP plugin contributes a `/mcp` endpoint exposing flows / runs /
    // validation / executions as MCP tools. Combined with the embedded
    // server's loopback URL, this gives Claude Code, Cursor, Claude
    // Desktop etc. an instant integration point — see the
    // `flowlib.showMcpConfig` command for the user-facing config snippet.
    plugins: [webhooks(), mcp()],
    // Triggers can be edited and tested in the canvas, but cron must not fire
    // on its own — the embedded backend runs whenever the editor is open and
    // would otherwise execute scheduled flows in the background. Batch polling
    // (started unconditionally by createFlowlibRouter) stays active so flows
    // with batch-mode AI nodes can be tested end-to-end.
    triggers: { cronEnabled: false },
  });
  // The router's createFlowlib() initialises the ExecutionEventBus
  // singleton; grab a reference now so consumers can subscribe.
  const { getExecutionEventBus } = await import('@flowlib/core');
  const bus = getExecutionEventBus();
  if (options.preRouterMiddleware) {
    app.use('/flowlib', options.preRouterMiddleware);
  }
  app.use('/flowlib', router);

  // Listen on a random free port on the loopback only — never expose
  // the embedded backend to other machines.
  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${addr.port}/flowlib`;
  logger.info('embedded server: ready', { url, dbPath, ms: Date.now() - t0 });
  return { url, server, dbPath, bus };
}

async function runSchemaBootstrap(
  dbPath: string,
  logger: ReturnType<typeof getExtensionLogger>,
): Promise<void> {
  const { mergeSchemas, generateSqliteRawSql } = await import('@flowlib/db');
  const Database = (await import('better-sqlite3')).default;
  const { webhooks } = await import('@flowlib/webhooks');
  const { mcp } = await import('@flowlib/mcp');

  // Plugin schemas extend the core schema. Each enabled plugin's
  // backend.schema (if any) gets merged in so its tables are bootstrapped
  // alongside the core ones. The webhooks plugin contributes
  // `flowlib_webhook_triggers`; the mcp plugin contributes nothing today
  // but is included so a future schema lands automatically.
  const backendPlugins = [webhooks(), mcp()]
    .map((p) => p.backend)
    .filter((b): b is NonNullable<typeof b> => !!b);
  const merged = mergeSchemas(backendPlugins);
  const ddl = generateSqliteRawSql(merged);
  const statements = ddl
    .split(';')
    .map((s) =>
      s
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n')
        .trim(),
    )
    .filter((s) => s.length > 0);

  const client = new Database(dbPath);
  try {
    let executed = 0;
    for (const sql of statements) {
      try {
        client.exec(sql);
        executed++;
      } catch (err) {
        const msg = (err as Error).message ?? '';
        if (!/already exists/i.test(msg)) {
          throw new Error(`bootstrap statement ${executed + 1} failed: ${msg}`);
        }
      }
    }
    logger.debug('embedded server: DDL bootstrap complete', { statements: statements.length });
  } finally {
    client.close();
  }
}

export async function disposeEmbeddedServer(): Promise<void> {
  if (!initPromise) {
    return;
  }
  try {
    const handle = await initPromise;
    await new Promise<void>((resolve) => handle.server.close(() => resolve()));
  } catch {
    /* swallow — best-effort */
  } finally {
    initPromise = undefined;
  }
}
