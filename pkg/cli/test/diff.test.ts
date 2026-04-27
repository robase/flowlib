/**
 * Schema Diff & Change Detection Tests
 *
 * Tests the diffSchemas() utility and the CLI generator's ability to
 * detect unchanged files. These are crucial for the `npx flowlib-cli generate`
 * UX — only files that actually changed should be flagged for writing.
 */

import { describe, it, expect } from 'vitest';
import { mergeSchemas, diffSchemas } from '@flowlib/core';

import {
  multiTenantPlugin,
  auditLogPlugin,
  ecommercePlugin,
  minimalPlugin,
  coreExtensionPlugin,
} from './fixtures/example-schemas';

// =============================================================================
// 1. diffSchemas — comparing two merged schemas
// =============================================================================

describe('diffSchemas()', () => {
  it('should report everything as new when previous is null', () => {
    const current = mergeSchemas([]);
    const diff = diffSchemas(current, null);

    expect(diff.newTables.length).toBe(current.tables.length);
    expect(diff.newFields.length).toBe(0);
    expect(diff.unchangedTables.length).toBe(0);
  });

  it('should report new plugin tables', () => {
    const previous = mergeSchemas([]);
    const current = mergeSchemas([multiTenantPlugin]);
    const diff = diffSchemas(current, previous);

    const newTableNames = diff.newTables.map((t) => t.name);
    expect(newTableNames).toContain('tenants');
    expect(newTableNames).toContain('tenantMembers');
  });

  it('should report new fields added to existing tables', () => {
    const previous = mergeSchemas([]);
    const current = mergeSchemas([coreExtensionPlugin]);
    const diff = diffSchemas(current, previous);

    // coreExtensionPlugin adds ownerId, priority, category to flows
    const flowFields = diff.newFields.filter((f) => f.table === 'flows');
    const fieldNames = flowFields.map((f) => f.field);
    expect(fieldNames).toContain('ownerId');
    expect(fieldNames).toContain('priority');
    expect(fieldNames).toContain('category');

    // and rotatedAt, rotationPolicy to credentials
    const credFields = diff.newFields.filter((f) => f.table === 'credentials');
    expect(credFields.map((f) => f.field)).toContain('rotatedAt');
    expect(credFields.map((f) => f.field)).toContain('rotationPolicy');
  });

  it('should report unchanged tables when schemas are identical', () => {
    const schema = mergeSchemas([]);
    const diff = diffSchemas(schema, schema);

    expect(diff.newTables.length).toBe(0);
    expect(diff.newFields.length).toBe(0);
    expect(diff.unchangedTables.length).toBe(schema.tables.length);
  });

  it('should handle mixed changes (new tables + new fields + unchanged)', () => {
    const previous = mergeSchemas([]);
    const current = mergeSchemas([multiTenantPlugin]); // new tables + new field on flows
    const diff = diffSchemas(current, previous);

    // New tables: tenants, tenantMembers
    expect(diff.newTables.length).toBe(2);

    // New field: tenantId on flows
    expect(diff.newFields.length).toBeGreaterThanOrEqual(1);
    expect(diff.newFields.find((f) => f.field === 'tenantId')).toBeDefined();

    // Unchanged: all core tables except flows (which has a new field)
    expect(diff.unchangedTables.length).toBeGreaterThan(0);
    expect(diff.unchangedTables).not.toContain('flows');
  });

  it('should correctly diff when adding a second plugin', () => {
    const previous = mergeSchemas([minimalPlugin]);
    const current = mergeSchemas([minimalPlugin, auditLogPlugin]);
    const diff = diffSchemas(current, previous);

    // Only auditLogs is new; tags already existed
    const newTableNames = diff.newTables.map((t) => t.name);
    expect(newTableNames).toContain('auditLogs');
    expect(newTableNames).not.toContain('tags');

    // tags should be unchanged
    expect(diff.unchangedTables).toContain('tags');
  });
});

// =============================================================================
// 2. Provenance tracking across multiple plugins
// =============================================================================

describe('provenance tracking', () => {
  it('should track which source contributed each table', () => {
    const merged = mergeSchemas([ecommercePlugin, auditLogPlugin]);

    for (const table of merged.tables) {
      const tableProv = merged.provenance.find((p) => p.table === table.name && p.field === null);
      expect(tableProv, `missing provenance for table ${table.name}`).toBeDefined();
    }
  });

  it('should attribute new plugin fields correctly', () => {
    const merged = mergeSchemas([coreExtensionPlugin]);

    const ownerIdProv = merged.provenance.find((p) => p.table === 'flows' && p.field === 'ownerId');
    expect(ownerIdProv?.source).toBe('core-extension');

    // Core fields should still be attributed to 'core'
    const nameFieldProv = merged.provenance.find((p) => p.table === 'flows' && p.field === 'name');
    expect(nameFieldProv?.source).toBe('core');
  });

  it('should track provenance for all core fields', () => {
    const merged = mergeSchemas([]);

    // Every core field should have a provenance entry
    for (const table of merged.tables) {
      for (const fieldName of Object.keys(table.definition.fields)) {
        const prov = merged.provenance.find((p) => p.table === table.name && p.field === fieldName);
        expect(prov, `missing provenance for ${table.name}.${fieldName}`).toBeDefined();
        expect(prov!.source).toBe('core');
      }
    }
  });
});

// =============================================================================
// 3. Table ordering
// =============================================================================

describe('table ordering', () => {
  it('should respect the order property', () => {
    const merged = mergeSchemas([multiTenantPlugin]);
    const names = merged.tables.map((t) => t.name);

    // tenants (order: 5) should come before flows (order: 10)
    const tenantsIdx = names.indexOf('tenants');
    const flowsIdx = names.indexOf('flows');
    expect(tenantsIdx).toBeLessThan(flowsIdx);
  });

  it('should sort tables with the same order alphabetically', () => {
    const merged = mergeSchemas([ecommercePlugin]);
    const names = merged.tables.map((t) => t.name);

    // customers and products both have order: 70
    const customersIdx = names.indexOf('customers');
    const productsIdx = names.indexOf('products');
    expect(customersIdx).toBeLessThan(productsIdx);
  });

  it('should put higher-order tables at the end', () => {
    const merged = mergeSchemas([ecommercePlugin]);
    const names = merged.tables.map((t) => t.name);

    // orderItems (order: 90) should be after orders (order: 80)
    const ordersIdx = names.indexOf('orders');
    const itemsIdx = names.indexOf('orderItems');
    expect(ordersIdx).toBeLessThan(itemsIdx);
  });
});
