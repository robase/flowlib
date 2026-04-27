/**
 * postgres.js (postgres npm package) driver implementation.
 *
 * This is the default PostgreSQL driver — the one Flowlib has always used.
 */

import type { DatabaseDriver } from './types';
import type { Logger } from 'src/schemas';

export async function createPostgresJsDriver(
  connectionString: string,
  logger: Logger,
): Promise<DatabaseDriver> {
  const postgres = (await import('postgres')).default;
  const client = postgres(connectionString, {
    onnotice: (notice: unknown) => logger.debug('PostgreSQL notice', notice),
  });

  // Test connection
  try {
    await client`SELECT 1`;
    logger.info('PostgreSQL connection established (postgres.js)');
  } catch (error) {
    logger.error('Failed to connect to PostgreSQL', error);
    throw error;
  }

  return {
    type: 'postgres',

    async queryAll<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
      return (await client.unsafe(sql, params as (string | number | null | boolean)[])) as T[];
    },

    async execute(sql: string, params: unknown[] = []) {
      const result = await client.unsafe(sql, params as (string | number | null | boolean)[]);
      return {
        changes: (result as unknown as { count?: number }).count ?? result.length ?? 0,
      };
    },

    async close() {
      await client.end();
    },
  };
}
