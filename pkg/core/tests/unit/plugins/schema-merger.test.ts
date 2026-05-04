/**
 * Unit tests for Schema Merger
 */

import { describe, it, expect } from 'vitest';
import { mergeSchemas, diffSchemas } from '@flowlib/db';
import type { FlowlibPlugin } from '../../../src/types/plugin.types';

describe('Schema Merger', () => {
  describe('mergeSchemas', () => {
    it('should return core schema when no plugins provided', () => {
      const merged = mergeSchemas([]);
      expect(merged.tables.length).toBeGreaterThan(0);

      // Core tables should be present
      const tableNames = merged.tables.map((t) => t.name);
      expect(tableNames).toContain('flows');
      expect(tableNames).toContain('flowVersions');
      expect(tableNames).toContain('flowRuns');
    });

    it('should add a new table from a plugin', () => {
      const plugin: FlowlibPlugin = {
        id: 'audit-log',
        schema: {
          auditLogs: {
            order: 200,
            fields: {
              id: { type: 'uuid', primaryKey: true, defaultValue: 'uuid()' },
              action: { type: 'string', required: true },
              userId: { type: 'string', required: false },
              createdAt: { type: 'date', defaultValue: 'now()' },
            },
          },
        },
      };

      const merged = mergeSchemas([plugin]);
      const tableNames = merged.tables.map((t) => t.name);
      expect(tableNames).toContain('auditLogs');

      const auditTable = merged.tables.find((t) => t.name === 'auditLogs')!;
      expect(auditTable.source).toBe('audit-log');
      expect(Object.keys(auditTable.definition.fields)).toContain('action');
    });

    it('should extend an existing core table with new fields', () => {
      const plugin: FlowlibPlugin = {
        id: 'rbac',
        schema: {
          flows: {
            fields: {
              ownerId: { type: 'string', required: false },
              tenantId: { type: 'string', required: false, index: true },
            },
          },
        },
      };

      const merged = mergeSchemas([plugin]);
      const flowsTable = merged.tables.find((t) => t.name === 'flows')!;
      expect(Object.keys(flowsTable.definition.fields)).toContain('ownerId');
      expect(Object.keys(flowsTable.definition.fields)).toContain('tenantId');
      // Original core fields should still be present
      expect(Object.keys(flowsTable.definition.fields)).toContain('name');
    });

    it('should throw on duplicate field from different plugins', () => {
      const plugin1: FlowlibPlugin = {
        id: 'plugin-a',
        schema: {
          flows: {
            fields: {
              customField: { type: 'string' },
            },
          },
        },
      };

      const plugin2: FlowlibPlugin = {
        id: 'plugin-b',
        schema: {
          flows: {
            fields: {
              customField: { type: 'number' },
            },
          },
        },
      };

      expect(() => mergeSchemas([plugin1, plugin2])).toThrow('Schema merge errors');
    });

    it('should track provenance for all tables and fields', () => {
      const plugin: FlowlibPlugin = {
        id: 'test-plugin',
        schema: {
          customTable: {
            fields: {
              id: { type: 'uuid', primaryKey: true },
              value: { type: 'string' },
            },
          },
        },
      };

      const merged = mergeSchemas([plugin]);

      // Plugin table should have provenance
      const tableProv = merged.provenance.find(
        (p) => p.table === 'customTable' && p.field === null,
      );
      expect(tableProv?.source).toBe('test-plugin');

      // Plugin field should have provenance
      const fieldProv = merged.provenance.find(
        (p) => p.table === 'customTable' && p.field === 'value',
      );
      expect(fieldProv?.source).toBe('test-plugin');
    });

    it('should skip tables with disableMigration', () => {
      const plugin: FlowlibPlugin = {
        id: 'skip-test',
        schema: {
          tempData: {
            disableMigration: true,
            fields: {
              id: { type: 'uuid', primaryKey: true },
            },
          },
        },
      };

      const merged = mergeSchemas([plugin]);
      const tableNames = merged.tables.map((t) => t.name);
      expect(tableNames).not.toContain('tempData');
    });

    it('should sort tables by order field', () => {
      const merged = mergeSchemas([]);
      const orders = merged.tables.map((t) => t.definition.order ?? 100);

      // Should be in non-decreasing order
      for (let i = 1; i < orders.length; i++) {
        expect(orders[i]!).toBeGreaterThanOrEqual(orders[i - 1]!);
      }
    });
  });

  describe('diffSchemas', () => {
    it('should treat everything as new when previous is null', () => {
      const current = mergeSchemas([]);
      const diff = diffSchemas(current, null);
      expect(diff.newTables.length).toBe(current.tables.length);
      expect(diff.newFields).toHaveLength(0);
      expect(diff.unchangedTables).toHaveLength(0);
    });

    it('should detect new tables from plugins', () => {
      const previous = mergeSchemas([]);
      const plugin: FlowlibPlugin = {
        id: 'new-table',
        schema: {
          analytics: {
            fields: {
              id: { type: 'uuid', primaryKey: true },
            },
          },
        },
      };
      const current = mergeSchemas([plugin]);

      const diff = diffSchemas(current, previous);
      expect(diff.newTables.map((t) => t.name)).toContain('analytics');
    });

    it('should detect new fields on existing tables', () => {
      const previous = mergeSchemas([]);
      const plugin: FlowlibPlugin = {
        id: 'field-adder',
        schema: {
          flows: {
            fields: {
              ownerId: { type: 'string', required: false },
            },
          },
        },
      };
      const current = mergeSchemas([plugin]);

      const diff = diffSchemas(current, previous);
      const newFlowFields = diff.newFields.filter((f) => f.table === 'flows');
      expect(newFlowFields.map((f) => f.field)).toContain('ownerId');
    });

    it('should mark unchanged tables correctly', () => {
      const schema = mergeSchemas([]);
      const diff = diffSchemas(schema, schema);
      expect(diff.newTables).toHaveLength(0);
      expect(diff.newFields).toHaveLength(0);
      expect(diff.unchangedTables.length).toBe(schema.tables.length);
    });
  });
});
