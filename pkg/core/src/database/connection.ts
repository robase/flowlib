// Database connection management for Flowlib core
//
// All database driver packages (better-sqlite3, @libsql/client, postgres,
// pg, mysql2, drizzle-orm/*) AND the dialect schemas themselves are
// imported dynamically. The dialect schemas (`./schema-sqlite`,
// `./schema-postgres`, `./schema-mysql`) each define their tables at
// module-init via `mysqlTable(...)` / `pgTable(...)`. Eagerly importing
// all three at the top of this file dragged drizzle-orm/mysql-core into
// every consumer's bundle, which on Cloudflare Workers tickled an esbuild
// `__esm` lazy-init ordering bug:
//   `Uncaught TypeError: MySqlVarCharBuilder is not a constructor`
// during Worker cold-start. Lazy-loading per driver branch keeps the
// per-deployment bundle tight and sidesteps the bug entirely — D1-only
// hosts no longer load PG/MySQL schemas at all.
import type { drizzle as drizzlePostgresType } from 'drizzle-orm/postgres-js';
import type { drizzle as drizzleSQLiteType } from 'drizzle-orm/better-sqlite3';
import type { drizzle as drizzleMySQLType } from 'drizzle-orm/mysql2';
import type Database from 'better-sqlite3';

import type * as sqliteSchemaModule from '@flowlib/db/sqlite';
import type * as postgresqlSchemaModule from '@flowlib/db/postgres';
import type * as mysqlSchemaModule from '@flowlib/db/mysql';
import type { DatabaseDriver } from './drivers/types';
import { createDatabaseDriver, resolveDatabaseDriverType } from './drivers';

import { Logger, FlowlibDatabaseConfig } from 'src/schemas';

type SqliteSchema = typeof sqliteSchemaModule;
type PostgresqlSchema = typeof postgresqlSchemaModule;
type MysqlSchema = typeof mysqlSchemaModule;

/**
 * Drizzle SQLite ORM instance type.
 * Covers both better-sqlite3 and libsql drivers (they share the same schema API).
 */
type DrizzleSQLiteDb<S extends Record<string, unknown> = Record<string, unknown>> = ReturnType<
  typeof drizzleSQLiteType<S>
>;

/**
 * Database connection type - discriminated union based on database type.
 *
 * Every variant carries a `driver: DatabaseDriver` that provides a uniform
 * async interface for raw SQL execution. Use `connection.driver` for raw
 * queries instead of reaching into Drizzle's `$client`.
 */
export type DatabaseConnection =
  | {
      type: 'postgresql';
      db: ReturnType<typeof drizzlePostgresType<PostgresqlSchema>>;
      schema: PostgresqlSchema;
      driver: DatabaseDriver;
    }
  | {
      type: 'sqlite';
      db: DrizzleSQLiteDb<SqliteSchema>;
      schema: SqliteSchema;
      driver: DatabaseDriver;
    }
  | {
      type: 'mysql';
      db: ReturnType<typeof drizzleMySQLType<MysqlSchema>>;
      schema: MysqlSchema;
      driver: DatabaseDriver;
    };

/**
 * Query database connection type - for external databases without schemas
 */
export type QueryDatabaseConnection =
  | {
      type: 'postgresql';
      db: ReturnType<typeof drizzlePostgresType>;
      config: FlowlibDatabaseConfig;
      driver: DatabaseDriver;
    }
  | {
      type: 'sqlite';
      db: DrizzleSQLiteDb;
      config: FlowlibDatabaseConfig;
      driver: DatabaseDriver;
    }
  | {
      type: 'mysql';
      db: ReturnType<typeof drizzleMySQLType>;
      config: FlowlibDatabaseConfig;
      driver: DatabaseDriver;
    };

/**
 * Database connection factory
 */
export class DatabaseConnectionFactory {
  private static connections = new Map<string, DatabaseConnection>();
  private static queryConnections = new Map<string, QueryDatabaseConnection>();

