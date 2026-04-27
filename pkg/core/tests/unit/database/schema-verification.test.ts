/**
 * Unit tests for Schema Verification
 *
 * Tests that the startup schema verifier correctly detects:
 * - Missing tables
 * - Missing columns
 * - Fully valid schema (all tables + columns present)
 * - Strict mode (throws on invalid)
 * - Non-strict mode (warns but doesn't throw)
 * - Plugin table verification
 *
 * Uses mocked database connections to avoid needing a real DB.
 */

import { describe, it, expect, vi } from 'vitest';
import { verifySchema } from '../../../src/database/schema-verification';
import type { DatabaseConnection } from '../../../src/database/connection';
import { CORE_SCHEMA } from '../../../src/database/core-schema';
import type { InvectPlugin } from '../../../src/types/plugin.types';

function asSchemaDefinition(definition: unknown): {
  tableName?: string;
  fields: Record<string, unknown>;
} {
  return definition as { tableName?: string; fields: Record<string, unknown> };
}

// Build a map of logical name → DB table name for easy access in tests
const TABLE_NAMES: Record<string, string> = {};
for (const [key, def] of Object.entries(CORE_SCHEMA)) {
  TABLE_NAMES[key] = asSchemaDefinition(def).tableName || key;
}

// =============================================================================
// Mock logger
// =============================================================================

function createMockLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

// =============================================================================
// Mock database connection
// =============================================================================

/**
 * Create a mock SQLite database connection that returns the given
 * tables and columns from introspection queries.
 */
function createMockSqliteConnection(schema: Record<string, string[]>): DatabaseConnection {
  return {
    type: 'sqlite',
    db: {} as unknown,
    schema: {} as unknown as DatabaseConnection['schema'],
    driver: {
      type: 'better-sqlite3' as const,
      async queryAll(sql: string) {
        if (sql.includes('sqlite_master')) {
          return Object.keys(schema).map((name) => ({ name }));
        }
        if (sql.includes('PRAGMA table_info')) {
          const match = sql.match(/table_info\('(.+?)'\)/);
          const tableName = match?.[1] || '';
          const columns = schema[tableName] || [];
          return columns.map((name) => ({ name }));
        }
        return [];
      },
      async execute() {
        return { changes: 0 };
      },
      close() {},
    },
  } as unknown as DatabaseConnection;
}

// =============================================================================
// Helper: build a "complete" schema map with all core table names + columns
// =============================================================================

/**
 * Helper: convert camelCase to snake_case (same logic as in schema-verification.ts)
 */
function toSnakeCase(str: string): string {
  return str.replace(/([A-Z])/g, '_$1').toLowerCase();
}

/**
 * Build a mock schema map with ALL core tables and ALL their columns
 * derived from the actual CORE_SCHEMA, so verification passes.
 */
function buildCompleteCoreSchema(): Record<string, string[]> {
  const result: Record<string, string[]> = {};

  for (const [key, def] of Object.entries(CORE_SCHEMA)) {
    const schemaDefinition = asSchemaDefinition(def);
    const tableName = schemaDefinition.tableName || toSnakeCase(key);
    const columns = Object.keys(schemaDefinition.fields).map(toSnakeCase);
    result[tableName] = columns;
  }

  return result;
}

// =============================================================================
// Tests
// =============================================================================

