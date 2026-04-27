/**
 * Shared plugin database API factory.
 *
 * Creates a dialect-agnostic `PluginDatabaseApi` from a `DatabaseConnection`.
 * All framework adapters (Express, NestJS, Next.js) and the core `Flowlib`
 * class share this single implementation.
 */

import type { DatabaseConnection } from '../database/connection';
import type { PluginDatabaseApi } from '../types/plugin.types';

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
  };
}