  /**
   * Create a database connection for the host database Flowlib runs on
   */
  static async createHostDBConnection(
    dbConfig: FlowlibDatabaseConfig,
    logger: Logger,
  ): Promise<DatabaseConnection> {
    const connectionKey = this.generateConnectionKey(dbConfig);

    if (this.connections.has(connectionKey)) {
      logger.debug('Reusing existing database connection', { type: dbConfig.type });
      return this.connections.get(connectionKey) as DatabaseConnection;
    }

    logger.info('Creating new database connection', { type: dbConfig.type });

    let connection: DatabaseConnection;

    switch (dbConfig.type) {
      case 'postgresql': {
        const driver = await createDatabaseDriver(dbConfig, logger);
        const postgresqlSchema = (await import('@flowlib/db/postgres')) as PostgresqlSchema;
        const pgDb = await this.createPostgreSQLConnection(
          dbConfig,
          driver,
          logger,
          postgresqlSchema,
        );
        connection = {
          type: 'postgresql',
          db: pgDb,
          schema: postgresqlSchema,
          driver,
        };
        break;
      }
      case 'sqlite': {
        const {
          db: sqliteDb,
          driver,
          schema: sqliteSchema,
        } = await this.createSQLiteConnection(dbConfig, logger);
        connection = {
          type: 'sqlite',
          db: sqliteDb,
          schema: sqliteSchema,
          driver,
        };
        break;
      }
      case 'mysql': {
        const driver = await createDatabaseDriver(dbConfig, logger);
        const mysqlSchema = (await import('@flowlib/db/mysql')) as MysqlSchema;
        const mysqlDb = await this.createMySQLConnection(dbConfig, driver, logger, mysqlSchema);
        connection = {
          type: 'mysql',
          db: mysqlDb,
          schema: mysqlSchema,
          driver,
        };
        break;
      }
      default:
        throw new Error(`Unsupported database type: ${dbConfig.type}`);
    }

    this.connections.set(connectionKey, connection);
    return connection;
  }

  /**
   * Create a database connection for external query databases (without schema)
   */
  static async createQueryDbConnection(
    dbConfig: FlowlibDatabaseConfig,
    logger: Logger,
  ): Promise<QueryDatabaseConnection> {
    const connectionKey = this.generateQueryConnectionKey(dbConfig);

    if (this.queryConnections.has(connectionKey)) {
      logger.debug('Reusing existing query database connection', {
        type: dbConfig.type,
      });
      return this.queryConnections.get(connectionKey) as QueryDatabaseConnection;
    }

    logger.info('Creating new query database connection', { type: dbConfig.type });

    let connection: QueryDatabaseConnection;

    switch (dbConfig.type) {
      case 'postgresql': {
        const driver = await createDatabaseDriver(dbConfig, logger);
        const pgDb = await this.createPostgreSQLQueryConnection(dbConfig, driver, logger);
        connection = {
          type: 'postgresql',
          db: pgDb,
          config: dbConfig,
          driver,
        };
        break;
      }
      case 'sqlite': {
        const { db: sqliteDb, driver } = await this.createSQLiteQueryConnection(dbConfig, logger);
        connection = {
          type: 'sqlite',
          db: sqliteDb,
          config: dbConfig,
          driver,
        };
        break;
      }
      case 'mysql': {
        const driver = await createDatabaseDriver(dbConfig, logger);
        const mysqlDb = await this.createMySQLQueryConnection(dbConfig, driver, logger);
        connection = {
          type: 'mysql',
          db: mysqlDb,
          config: dbConfig,
          driver,
        };
        break;
      }
      default:
        throw new Error(`Unsupported database type: ${dbConfig.type}`);
    }

    this.queryConnections.set(connectionKey, connection);
    return connection;
  }

  /**
   * Extract the SQLite file path from a connection string.
   *
   * The host is responsible for passing an absolute path (or `:memory:`).
   * Relative paths are rejected with a clear error — core does NOT call
   * `process.cwd()` or `fs.mkdirSync()` to resolve or create the parent
   * directory, because those APIs don't exist on edge runtimes (Cloudflare
   * Workers, Deno Deploy, etc.). If you need the parent directory created,
   * do it in your bootstrap code before calling `createFlowlib()`.
   */
  private static prepareSQLiteFilePath(connectionString: string, _logger: Logger): string {
    // Extract file path from SQLite URL
    const filePath = connectionString.replace(/^sqlite:/, '').replace(/^file:/, '');

    if (filePath === ':memory:') {
      return filePath;
    }

    // Reject relative paths — host must pass an absolute path. Lightweight
    // POSIX/Windows check to avoid importing `node:path`.
    const isAbsolute = filePath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(filePath);
    if (!isAbsolute) {
      throw new Error(
        `SQLite connection string must be an absolute path or ':memory:'. ` +
          `Got: "${connectionString}". ` +
          `Resolve relative paths in your bootstrap (e.g. with path.resolve(process.cwd(), '...')) ` +
          `and pre-create any parent directories before calling createFlowlib(). ` +
          `Core does not call process.cwd() or fs.mkdirSync() so it stays portable to edge runtimes.`,
      );
    }

    return filePath;
  }

