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

  // D1 (Cloudflare) restricts `PRAGMA` over `prepare()` — only `pragma
  // foreign_keys` and `pragma defer_foreign_keys` are allowed; everything
  // else returns `SQLITE_AUTH`. We sniff the driver type and fall back to
  // parsing the CREATE TABLE statement out of `sqlite_master.sql`, which
  // works on every SQLite-compatible driver.
  if (driver.type === 'd1') {
    return introspectSqliteFromMaster(driver);
  }

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

/**
 * D1-compatible introspection.
 *
 * Reads the CREATE TABLE statement from `sqlite_master.sql` and extracts
 * column names from it. SQLite normalises whitespace + identifier quoting
 * but preserves the original column order, so this is reliable. Returns the
 * same `Map<table, Set<column>>` shape as the PRAGMA-based path.
 */
async function introspectSqliteFromMaster(
  driver: import('./drivers/types').DatabaseDriver,
): Promise<Map<string, Set<string>>> {
  const schema = new Map<string, Set<string>>();

  const rows = (await driver.queryAll(
    `SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND name NOT LIKE '\\_\\_%' ESCAPE '\\'`,
  )) as Array<{ name: string; sql: string | null }>;

  for (const row of rows) {
    if (!row.sql) {
      schema.set(row.name, new Set());
      continue;
    }
    schema.set(row.name, parseColumnsFromCreateTable(row.sql));
  }

  return schema;
}

/**
 * Extract column names from a `CREATE TABLE` statement. Handles:
 *   - identifier quoting (backticks, double quotes, brackets)
 *   - inline column constraints (NOT NULL, DEFAULT (...), REFERENCES …)
 *   - skips table-level constraints (PRIMARY KEY, FOREIGN KEY, UNIQUE, CHECK)
 *
 * Not a full SQL parser — just enough to recover the column list. The
 * generated DDL we verify against came from drizzle-kit which uses a
 * predictable shape; this parser handles that shape and most hand-written
 * variants.
 */
function parseColumnsFromCreateTable(sql: string): Set<string> {
  const columns = new Set<string>();
  // Find the first `(` after CREATE TABLE … and walk to the matching `)`,
  // tracking quote/paren state so commas inside parens don't split us.
  const openIdx = sql.indexOf('(');
  if (openIdx === -1) {
    return columns;
  }

  let depth = 0;
  let buf = '';
  let quote: string | null = null;
  for (let i = openIdx; i < sql.length; i++) {
    const ch = sql[i]!;
    if (quote) {
      buf += ch;
      if (ch === quote && sql[i - 1] !== '\\') {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      buf += ch;
      continue;
    }
    if (ch === '(') {
      depth++;
      if (depth === 1) {
        continue;
      } // skip outer paren
      buf += ch;
      continue;
    }
    if (ch === ')') {
      depth--;
      if (depth === 0) {
        addCol(columns, buf);
        break;
      }
      buf += ch;
      continue;
    }
    if (ch === ',' && depth === 1) {
      addCol(columns, buf);
      buf = '';
      continue;
    }
    buf += ch;
  }
  return columns;
}

const TABLE_LEVEL_KEYWORDS = new Set(['PRIMARY', 'FOREIGN', 'UNIQUE', 'CHECK', 'CONSTRAINT']);

function addCol(columns: Set<string>, raw: string): void {
  const trimmed = raw.trim();
  if (!trimmed) {
    return;
  }
  // First token = column name (or table-level keyword).
  // Match: optional quote char, then identifier chars, then closing quote.
  const match = trimmed.match(/^("([^"]+)"|`([^`]+)`|\[([^\]]+)\]|([A-Za-z_][A-Za-z0-9_]*))/);
  if (!match) {
    return;
  }
  const ident = match[2] ?? match[3] ?? match[4] ?? match[5] ?? '';
  if (!ident) {
    return;
  }
  if (TABLE_LEVEL_KEYWORDS.has(ident.toUpperCase())) {
    return;
  }
  columns.add(ident);
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
