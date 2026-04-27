/**
 * Cloudflare D1 driver implementation.
 *
 * Wraps a `D1Database` binding (provided by the Workers runtime as `env.DB`)
 * in the async `DatabaseDriver` interface. Unlike `better-sqlite3` and
 * `libsql`, D1 has no connection string — the host runtime injects the
 * binding into the request scope. The caller passes that binding directly.
 *
 * Note: `@cloudflare/workers-types` is an *optional* peer dependency. The
 * runtime imports `drizzle-orm/d1` and uses the binding's structural API,
 * so installing the workers types is only necessary for compile-time type
 * checking inside a Workers project.
 */

import type { DatabaseDriver } from './types';
import type { Logger } from 'src/schemas';

/**
 * Structural interface for a Cloudflare D1 binding.
 *
 * Mirrors the runtime contract exposed by `@cloudflare/workers-types`'
 * `D1Database`. We keep this structural rather than importing the workers
 * types directly so `@flowlib/core` can be type-checked in environments
 * (Node-only repos) that haven't installed `@cloudflare/workers-types`.
 *
 * In Workers code, this interface is structurally compatible with the real
 * `D1Database` type — pass `env.DB` and TypeScript accepts it.
 */
export interface D1DatabaseBinding {
  prepare(query: string): {
    bind(...params: unknown[]): {
      all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
      run(): Promise<{ meta?: { changes?: number } }>;
    };
    all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
    run(): Promise<{ meta?: { changes?: number } }>;
  };
  exec?(query: string): Promise<unknown>;
  batch?(statements: unknown[]): Promise<unknown[]>;
  dump?(): Promise<ArrayBuffer>;
}

/**
 * Create a D1 driver from a `D1Database` binding.
 *
 * The binding is supplied by the Workers runtime at request time — the host
 * is responsible for plumbing it into `createInvect()` config.
 */
export async function createD1Driver(
  binding: D1DatabaseBinding,
  logger: Logger,
): Promise<DatabaseDriver> {
  if (!binding || typeof binding.prepare !== 'function') {
    throw new Error(
      'D1 driver: invalid binding — expected a D1Database with a prepare() method. ' +
        'In a Workers handler this is `env.DB` (or whatever the binding is named).',
    );
  }

  logger.info('SQLite connection established (d1)');

  return {
    type: 'd1',

    async queryAll<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
      const stmt = binding.prepare(sql);
      const bound = params.length > 0 ? stmt.bind(...params) : stmt;
      const result = await bound.all<T>();
      return (result.results ?? []) as T[];
    },

    async execute(sql: string, params: unknown[] = []) {
      const stmt = binding.prepare(sql);
      const bound = params.length > 0 ? stmt.bind(...params) : stmt;
      const result = await bound.run();
      return { changes: result.meta?.changes ?? 0 };
    },

    close() {
      // D1 bindings are managed by the runtime — nothing to close.
    },
  };
}
