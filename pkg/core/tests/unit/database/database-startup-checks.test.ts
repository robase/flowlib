/**
 * Unit tests for DatabaseService startup checks
 *
 * Tests the automatic database health checks that run during initialization:
 * - Core table existence check (always runs)
 * - Plugin table existence check (runs when plugins declare requiredTables)
 * - Clear error messages for missing tables
 * - Connectivity verification
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CORE_SCHEMA } from '@flowlib/db';
import type { FlowlibPlugin } from '../../../src/types/plugin.types';

// We test the DatabaseService indirectly by importing it and mocking its deps
// Since the startup checks are private methods called from initialize(),
// we test them via the public initialize() path.

// Build expected table names from the abstract schema
const EXPECTED_TABLE_NAMES: string[] = [];
for (const def of Object.values(CORE_SCHEMA)) {
  const tableDef = def as { tableName?: string; disableMigration?: boolean };
  if (!tableDef.disableMigration && tableDef.tableName) {
    EXPECTED_TABLE_NAMES.push(tableDef.tableName);
  }
}

function createMockLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

/**
 * Minimal mock for DatabaseConnectionFactory to avoid real DB connections.
 */
function mockConnectionFactory(opts: {
  tables?: string[];
  connectError?: Error;
  queryError?: Error;
}) {
  const { tables = [], connectError, queryError } = opts;

  // Mock the connection object returned by the factory
  const mockConnection = {
    type: 'sqlite' as const,
    db: {},
    schema: {},
    driver: {
      type: 'better-sqlite3' as const,
      async queryAll(sql: string) {
        if (queryError) {
          throw queryError;
        }
        if (sql.includes('SELECT 1') || sql.includes('health')) {
          return [{ health: 1 }];
        }
        if (sql.includes('sqlite_master')) {
          return tables.map((name: string) => ({ name }));
        }
        return [];
      },
      async execute() {
        if (queryError) {
          throw queryError;
        }
        return { changes: 0 };
      },
      close() {},
    },
  };

  // Mock the factory
  vi.doMock('../../../src/database/connection', () => ({
    DatabaseConnectionFactory: {
      createHostDBConnection: connectError
        ? vi.fn().mockRejectedValue(connectError)
        : vi.fn().mockResolvedValue(mockConnection),
    },
  }));

  return mockConnection;
}

// =============================================================================
// Tests
// =============================================================================

