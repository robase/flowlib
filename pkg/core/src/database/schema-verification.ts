/**
 * Schema Verification
 *
 * Lightweight startup check that verifies the database has the expected
 * tables and columns matching the abstract schema (core + plugins).
 *
 * This does NOT run migrations — the developer is responsible for running
 * `npx flowlib-cli generate` (CLI) and then applying the schema themselves
 * (e.g., via Drizzle Kit push/migrate, Prisma migrate, or raw SQL).
 *
 * The core calls `verifySchema()` on startup after connecting to the DB.
 * If any required tables or columns are missing, it logs clear warnings
 * (or throws if configured strictly) so the developer knows which
 * schema changes to apply.
 *
 * Dialect-specific introspection:
 * - SQLite:     `PRAGMA table_info(<table>)`
 * - PostgreSQL: `information_schema.tables` + `information_schema.columns`
 * - MySQL:      `information_schema.tables` + `information_schema.columns`
 */

import type { DatabaseConnection } from './connection';
import type { Logger } from 'src/schemas';
import { mergeSchemas } from './schema-merger';
import type { FlowlibPlugin } from 'src/types/plugin.types';

// =============================================================================
// Types
// =============================================================================

export interface SchemaVerificationResult {
  /** Whether the schema is fully valid (no missing tables or columns) */
  valid: boolean;
  /** Tables that exist in the abstract schema but not in the database */
  missingTables: string[];
  /** Columns that exist in the abstract schema but not in the database */
  missingColumns: { table: string; column: string }[];
  /** Tables that were found and checked */
  verifiedTables: string[];
}

export interface SchemaVerificationOptions {
  /**
   * If true, throw an error when the schema is invalid.
   * If false (default), only log warnings.
   */
  strict?: boolean;
  /**
   * Plugins that extend the schema (their tables/columns will also be verified).
   */
  plugins?: FlowlibPlugin[];
}

// =============================================================================
// Main Verification Function
// =============================================================================

/**
 * Verify that the database has all tables and columns required by the
 * abstract schema (core + plugins).
 *
 * This is called on startup after the database connection is established.
 * It does NOT run migrations — it only checks what exists.
 */
export async function verifySchema(
  connection: DatabaseConnection,
  logger: Logger,
  options: SchemaVerificationOptions = {},
): Promise<SchemaVerificationResult> {
  const merged = mergeSchemas(options.plugins || []);
  const result: SchemaVerificationResult = {
    valid: true,
    missingTables: [],
    missingColumns: [],
    verifiedTables: [],
  };

  // Get the actual tables/columns from the database
  const actualSchema = await introspectDatabase(connection);

  // Compare against the abstract schema
  for (const table of merged.tables) {
    if (table.definition.disableMigration) {
      continue;
    }

    const dbTableName = table.definition.tableName || toSnakeCase(table.name);

    if (!actualSchema.has(dbTableName)) {
      result.valid = false;
      result.missingTables.push(dbTableName);
      continue;
    }

    result.verifiedTables.push(dbTableName);
    const actualColumns = actualSchema.get(dbTableName) ?? new Set<string>();

    for (const [fieldName] of Object.entries(table.definition.fields)) {
      const dbColName = toSnakeCase(fieldName);
      if (!actualColumns.has(dbColName)) {
        result.valid = false;
        result.missingColumns.push({ table: dbTableName, column: dbColName });
      }
    }
  }

  // Report results
  if (result.valid) {
    logger.info('Schema verification passed', {
      tablesVerified: result.verifiedTables.length,
    });
  } else {
    const messages: string[] = [];

    if (result.missingTables.length > 0) {
      messages.push(`Missing tables: ${result.missingTables.join(', ')}`);
    }
    if (result.missingColumns.length > 0) {
      const colList = result.missingColumns.map((c) => `${c.table}.${c.column}`).join(', ');
      messages.push(`Missing columns: ${colList}`);
    }

    const fullMessage = [
      'Schema verification failed — your database is missing required tables or columns.',
      ...messages,
      '',
      'To fix this, run:',
      '  npx flowlib-cli generate    # regenerate schema files',
      '  npx drizzle-kit push    # apply schema to database (Drizzle)',
      '  npx prisma db push      # apply schema to database (Prisma)',
    ].join('\n');

    if (options.strict) {
      logger.error(fullMessage);
      throw new Error(fullMessage);
    } else {
      logger.warn(fullMessage);
    }
  }

  return result;
}

// =============================================================================
// Database Introspection
// =============================================================================

/**
 * Introspect the database to discover existing tables and their columns.
 * Returns a Map of tableName → Set<columnName>.
 */
async function introspectDatabase(
  connection: DatabaseConnection,
): Promise<Map<string, Set<string>>> {
  switch (connection.type) {
    case 'sqlite':
      return introspectSqlite(connection.driver);
    case 'postgresql':
      return introspectPostgres(connection.db);
    case 'mysql':
      return introspectMysql(connection.db);
    default:
      throw new Error(`Unsupported database type for schema verification`);
  }
}

async function introspectSqlite(
  driver: import('./drivers/types').DatabaseDriver,
): Promise<Map<string, Set<string>>> {
  const schema = new Map<string, Set<string>>();

  const tables = (await driver.queryAll(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND name NOT LIKE '\\_\\_%' ESCAPE '\\'`,
  )) as Array<{ name: string }>;

  for (const table of tables) {
    const columns = (await driver.queryAll(`PRAGMA table_info('${table.name}')`)) as Array<{
      name: string;
    }>;
    schema.set(table.name, new Set(columns.map((c) => c.name)));
  }

  return schema;
}

async function introspectPostgres(db: DatabaseConnection['db']): Promise<Map<string, Set<string>>> {
  const schema = new Map<string, Set<string>>();

  const result = await (
    db as { execute: (sql: string) => Promise<{ rows?: Array<Record<string, string>> }> }
  ).execute(
    `SELECT table_name, column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
     ORDER BY table_name, ordinal_position`,
  );

  for (const row of (result.rows || []) as Array<Record<string, string>>) {
    const tableName = row['table_name'] ?? '';
    const columnName = row['column_name'] ?? '';

    if (!schema.has(tableName)) {
      schema.set(tableName, new Set());
    }
    const cols = schema.get(tableName);
    if (cols) {
      cols.add(columnName);
    }
  }

  return schema;
}

async function introspectMysql(db: DatabaseConnection['db']): Promise<Map<string, Set<string>>> {
  const schema = new Map<string, Set<string>>();

  const result = await (
    db as {
      execute: (
        sql: string,
      ) => Promise<{ rows?: Array<Record<string, string>> } | Array<Array<Record<string, string>>>>;
    }
  ).execute(
    `SELECT TABLE_NAME, COLUMN_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
     ORDER BY TABLE_NAME, ORDINAL_POSITION`,
  );

  const rows = Array.isArray(result)
    ? (((result as Array<unknown>)[0] ?? []) as Array<Record<string, string>>)
    : ((result as { rows?: Array<Record<string, string>> }).rows ?? []);

  for (const row of rows) {
    const tableName = row['TABLE_NAME'] ?? '';
    const columnName = row['COLUMN_NAME'] ?? '';

    if (!schema.has(tableName)) {
      schema.set(tableName, new Set());
    }
    const cols = schema.get(tableName);
    if (cols) {
      cols.add(columnName);
    }
  }

  return schema;
}

// =============================================================================
// Helpers
// =============================================================================

function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}