  /**
   * Helper method to configure SQLite database pragmas via better-sqlite3.
   * Only used for the better-sqlite3 direct Drizzle path; the DatabaseDriver
   * abstraction handles pragmas internally.
   */
  private static configureSQLitePragmas(
    client: InstanceType<typeof Database> | { pragma(sql: string): void },
  ): void {
    client.pragma('journal_mode = WAL');
    client.pragma('synchronous = NORMAL');
    client.pragma('foreign_keys = ON');
  }

  /**
   * Create PostgreSQL Drizzle ORM instance.
   *
   * The `driver` has already been created and tested. We create a *second*
   * client handle for Drizzle because each Drizzle adapter constructor
   * expects its own driver-specific client. The `DatabaseDriver` and the
   * Drizzle instance share the same underlying connection pool/endpoint.
   */
  private static async createPostgreSQLConnection(
    config: FlowlibDatabaseConfig,
    driver: DatabaseDriver,
    logger: Logger,
    postgresqlSchema: PostgresqlSchema,
  ): Promise<ReturnType<typeof drizzlePostgresType<PostgresqlSchema>>> {
    return this.createDrizzlePostgresDb(
      config,
      driver,
      logger,
      postgresqlSchema,
    ) as unknown as ReturnType<typeof drizzlePostgresType<PostgresqlSchema>>;
  }