describe('DatabaseService startup checks', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  describe('core table check', () => {
    it('should throw with helpful message when database has no tables', async () => {
      mockConnectionFactory({ tables: [] });

      const { DatabaseService } = await import('../../../src/services/database/database.service');
      const logger = createMockLogger();
      const service = new DatabaseService(
        { type: 'sqlite', connectionString: 'file:./test.db', name: 'Test' },
        logger,
      );

      await expect(service.initialize()).rejects.toThrow(/missing.*all.*required/i);

      // Should have logged the big banner
      expect(logger.error).toHaveBeenCalled();
      const errorCall = logger.error.mock.calls[0][0] as string;
      expect(errorCall).toContain('DATABASE NOT READY');
      expect(errorCall).toContain('npx flowlib-cli generate');
    });

    it('should throw with helpful message when some tables are missing', async () => {
      // Provide only a subset of expected tables
      const partialTables = EXPECTED_TABLE_NAMES.slice(0, 3);
      mockConnectionFactory({ tables: partialTables });

      const { DatabaseService } = await import('../../../src/services/database/database.service');
      const logger = createMockLogger();
      const service = new DatabaseService(
        { type: 'sqlite', connectionString: 'file:./test.db', name: 'Test' },
        logger,
      );

      await expect(service.initialize()).rejects.toThrow(/missing.*table/i);

      const errorCall = logger.error.mock.calls[0][0] as string;
      expect(errorCall).toContain('DATABASE NOT READY');
      // Should mention the specific missing tables
      const missingTables = EXPECTED_TABLE_NAMES.filter((t) => !partialTables.includes(t));
      expect(errorCall).toContain(missingTables[0]);
    });

    it('should succeed when all tables exist', async () => {
      mockConnectionFactory({ tables: EXPECTED_TABLE_NAMES });

      const { DatabaseService } = await import('../../../src/services/database/database.service');
      const logger = createMockLogger();
      const service = new DatabaseService(
        { type: 'sqlite', connectionString: 'file:./test.db', name: 'Test' },
        logger,
      );

      await service.initialize();

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Database service initialized successfully'),
      );
      expect(logger.error).not.toHaveBeenCalled();
    });
  });

  describe('connection error handling', () => {
    it('should log helpful message when connection fails', async () => {
      mockConnectionFactory({
        connectError: new Error('SQLITE_CANTOPEN: unable to open database file'),
      });

      const { DatabaseService } = await import('../../../src/services/database/database.service');
      const logger = createMockLogger();
      const service = new DatabaseService(
        { type: 'sqlite', connectionString: 'file:./bad/path.db', name: 'Test' },
        logger,
      );

      await expect(service.initialize()).rejects.toThrow(/Failed to connect/);

      const allErrorMessages = logger.error.mock.calls
        .map((c: unknown[]) => String(c[0]))
        .join('\n');
      expect(allErrorMessages.toUpperCase()).toContain('DATABASE CONNECTION FAILED');
      expect(allErrorMessages).toContain('sqlite');
    });

    it('should redact passwords in PostgreSQL connection strings', async () => {
      mockConnectionFactory({
        connectError: new Error('ECONNREFUSED'),
      });

      const { DatabaseService } = await import('../../../src/services/database/database.service');
      const logger = createMockLogger();
      const service = new DatabaseService(
        {
          type: 'postgresql',
          connectionString: 'postgres://user:s3cret_pass@localhost:5432/mydb',
          name: 'Test',
        },
        logger,
      );

      await expect(service.initialize()).rejects.toThrow();

      const allErrorArgs = logger.error.mock.calls.map((c: unknown[]) => String(c[0])).join(' ');
      // The redacted connection string may appear in an info or error call
      const allArgs = [
        ...logger.info.mock.calls.map((c: unknown[]) => JSON.stringify(c)),
        ...logger.error.mock.calls.map((c: unknown[]) => JSON.stringify(c)),
      ].join(' ');
      expect(allArgs).toContain('***'); // password is redacted
      expect(allArgs).not.toContain('s3cret_pass');
    });
  });

  describe('connectivity check', () => {
    it('should throw with helpful message when SELECT 1 fails', async () => {
      mockConnectionFactory({
        queryError: new Error('database is locked'),
      });

      const { DatabaseService } = await import('../../../src/services/database/database.service');
      const logger = createMockLogger();
      const service = new DatabaseService(
        { type: 'sqlite', connectionString: 'file:./test.db', name: 'Test' },
        logger,
      );

      await expect(service.initialize()).rejects.toThrow(/connectivity check failed/);

      const allErrorMessages = logger.error.mock.calls
        .map((c: unknown[]) => String(c[0]))
        .join('\n');
      expect(allErrorMessages.toUpperCase()).toContain('CONNECTIVITY CHECK FAILED');
      expect(allErrorMessages).toContain('database is locked');
    });
  });

  describe('plugin table checks', () => {
    it('should throw with helpful message when plugin tables are missing', async () => {
      // All core tables exist, but plugin tables are missing
      mockConnectionFactory({ tables: EXPECTED_TABLE_NAMES });

      const { DatabaseService } = await import('../../../src/services/database/database.service');
      const logger = createMockLogger();
      const plugins: FlowlibPlugin[] = [
        {
          id: 'user-auth',
          name: 'User Auth',
          requiredTables: ['user', 'session', 'account', 'verification'],
          setupInstructions: 'Add user-auth tables to your schema, then run: pnpm db:push',
        },
      ];
      const service = new DatabaseService(
        { type: 'sqlite', connectionString: 'file:./test.db', name: 'Test' },
        logger,
        undefined,
        plugins,
      );

      await expect(service.initialize()).rejects.toThrow(/missing.*table.*plugin/i);

      const errorCall = logger.error.mock.calls[0][0] as string;
      expect(errorCall).toContain('PLUGIN TABLES MISSING');
      expect(errorCall).toContain('User Auth');
      expect(errorCall).toContain('user');
      expect(errorCall).toContain('session');
    });

    it('should include custom setup instructions from plugin', async () => {
      mockConnectionFactory({ tables: EXPECTED_TABLE_NAMES });

      const { DatabaseService } = await import('../../../src/services/database/database.service');
      const logger = createMockLogger();
      const plugins: FlowlibPlugin[] = [
        {
          id: 'my-plugin',
          name: 'My Plugin',
          requiredTables: ['my_table'],
          setupInstructions: 'Run `npx flowlib-cli generate` then `npx drizzle-kit push`',
        },
      ];
      const service = new DatabaseService(
        { type: 'sqlite', connectionString: 'file:./test.db', name: 'Test' },
        logger,
        undefined,
        plugins,
      );

      await expect(service.initialize()).rejects.toThrow();

      const errorCall = logger.error.mock.calls[0][0] as string;
      expect(errorCall).toContain('npx flowlib-cli generate');
    });

    it('should succeed when all plugin tables exist', async () => {
      const allTables = [...EXPECTED_TABLE_NAMES, 'user', 'session', 'account', 'verification'];
      mockConnectionFactory({ tables: allTables });

      const { DatabaseService } = await import('../../../src/services/database/database.service');
      const logger = createMockLogger();
      const plugins: FlowlibPlugin[] = [
        {
          id: 'user-auth',
          name: 'User Auth',
          requiredTables: ['user', 'session', 'account', 'verification'],
        },
      ];
      const service = new DatabaseService(
        { type: 'sqlite', connectionString: 'file:./test.db', name: 'Test' },
        logger,
        undefined,
        plugins,
      );

      await service.initialize();

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Database service initialized successfully'),
      );
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('should report multiple plugins with missing tables', async () => {
      mockConnectionFactory({ tables: EXPECTED_TABLE_NAMES });

      const { DatabaseService } = await import('../../../src/services/database/database.service');
      const logger = createMockLogger();
      const plugins: FlowlibPlugin[] = [
        {
          id: 'auth',
          name: 'Auth Plugin',
          requiredTables: ['user', 'session'],
        },
        {
          id: 'audit',
          name: 'Audit Log',
          requiredTables: ['audit_logs'],
        },
      ];
      const service = new DatabaseService(
        { type: 'sqlite', connectionString: 'file:./test.db', name: 'Test' },
        logger,
        undefined,
        plugins,
      );

      await expect(service.initialize()).rejects.toThrow();

      const errorCall = logger.error.mock.calls[0][0] as string;
      expect(errorCall).toContain('Auth Plugin');
      expect(errorCall).toContain('Audit Log');
      expect(errorCall).toContain('audit_logs');
    });

    it('should infer requiredTables from plugin schema if not explicitly set', async () => {
      mockConnectionFactory({ tables: EXPECTED_TABLE_NAMES });

      const { DatabaseService } = await import('../../../src/services/database/database.service');
      const logger = createMockLogger();
      const plugins: FlowlibPlugin[] = [
        {
          id: 'custom-plugin',
          name: 'Custom Plugin',
          // No requiredTables, but has schema
          schema: {
            customRecords: {
              tableName: 'custom_records',
              fields: {
                id: { type: 'uuid', primaryKey: true },
                name: { type: 'string', required: true },
              },
            },
          },
        },
      ];
      const service = new DatabaseService(
        { type: 'sqlite', connectionString: 'file:./test.db', name: 'Test' },
        logger,
        undefined,
        plugins,
      );

      await expect(service.initialize()).rejects.toThrow();

      const errorCall = logger.error.mock.calls[0][0] as string;
      expect(errorCall).toContain('Custom Plugin');
      expect(errorCall).toContain('custom_records');
    });

    it('should skip plugin table check when no plugins declare tables', async () => {
      mockConnectionFactory({ tables: EXPECTED_TABLE_NAMES });

      const { DatabaseService } = await import('../../../src/services/database/database.service');
      const logger = createMockLogger();
      const plugins: FlowlibPlugin[] = [
        {
          id: 'simple-plugin',
          // No requiredTables and no schema
        },
      ];
      const service = new DatabaseService(
        { type: 'sqlite', connectionString: 'file:./test.db', name: 'Test' },
        logger,
        undefined,
        plugins,
      );

      await service.initialize();

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Database service initialized successfully'),
      );
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('should only report missing tables, not ones that exist', async () => {
      // Core tables + some plugin tables exist
      const tables = [...EXPECTED_TABLE_NAMES, 'user', 'session'];
      mockConnectionFactory({ tables });

      const { DatabaseService } = await import('../../../src/services/database/database.service');
      const logger = createMockLogger();
      const plugins: FlowlibPlugin[] = [
        {
          id: 'user-auth',
          name: 'User Auth',
          requiredTables: ['user', 'session', 'account', 'verification'],
        },
      ];
      const service = new DatabaseService(
        { type: 'sqlite', connectionString: 'file:./test.db', name: 'Test' },
        logger,
        undefined,
        plugins,
      );

      await expect(service.initialize()).rejects.toThrow();

      const errorCall = logger.error.mock.calls[0][0] as string;
      // Should mention the missing tables
      expect(errorCall).toContain('account');
      expect(errorCall).toContain('verification');
    });
  });

  describe('extractPluginTableRequirements', () => {
    it('should extract from requiredTables', async () => {
      // Import directly for static method testing
      mockConnectionFactory({ tables: [] });
      const { DatabaseService } = await import('../../../src/services/database/database.service');

      const plugins: FlowlibPlugin[] = [
        {
          id: 'test-plugin',
          name: 'Test',
          requiredTables: ['foo', 'bar'],
          setupInstructions: 'Do something',
        },
      ];

      const result = DatabaseService.extractPluginTableRequirements(plugins);
      expect(result).toHaveLength(1);
      expect(result[0].pluginId).toBe('test-plugin');
      expect(result[0].tables).toEqual(['foo', 'bar']);
      expect(result[0].setupInstructions).toBe('Do something');
    });

    it('should infer from schema when no requiredTables', async () => {
      mockConnectionFactory({ tables: [] });
      const { DatabaseService } = await import('../../../src/services/database/database.service');

      const plugins: FlowlibPlugin[] = [
        {
          id: 'schema-plugin',
          schema: {
            myTable: {
              tableName: 'my_table',
              fields: { id: { type: 'string', primaryKey: true } },
            },
            anotherTable: {
              fields: { id: { type: 'string', primaryKey: true } },
            },
          },
        },
      ];

      const result = DatabaseService.extractPluginTableRequirements(plugins);
      expect(result).toHaveLength(1);
      // my_table from explicit tableName, anotherTable from key
      expect(result[0].tables).toContain('my_table');
      expect(result[0].tables).toContain('anotherTable');
    });

    it('should prefer requiredTables over schema', async () => {
      mockConnectionFactory({ tables: [] });
      const { DatabaseService } = await import('../../../src/services/database/database.service');

      const plugins: FlowlibPlugin[] = [
        {
          id: 'both',
          requiredTables: ['explicit_table'],
          schema: {
            ignoredTable: {
              tableName: 'ignored',
              fields: { id: { type: 'string', primaryKey: true } },
            },
          },
        },
      ];

      const result = DatabaseService.extractPluginTableRequirements(plugins);
      expect(result).toHaveLength(1);
      expect(result[0].tables).toEqual(['explicit_table']);
    });

    it('should skip plugins with no tables and no schema', async () => {
      mockConnectionFactory({ tables: [] });
      const { DatabaseService } = await import('../../../src/services/database/database.service');

      const plugins: FlowlibPlugin[] = [
        { id: 'no-tables' },
        { id: 'with-tables', requiredTables: ['t1'] },
      ];

      const result = DatabaseService.extractPluginTableRequirements(plugins);
      expect(result).toHaveLength(1);
      expect(result[0].pluginId).toBe('with-tables');
    });
  });
});
