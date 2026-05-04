/**
 * Bridge between Flowlib's existing DatabaseConnection (Drizzle-based)
 * and the new Kysely-based adapter system.
 *
 * Creates a Kysely instance that shares the underlying database
 * connection via the unified DatabaseDriver interface.
 */

import {
  Kysely,
  MysqlQueryCompiler,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
} from 'kysely';
import type { DatabaseConnection } from '../connection';
import type { DatabaseDriver } from '../drivers/types';
import type { FlowlibAdapter, AdapterConfig } from '../adapter';
import { createKyselyAdapter } from './kysely-adapter';
import { createFlowlibAdapterFactory } from '../adapter-factory';
import { FLOWLIB_SCHEMA_META } from '../schema-metadata';

type KyselyDb = Kysely<Record<string, Record<string, unknown>>>;

/**
 * Create an FlowlibAdapter from an existing DatabaseConnection.
 *
 * The Kysely instance shares the same underlying database client
 * (no new connections are created).
 */
export function createAdapterFromConnection(connection: DatabaseConnection): FlowlibAdapter {
  const kyselyDb = createKyselyFromConnection(connection);

  const config: AdapterConfig = {
    dialect: connection.type,
  };

  const rawAdapter = createKyselyAdapter(kyselyDb, config);
  return createFlowlibAdapterFactory(rawAdapter, config, FLOWLIB_SCHEMA_META);
}

/**
 * Create a Kysely instance that delegates to the DatabaseDriver from
 * a Drizzle DatabaseConnection. No new connections are created.
 *
 * Exported so the plugin database API can hand out a typed Kysely
 * handle (see `PluginDatabaseApi.kysely<DB>()`). The returned instance
 * is dialect-aware but type-erased at the table-set level — callers
 * narrow to their own `DB` interface via the `kysely<DB>()` accessor.
 */
export function createKyselyFromConnection(connection: DatabaseConnection): KyselyDb {
  switch (connection.type) {
    case 'sqlite': {
      return new Kysely({
        dialect: {
          createAdapter: () => new SqliteAdapter(),
          createDriver: () => createDriverBridge(connection.driver),
          createIntrospector: (db: Kysely<unknown>) => new SqliteIntrospector(db),
          createQueryCompiler: () => new SqliteQueryCompiler(),
        } as never,
      }) as unknown as KyselyDb;
    }

    case 'postgresql': {
      return new Kysely({
        dialect: {
          createAdapter: () => new PostgresAdapter(),
          createDriver: () => createDriverBridge(connection.driver),
          createIntrospector: (db: Kysely<unknown>) => new PostgresIntrospector(db),
          createQueryCompiler: () => new PostgresQueryCompiler(),
        } as never,
      }) as unknown as KyselyDb;
    }

    case 'mysql': {
      // MySQL uses the standard MysqlDialect with the pool obtained from Drizzle's $client.
      // We can't easily use the DatabaseDriver here because MysqlDialect expects a pool.
      // Instead we create a universal Kysely driver bridge using DatabaseDriver.
      return new Kysely({
        dialect: {
          createAdapter: () =>
            ({
              supportsReturning: () => false,
              supportsTransactionalDdl: () => false,
            }) as unknown as ReturnType<Kysely<never>['getExecutor']>['adapter'],
          createDriver: () => createDriverBridge(connection.driver),
          createIntrospector: (db: Kysely<unknown>) =>
            new (class {
              constructor(private db: Kysely<unknown>) {}
              introspect() {
                return { tables: [] };
              }
            })(db) as unknown as ReturnType<
              Kysely<never>['getExecutor']
            >['adapter'] extends infer _A
              ? InstanceType<never>
              : never,
          createQueryCompiler: () => {
            return new MysqlQueryCompiler();
          },
        } as never,
      }) as unknown as KyselyDb;
    }
  }
}

// ---------------------------------------------------------------------------
// Universal Kysely driver bridge — wraps DatabaseDriver
// ---------------------------------------------------------------------------

async function noopAsync(): Promise<void> {
  return undefined;
}

/**
 * Create a Kysely driver that delegates to a DatabaseDriver.
 * Works with any dialect — the driver handles SQL execution uniformly.
 */
function createDriverBridge(driver: DatabaseDriver) {
  return {
    init: noopAsync,
    async acquireConnection() {
      return {
        executeQuery: async (compiledQuery: { sql: string; parameters: unknown[] }) => {
          const sql = compiledQuery.sql.trimStart();
          const isSelect = /^(SELECT|PRAGMA|WITH|EXPLAIN|SHOW)/i.test(sql);
          const hasReturning = /\bRETURNING\b/i.test(sql);

          if (isSelect || hasReturning) {
            const rows = await driver.queryAll(compiledQuery.sql, compiledQuery.parameters);
            return {
              rows,
              numAffectedRows: BigInt(rows.length),
            };
          } else {
            const result = await driver.execute(compiledQuery.sql, compiledQuery.parameters);
            return {
              rows: [],
              numAffectedRows: BigInt(result.changes),
            };
          }
        },
        streamQuery: () => {
          throw new Error('Streaming not supported with DatabaseDriver bridge');
        },
      };
    },
    beginTransaction: noopAsync,
    commitTransaction: noopAsync,
    rollbackTransaction: noopAsync,
    releaseConnection: noopAsync,
    destroy: noopAsync,
  };
}