  /**
   * Create a Drizzle PostgreSQL instance for the given driver type.
   * Dynamically imports the correct Drizzle adapter so unused packages
   * are never loaded.
   */
  private static async createDrizzlePostgresDb(
    config: FlowlibDatabaseConfig,
    driver: DatabaseDriver,
    logger: Logger,
    schema?: Record<string, unknown>,
  ): Promise<unknown> {
    if (!config.connectionString) {
      throw new Error(
        `PostgreSQL driver "${driver.type}" requires a connectionString in database config.`,
      );
    }
    const connectionString = config.connectionString;
    switch (driver.type) {
      case 'postgres': {
        const postgres = (await import('postgres')).default;
        const { drizzle: drizzlePostgres } = await import('drizzle-orm/postgres-js');
        const client = postgres(connectionString, {
          onnotice: (notice: unknown) => logger.debug('PostgreSQL notice', notice),
        });
        return schema ? drizzlePostgres(client, { schema }) : drizzlePostgres(client);
      }
      case 'pg': {
        const { Pool } = await import('pg');
        const { drizzle: drizzleNodePg } = await import('drizzle-orm/node-postgres');
        const pool = new Pool({ connectionString });
        return schema ? drizzleNodePg(pool, { schema }) : drizzleNodePg(pool);
      }
      case 'neon-serverless': {
        // @ts-ignore — @neondatabase/serverless is an optional dependency
        const neonMod = await import('@neondatabase/serverless');
        const { drizzle: drizzleNeon } = await import('drizzle-orm/neon-serverless');

        const pool = new (neonMod.Pool as new (o: Record<string, unknown>) => unknown)({
          connectionString,
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return schema ? drizzleNeon(pool as any, { schema }) : drizzleNeon(pool as any);
      }
      default:
        throw new Error(`Unsupported PostgreSQL driver type: ${driver.type}`);
    }
  }

  /**
   * Create SQLite connection.
   *
   * Resolves the driver type from config, creates
   * both the Drizzle ORM instance and the raw DatabaseDriver handle.
   *
   * D1 short-circuits: it has no `connectionString` and no file path, so
   * `prepareSQLiteFilePath` (which calls `process.cwd()` and `fs.mkdirSync()`)
   * is skipped entirely — those Node-only APIs don't exist on Cloudflare
   * Workers.
   */
  private static async createSQLiteConnection(
    config: FlowlibDatabaseConfig,
    logger: Logger,
  ): Promise<{
    db: DrizzleSQLiteDb<SqliteSchema>;
    driver: DatabaseDriver;
    schema: SqliteSchema;
  }> {
    const driverType = resolveDatabaseDriverType(config);
    const sqliteSchema = (await import('@flowlib/db/sqlite')) as SqliteSchema;

    // D1: no file path, no connection string — bind directly to env.DB.
    if (driverType === 'd1') {
      if (!config.binding) {
        throw new Error(
          'D1 driver requires a `binding` (the `D1Database` from `env.DB` in your Workers handler).',
        );
      }
      const driver = await createDatabaseDriver(config, logger);
      const { drizzle: drizzleD1 } = await import('drizzle-orm/d1');
      const db = drizzleD1(config.binding as Parameters<typeof drizzleD1>[0], {
        schema: sqliteSchema,
      }) as unknown as DrizzleSQLiteDb<SqliteSchema>;
      logger.debug('Skipping SQLite migrations - assuming D1 database conforms to schema');
      return { db, driver, schema: sqliteSchema };
    }

    // File-based drivers (better-sqlite3 / libsql) — need filePath resolution.
    if (!config.connectionString) {
      throw new Error(
        `SQLite driver "${driverType}" requires a connectionString (e.g. 'file:/abs/path/to.db').`,
      );
    }
    const filePath = this.prepareSQLiteFilePath(config.connectionString, logger);

    // Create the unified driver (handles pragmas internally).
    const driver = await createDatabaseDriver(config, logger, filePath);

    let db: DrizzleSQLiteDb<SqliteSchema>;

    if (driverType === 'libsql') {
      const { createClient } = await import('@libsql/client');
      const { drizzle: drizzleLibSQL } = await import('drizzle-orm/libsql');
      const isRemote =
        config.connectionString.startsWith('libsql://') ||
        config.connectionString.startsWith('https://');
      const url = isRemote ? config.connectionString : `file:${filePath}`;
      const client = createClient({ url });
      db = drizzleLibSQL(client, {
        schema: sqliteSchema,
      }) as unknown as DrizzleSQLiteDb<SqliteSchema>;
    } else {
      const BetterSqlite3 = (await import('better-sqlite3')).default;
      const { drizzle: drizzleSQLite } = await import('drizzle-orm/better-sqlite3');
      const dbPath = filePath === ':memory:' ? ':memory:' : filePath;
      const client = new BetterSqlite3(dbPath);
      this.configureSQLitePragmas(client);
      db = drizzleSQLite(client, { schema: sqliteSchema });
    }

    // Skip migrations - assume database already conforms to schema
    logger.debug('Skipping SQLite migrations - assuming database conforms to schema');

    return { db, driver, schema: sqliteSchema };
  }

  /**
   * Create MySQL Drizzle ORM instance.
   *
   * The `driver` has already been created and tested.
   */
  private static async createMySQLConnection(
    config: FlowlibDatabaseConfig,
    _driver: DatabaseDriver,
    logger: Logger,
    mysqlSchema: MysqlSchema,
  ): Promise<ReturnType<typeof drizzleMySQLType<MysqlSchema>>> {
    if (!config.connectionString) {
      throw new Error('MySQL driver requires a connectionString in database config.');
    }
    const mysql = await import('mysql2/promise');
    const { drizzle: drizzleMySQL } = await import('drizzle-orm/mysql2');
    const connection = mysql.createPool(config.connectionString);
    const db = drizzleMySQL(connection, { schema: mysqlSchema, mode: 'default' });
    logger.debug('MySQL Drizzle ORM instance created');
    return db as unknown as ReturnType<typeof drizzleMySQLType<MysqlSchema>>;
  }

  /**
   * Create PostgreSQL query connection (without schema)
   */
  private static async createPostgreSQLQueryConnection(
    config: FlowlibDatabaseConfig,
    driver: DatabaseDriver,
    logger: Logger,
  ): Promise<ReturnType<typeof drizzlePostgresType>> {
    return this.createDrizzlePostgresDb(config, driver, logger) as unknown as ReturnType<
      typeof drizzlePostgresType
    >;
  }

  /**
   * Create SQLite query connection (without schema)
   *
   * D1 short-circuits: it has no `connectionString` and no file path.
   */
  private static async createSQLiteQueryConnection(
    config: FlowlibDatabaseConfig,
    logger: Logger,
  ): Promise<{
    db: DrizzleSQLiteDb;
    driver: DatabaseDriver;
  }> {
    const driverType = resolveDatabaseDriverType(config);

    // D1: bind directly, skip file path handling.
    if (driverType === 'd1') {
      if (!config.binding) {
        throw new Error(
          'D1 driver requires a `binding` (the `D1Database` from `env.DB` in your Workers handler).',
        );
      }
      const driver = await createDatabaseDriver(config, logger);
      const { drizzle: drizzleD1 } = await import('drizzle-orm/d1');
      const db = drizzleD1(
        config.binding as Parameters<typeof drizzleD1>[0],
      ) as unknown as DrizzleSQLiteDb;
      logger.info('SQLite query connection established successfully (d1)');
      return { db, driver };
    }

    if (!config.connectionString) {
      throw new Error(
        `SQLite driver "${driverType}" requires a connectionString (e.g. 'file:/abs/path/to.db').`,
      );
    }
    const filePath = this.prepareSQLiteFilePath(config.connectionString, logger);

    const driver = await createDatabaseDriver(config, logger, filePath);

    let db: DrizzleSQLiteDb;

    if (driverType === 'libsql') {
      const { createClient } = await import('@libsql/client');
      const { drizzle: drizzleLibSQL } = await import('drizzle-orm/libsql');
      const isRemote =
        config.connectionString.startsWith('libsql://') ||
        config.connectionString.startsWith('https://');
      const url = isRemote ? config.connectionString : `file:${filePath}`;
      const client = createClient({ url });
      db = drizzleLibSQL(client) as unknown as DrizzleSQLiteDb;
    } else {
      const BetterSqlite3 = (await import('better-sqlite3')).default;
      const { drizzle: drizzleSQLite } = await import('drizzle-orm/better-sqlite3');
      const dbPath = filePath === ':memory:' ? ':memory:' : filePath;
      const client = new BetterSqlite3(dbPath);
      this.configureSQLitePragmas(client);
      db = drizzleSQLite(client);
    }

    logger.info('SQLite query connection established successfully', { filePath });
    return { db, driver };
  }

  /**
   * Create MySQL query connection (without schema)
   */
  private static async createMySQLQueryConnection(
    config: FlowlibDatabaseConfig,
    _driver: DatabaseDriver,
    logger: Logger,
  ): Promise<ReturnType<typeof drizzleMySQLType>> {
    if (!config.connectionString) {
      throw new Error('MySQL driver requires a connectionString in database config.');
    }
    const mysql = await import('mysql2/promise');
    const { drizzle: drizzleMySQL } = await import('drizzle-orm/mysql2');
    const connection = mysql.createPool(config.connectionString);
    const db = drizzleMySQL(connection, { mode: 'default' });
    logger.debug('MySQL Drizzle query instance created');
    return db as unknown as ReturnType<typeof drizzleMySQLType>;
  }

  /**
   * Generate a unique key for connection caching.
   *
   * For D1 (no connectionString), keys are derived from the binding identity
   * — falling back to a stable per-binding tag so multiple D1 instances cache
   * separately within the same worker isolate.
   */
  private static generateConnectionKey(config: FlowlibDatabaseConfig): string {
    if (config.driver === 'd1') {
      return `${config.type}:d1:${this.bindingTag(config.binding)}`;
    }
    return `${config.type}:${config.connectionString}`;
  }

  /**
   * Generate a unique key for query connection caching
   */
  private static generateQueryConnectionKey(config: FlowlibDatabaseConfig): string {
    if (config.driver === 'd1') {
      return `query:${config.type}:d1:${this.bindingTag(config.binding)}`;
    }
    return `query:${config.type}:${config.connectionString}`;
  }

  /**
   * Best-effort identity tag for a D1 binding so distinct bindings don't
   * share cached connections within the same isolate. We fall back to the
   * object's reference identity via a WeakMap lookup.
   */
  private static d1BindingTags = new WeakMap<object, string>();
  private static d1BindingCounter = 0;
  private static bindingTag(binding: unknown): string {
    if (binding && typeof binding === 'object') {
      const existing = this.d1BindingTags.get(binding as object);
      if (existing) {
        return existing;
      }
      const tag = `b${++this.d1BindingCounter}`;
      this.d1BindingTags.set(binding as object, tag);
      return tag;
    }
    return 'unknown';
  }

  /**
   * Close all connections
   */
  static async closeAllConnections(logger: Logger): Promise<void> {
    logger.info('Closing all database connections');

    // Close host database connections
    for (const [key, _connection] of this.connections) {
      try {
        // The connections are not directly closeable in Drizzle,
        // but the underlying clients handle cleanup
        logger.debug('Host connection closed', { key });
      } catch (error) {
        logger.error('Error closing host connection', { key, error });
      }
    }

    // Close query database connections
    for (const [key, _connection] of this.queryConnections) {
      try {
        // The connections are not directly closeable in Drizzle,
        // but the underlying clients handle cleanup
        logger.debug('Query connection closed', { key });
      } catch (error) {
        logger.error('Error closing query connection', { key, error });
      }
    }

    this.connections.clear();
    this.queryConnections.clear();
  }

  /**
   * Get schema for database type
   */
  static async getSchema(type: FlowlibDatabaseConfig['type']) {
    switch (type) {
      case 'postgresql':
        return (await import('@flowlib/db/postgres')) as PostgresqlSchema;
      case 'sqlite':
        return (await import('@flowlib/db/sqlite')) as SqliteSchema;
      case 'mysql':
        return (await import('@flowlib/db/mysql')) as MysqlSchema;
      default:
        throw new Error(`Unsupported database type: ${type}`);
    }
  }
}