describe('Schema Verification', () => {
  describe('verifySchema — valid schema', () => {
    it('should pass when all core tables and columns exist', async () => {
      const logger = createMockLogger();
      const schema = buildCompleteCoreSchema();
      const connection = createMockSqliteConnection(schema);

      const result = await verifySchema(connection, logger);

      expect(result.valid).toBe(true);
      expect(result.missingTables).toEqual([]);
      expect(result.missingColumns).toEqual([]);
      expect(result.verifiedTables.length).toBeGreaterThan(0);
      expect(logger.info).toHaveBeenCalledWith('Schema verification passed', expect.any(Object));
    });
  });

  describe('verifySchema — missing tables', () => {
    it('should detect missing tables', async () => {
      const logger = createMockLogger();
      // Empty database — no tables at all
      const connection = createMockSqliteConnection({});

      const result = await verifySchema(connection, logger);

      expect(result.valid).toBe(false);
      expect(result.missingTables.length).toBeGreaterThan(0);
      expect(result.missingTables).toContain(TABLE_NAMES.flows);
      expect(result.missingTables).toContain(TABLE_NAMES.flowRuns);
    });

    it('should detect a single missing table', async () => {
      const logger = createMockLogger();
      const schema = buildCompleteCoreSchema();
      // Remove one table
      delete schema[TABLE_NAMES.batchJobs];
      const connection = createMockSqliteConnection(schema);

      const result = await verifySchema(connection, logger);

      expect(result.valid).toBe(false);
      expect(result.missingTables).toEqual([TABLE_NAMES.batchJobs]);
      expect(result.verifiedTables).not.toContain(TABLE_NAMES.batchJobs);
    });
  });

  describe('verifySchema — missing columns', () => {
    it('should detect missing columns in an existing table', async () => {
      const logger = createMockLogger();
      const schema = buildCompleteCoreSchema();
      // Remove a column from the flows table
      schema[TABLE_NAMES.flows] = schema[TABLE_NAMES.flows].filter((col) => col !== 'description');
      const connection = createMockSqliteConnection(schema);

      const result = await verifySchema(connection, logger);

      expect(result.valid).toBe(false);
      expect(result.missingColumns).toContainEqual({
        table: TABLE_NAMES.flows,
        column: 'description',
      });
    });

    it('should detect multiple missing columns', async () => {
      const logger = createMockLogger();
      const schema = buildCompleteCoreSchema();
      // Remove multiple columns
      schema[TABLE_NAMES.flows] = ['id', 'name']; // Most columns missing
      const connection = createMockSqliteConnection(schema);

      const result = await verifySchema(connection, logger);

      expect(result.valid).toBe(false);
      expect(result.missingColumns.length).toBeGreaterThan(1);
      // Should detect missing columns like description, tags, is_active, etc.
      const missingCols = result.missingColumns
        .filter((c) => c.table === TABLE_NAMES.flows)
        .map((c) => c.column);
      expect(missingCols).toContain('is_active');
      expect(missingCols).toContain('created_at');
    });
  });

  describe('verifySchema — strict mode', () => {
    it('should throw in strict mode when schema is invalid', async () => {
      const logger = createMockLogger();
      const connection = createMockSqliteConnection({});

      await expect(verifySchema(connection, logger, { strict: true })).rejects.toThrow(
        'Schema verification failed',
      );
    });

    it('should not throw in non-strict mode (default)', async () => {
      const logger = createMockLogger();
      const connection = createMockSqliteConnection({});

      // Should not throw, just warn
      const result = await verifySchema(connection, logger);

      expect(result.valid).toBe(false);
      expect(logger.warn).toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('should log error in strict mode', async () => {
      const logger = createMockLogger();
      const connection = createMockSqliteConnection({});

      try {
        await verifySchema(connection, logger, { strict: true });
      } catch {
        // Expected
      }

      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('verifySchema — with plugins', () => {
    it('should verify plugin tables when plugins are provided', async () => {
      const logger = createMockLogger();
      const schema = buildCompleteCoreSchema();
      // Plugin adds a new table — but it's not in the database
      const connection = createMockSqliteConnection(schema);

      const plugin = {
        id: 'audit-log',
        schema: {
          auditLogs: {
            tableName: 'audit_logs',
            order: 200,
            fields: {
              id: { type: 'uuid' as const, primaryKey: true },
              action: { type: 'string' as const, required: true },
              createdAt: { type: 'date' as const },
            },
          },
        },
      };

      const result = await verifySchema(connection, logger, {
        plugins: [plugin as unknown as InvectPlugin],
      });

      expect(result.valid).toBe(false);
      expect(result.missingTables).toContain('audit_logs');
    });

    it('should pass when plugin tables exist in database', async () => {
      const logger = createMockLogger();
      const schema = buildCompleteCoreSchema();
      // Add the plugin table to the database
      schema['audit_logs'] = ['id', 'action', 'created_at'];
      const connection = createMockSqliteConnection(schema);

      const plugin = {
        id: 'audit-log',
        schema: {
          auditLogs: {
            tableName: 'audit_logs',
            order: 200,
            fields: {
              id: { type: 'uuid' as const, primaryKey: true },
              action: { type: 'string' as const, required: true },
              createdAt: { type: 'date' as const },
            },
          },
        },
      };

      const result = await verifySchema(connection, logger, {
        plugins: [plugin as unknown as InvectPlugin],
      });

      expect(result.valid).toBe(true);
      expect(result.verifiedTables).toContain('audit_logs');
    });
  });

  describe('verifySchema — helpful error messages', () => {
    it('should include migration instructions in warning', async () => {
      const logger = createMockLogger();
      const connection = createMockSqliteConnection({});

      await verifySchema(connection, logger);

      const warnCall = logger.warn.mock.calls[0]?.[0] as string;
      expect(warnCall).toContain('npx flowlib-cli generate');
      expect(warnCall).toContain('npx drizzle-kit push');
      expect(warnCall).toContain('Missing tables');
    });

    it('should include column details in warning', async () => {
      const logger = createMockLogger();
      const schema = buildCompleteCoreSchema();
      schema[TABLE_NAMES.flows] = ['id']; // Most columns missing
      const connection = createMockSqliteConnection(schema);

      await verifySchema(connection, logger);

      const warnCall = logger.warn.mock.calls[0]?.[0] as string;
      expect(warnCall).toContain('Missing columns');
      expect(warnCall).toContain(TABLE_NAMES.flows);
    });
  });
});
