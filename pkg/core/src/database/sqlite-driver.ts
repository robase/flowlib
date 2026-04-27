/**
 * SQLite driver abstraction layer.
 *
 * Provides a unified async interface over both `better-sqlite3` (native, sync)
 * and `@libsql/client` (pure JS / WASM, async / Turso-compatible).
 *
 * Every callsite that previously reached into Drizzle's `$client` for raw
 * SQLite operations should use `SqliteDriver` instead.
 */

import type { FlowlibDatabaseConfig } from 'src/schemas';
import type { Logger } from 'src/schemas';

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export type SqliteDriverType = 'better-sqlite3' | 'libsql';

/**
 * A uniform async interface over any SQLite driver.
 *
 * Consumers never need to know which underlying driver is in use.
 */
export interface SqliteDriver {
  /** Which driver implementation backs this instance. */
  readonly type: SqliteDriverType;

  /** Execute a query and return all result rows. */
  queryAll(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]>;

  /**
   * Execute a statement that mutates data (INSERT / UPDATE / DELETE).
   * Returns the number of changed rows.
   */
  execute(sql: string, params?: unknown[]): Promise<{ changes: number }>;

  /** Close the underlying connection / client (best-effort). */
  close(): void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Resolve which SQLite driver to use.
 *
 * Explicit `config.driver` wins. When omitted, the connection string is used
 * as a heuristic: `libsql://` URLs always get the libsql driver; everything
 * else defaults to `better-sqlite3`.
 */
export function resolveSqliteDriverType(config: FlowlibDatabaseConfig): SqliteDriverType {
  const d = config.driver;
  if (d === 'better-sqlite3' || d === 'libsql') {
    return d;
  }
  if (config.connectionString?.startsWith('libsql://')) {
    return 'libsql';
  }
  return 'better-sqlite3';
}

/**
 * Create a `SqliteDriver` for the given config.
 *
 * The function dynamically imports the relevant package so that the other
 * driver's native binary / WASM blob is never loaded.
 */
export async function createSqliteDriver(
  config: FlowlibDatabaseConfig,
  filePath: string,
  logger: Logger,
): Promise<SqliteDriver> {
  const driverType = resolveSqliteDriverType(config);

  switch (driverType) {
    case 'better-sqlite3':
      return createBetterSqlite3Driver(filePath, logger);
    case 'libsql':
      if (!config.connectionString) {
        throw new Error('libsql driver requires a connectionString');
      }
      return createLibsqlDriver(config.connectionString, filePath, logger);
  }
}

// ---------------------------------------------------------------------------
// better-sqlite3 implementation
// ---------------------------------------------------------------------------

async function createBetterSqlite3Driver(filePath: string, logger: Logger): Promise<SqliteDriver> {
  const Database = (await import('better-sqlite3')).default;

  const dbPath = filePath === ':memory:' ? ':memory:' : filePath;
  const client = new Database(dbPath);

  // Standard pragmas
  client.pragma('journal_mode = WAL');
  client.pragma('synchronous = NORMAL');
  client.pragma('foreign_keys = ON');

  logger.info('SQLite connection established (better-sqlite3)', { filePath });

  return {
    type: 'better-sqlite3',

    async queryAll(sql: string, params: unknown[] = []) {
      return client.prepare(sql).all(...params) as Record<string, unknown>[];
    },

    async execute(sql: string, params: unknown[] = []) {
      const result = client.prepare(sql).run(...params);
      return { changes: result.changes };
    },

    close() {
      try {
        client.close();
      } catch {
        // ignore — may already be closed
      }
    },
  };
}

// ---------------------------------------------------------------------------
// libsql implementation
// ---------------------------------------------------------------------------

async function createLibsqlDriver(
  connectionString: string,
  filePath: string,
  logger: Logger,
): Promise<SqliteDriver> {
  const { createClient } = await import('@libsql/client');

  // Remote Turso URLs use the connection string directly.
  // Local file paths use the `file:` URL scheme.
  const isRemote =
    connectionString.startsWith('libsql://') || connectionString.startsWith('https://');
  const url = isRemote ? connectionString : `file:${filePath}`;

  const client = createClient({ url });

  // Pragmas — libsql supports PRAGMA via execute().
  if (!isRemote) {
    await client.execute('PRAGMA journal_mode = WAL');
    await client.execute('PRAGMA synchronous = NORMAL');
    await client.execute('PRAGMA foreign_keys = ON');
  }

  logger.info('SQLite connection established (libsql)', {
    filePath: isRemote ? connectionString : filePath,
    remote: isRemote,
  });

  return {
    type: 'libsql',

    async queryAll(sql: string, params: unknown[] = []) {
      const result = await client.execute({
        sql,
        args: params as Array<string | number | bigint | ArrayBuffer | null>,
      });
      return result.rows as unknown as Record<string, unknown>[];
    },

    async execute(sql: string, params: unknown[] = []) {
      const result = await client.execute({
        sql,
        args: params as Array<string | number | bigint | ArrayBuffer | null>,
      });
      return { changes: result.rowsAffected };
    },

    close() {
      client.close();
    },
  };
}
