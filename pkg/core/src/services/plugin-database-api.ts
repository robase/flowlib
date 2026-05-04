/**
 * Shared plugin database API factory.
 *
 * Creates a dialect-agnostic `PluginDatabaseApi` from a `DatabaseConnection`.
 * All framework adapters (Express, NestJS, Next.js) and the core `Flowlib`
 * class share this single implementation.
 */

import type { SQL } from 'drizzle-orm';
import type { Kysely } from 'kysely';

import type { DatabaseConnection } from '../database/connection';
import type { PluginDatabaseApi } from '../types/plugin.types';
import { createKyselyFromConnection } from '../database/adapters/connection-bridge';

/**
 * Drizzle dialect handle exposed on every per-dialect database object.
 * `sqlToQuery` compiles a `SQL` template into the dialect's native
 * placeholder style (`$1, $2` for Postgres, `?` for SQLite/MySQL).
 */
interface DialectHandle {
  sqlToQuery(
    sql: SQL,
    invokeSource?: 'indexes' | undefined,
  ): {
    sql: string;
    params: unknown[];
  };
}

/**
 * Create a `PluginDatabaseApi` that delegates to `connection.driver`.
 *
 * Placeholder convention: callers should use `?` for all dialects.
 * For PostgreSQL, placeholders are automatically converted to `$1, $2, …`.
 */
export function createPluginDatabaseApi(connection: DatabaseConnection): PluginDatabaseApi {
  const normalizeSql = (statement: string): string => {
    if (connection.type !== 'postgresql') {
      return statement;
    }
    // Convert ? → $1, $2, … for PostgreSQL
    let index = 0;
    return statement.replace(/\?/g, () => `$${++index}`);
  };

  // Lazy: most plugins don't use Kysely, so don't pay the construction
  // cost unless someone calls .kysely(). Cached per-PluginDatabaseApi
  // instance — the underlying connection is shared.
  let kyselyInstance: Kysely<Record<string, Record<string, unknown>>> | null = null;
  const getKysely = (): Kysely<Record<string, Record<string, unknown>>> => {
    if (!kyselyInstance) {
      kyselyInstance = createKyselyFromConnection(connection);
    }
    return kyselyInstance;
  };

  return {
    type: connection.type,

    async query<T = Record<string, unknown>>(
      statement: string,
      params: unknown[] = [],
    ): Promise<T[]> {
      return connection.driver.queryAll<T>(normalizeSql(statement), params);
    },

    async execute(statement: string, params: unknown[] = []): Promise<void> {
      // Coerce booleans to 0/1 for SQLite compatibility
      const coerced =
        connection.type === 'sqlite'
          ? params.map((p) => (typeof p === 'boolean' ? (p ? 1 : 0) : p))
          : params;
      await connection.driver.execute(normalizeSql(statement), coerced);
    },

    async executeRows<T = Record<string, unknown>>(query: SQL): Promise<T[]> {
      // Each Drizzle handle exposes its dialect's compiler. Compiling here
      // (rather than running `db.execute(query)` / `db.all(query)` per
      // dialect) lets us route through the same `connection.driver.queryAll`
      // path that `query()` uses — uniform result shape across postgres-js,
      // node-postgres, mysql2, better-sqlite3, libsql, and D1.
      // Drizzle's per-dialect database classes carry a `dialect` field at
      // runtime but it isn't part of their public TS surface — go through
      // `unknown` to access it.
      const dialect = (connection.db as unknown as { dialect: DialectHandle }).dialect;
      const compiled = dialect.sqlToQuery(query);
      return connection.driver.queryAll<T>(compiled.sql, compiled.params);
    },

    // Typed Drizzle handle for plugins that ship per-dialect tables.
    // The concrete type is dialect-specific; plugins narrow via the
    // sibling `type` field and cast.
    drizzle: connection.db,

    kysely<DB>(): Kysely<DB> {
      return getKysely() as unknown as Kysely<DB>;
    },
  };
}
