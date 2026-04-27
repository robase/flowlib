/**
 * Schema Merger
 *
 * Merges the core abstract schema with plugin schemas to produce a
 * unified abstract schema. The CLI schema generator then converts
 * this merged schema into dialect-specific Drizzle files.
 *
 * Handles:
 * - New plugin tables
 * - Plugin fields added to existing core tables (additive only)
 * - Duplicate field detection (throws error)
 * - Ordering by foreign key dependencies
 * - Optional `SchemaTransform`s that inject columns/indexes across many tables
 *   (e.g., a hosted multi-tenant variant injecting `organization_id` everywhere)
 */

import type {
  InvectPlugin,
  PluginFieldAttribute,
  PluginTableDefinition,
} from 'src/types/plugin.types';
import { CORE_SCHEMA, CORE_TABLE_NAMES } from './core-schema';

// =============================================================================
// Types
// =============================================================================

export interface MergedSchema {
  /** All tables (core + plugin) in dependency-resolved order */
  tables: MergedTable[];
  /** Which plugin contributed each table/field (for diagnostics) */
  provenance: SchemaProvenance[];
}

export interface MergedTable {
  /** Logical table name (camelCase) */
  name: string;
  /** The merged table definition */
  definition: PluginTableDefinition;
  /** Which source this table came from */
  source: 'core' | string; // 'core' or plugin ID
  /**
   * Composite/secondary indexes added by `SchemaTransform`s.
   * Single-column indexes declared via `PluginFieldAttribute.index` are still
   * carried on the field itself; this list is for transform-injected indexes
   * that may span multiple columns and have a deterministic name.
   */
  indexes?: TableIndex[];
}

/**
 * A table-level index injected by a `SchemaTransform`.
 *
 * The `name` is deterministic so generated dialect output is stable across
 * runs. The columns reference the **logical** field names (camelCase) — the
 * generator translates them to snake_case DB column names.
 */
export interface TableIndex {
  /** Deterministic index name, e.g. `idx_<table>_<col1>_<col2>` */
  name: string;
  /** Logical field names (camelCase) the index spans */
  columns: string[];
  /** Source transform name (for diagnostics) */
  source?: string;
}

/**
 * A reusable, declarative schema transform.
 *
 * Transforms run **after** the additive plugin merge and operate on the merged
 * schema. They are how a host (e.g., a multi-tenant hosted variant) injects a
 * cross-cutting column like `organization_id` into every table without forking
 * the merger or every plugin.
 *
 * @example Inject `organizationId` into every table and index it
 * ```typescript
 * const orgScopeTransform: SchemaTransform = {
 *   name: 'multi-tenant',
 *   injectColumns: {
 *     // default predicate (omit) → applies to every table
 *     columns: {
 *       organizationId: {
 *         type: 'string',
 *         required: true,
 *         references: { table: 'organization', field: 'id' },
 *       },
 *     },
 *   },
 *   injectIndexes: [{ columns: ['organizationId'] }],
 * };
 * ```
 */
export interface SchemaTransform {
  /** Identifier used in error messages and provenance — required for diagnostics */
  name: string;
  /** Inject columns into every (or filtered) table */
  injectColumns?: {
    /** If provided, only tables for which this returns true receive the columns */
    predicate?: (tableName: string) => boolean;
    /** Field-name → field-definition map, same shape as `PluginTableDefinition.fields` */
    columns: Record<string, PluginFieldAttribute>;
  };
  /** Add table-level indexes (each entry is one index spanning the listed columns) */
  injectIndexes?: {
    /** If provided, only tables for which this returns true receive the index */
    predicate?: (tableName: string) => boolean;
    /** Logical field names (camelCase) the index spans */
    columns: string[];
  }[];
}

/**
 * Thrown when a `SchemaTransform` tries to inject a column that already
 * exists on a target table.
 */
export class SchemaConflictError extends Error {
  readonly table: string;
  readonly column: string;
  readonly transform: string;

  constructor(args: { table: string; column: string; transform: string; existingSource?: string }) {
    const sourceClause = args.existingSource ? ` (defined by "${args.existingSource}")` : '';
    super(
      `Schema transform "${args.transform}" cannot inject column "${args.column}" on table ` +
        `"${args.table}" — a column with that name already exists${sourceClause}.`,
    );
    this.name = 'SchemaConflictError';
    this.table = args.table;
    this.column = args.column;
    this.transform = args.transform;
  }
}

export interface SchemaProvenance {
  /** Table name */
  table: string;
  /** Field name (null for table-level provenance) */
  field: string | null;
  /** Source: 'core' or plugin ID */
  source: string;
}

export interface SchemaMergeError {
  type: 'duplicate_field' | 'duplicate_table' | 'invalid_reference';
  message: string;
  table: string;
  field?: string;
  plugin: string;
}

// =============================================================================
// Merge Function
// =============================================================================

/**
 * Merge core schema with all plugin schemas, then apply any `SchemaTransform`s.
 *
 * @param plugins - Array of plugins (only those with `schema` are processed)
 * @param transforms - Optional transforms applied **after** the additive merge
 * @returns Merged schema with tables in dependency order
 * @throws Error if there are conflicting field definitions
 * @throws SchemaConflictError if a transform injects a column that already exists on a target table
 */
export function mergeSchemas(
  plugins: InvectPlugin[],
  transforms?: SchemaTransform[],
): MergedSchema {
  const errors: SchemaMergeError[] = [];
  const provenance: SchemaProvenance[] = [];

  // Start with a deep copy of the core schema
  const merged: Record<string, PluginTableDefinition> = {};
  const tableSources: Record<string, string> = {}; // table → source

  // Add core tables
  for (const [name, def] of Object.entries(CORE_SCHEMA)) {
    merged[name] = deepCopyTableDef(def);
    tableSources[name] = 'core';
    provenance.push({ table: name, field: null, source: 'core' });
    for (const fieldName of Object.keys(def.fields)) {
      provenance.push({ table: name, field: fieldName, source: 'core' });
    }
  }

  // Merge each plugin's schema
  for (const plugin of plugins) {
    if (!plugin.schema) {
      continue;
    }

    for (const [tableName, tableDef] of Object.entries(plugin.schema)) {
      if (tableDef.disableMigration) {
        continue;
      }

      const _isCoreTable = CORE_TABLE_NAMES.includes(tableName);
      const existsAlready = tableName in merged;

      if (existsAlready) {
        // Extending an existing table — merge fields additively
        const existing = merged[tableName];
        if (!existing) {
          continue;
        }

        for (const [fieldName, fieldDef] of Object.entries(tableDef.fields)) {
          if (fieldName in existing.fields) {
            // Field already exists — error unless it's from the same source
            const existingSource = provenance.find(
              (p) => p.table === tableName && p.field === fieldName,
            )?.source;

            if (existingSource && existingSource !== plugin.id) {
              errors.push({
                type: 'duplicate_field',
                message: `Field "${fieldName}" on table "${tableName}" already defined by "${existingSource}". Plugin "${plugin.id}" cannot override it.`,
                table: tableName,
                field: fieldName,
                plugin: plugin.id,
              });
            }
            continue; // Skip duplicate
          }

          // Add new field to existing table
          existing.fields[fieldName] = { ...fieldDef };
          provenance.push({ table: tableName, field: fieldName, source: plugin.id });
        }
      } else {
        // New table from plugin
        merged[tableName] = deepCopyTableDef(tableDef);
        tableSources[tableName] = plugin.id;
        provenance.push({ table: tableName, field: null, source: plugin.id });

        for (const fieldName of Object.keys(tableDef.fields)) {
          provenance.push({ table: tableName, field: fieldName, source: plugin.id });
        }
      }
    }
  }

  // Apply schema transforms (after additive merge, before FK validation so
  // injected references participate in FK validation).
  const indexesByTable: Record<string, TableIndex[]> = {};
  if (transforms && transforms.length > 0) {
    applyTransforms({
      transforms,
      merged,
      provenance,
      tableSources,
      indexesByTable,
    });
  }

  // Validate foreign key references
  for (const [tableName, tableDef] of Object.entries(merged)) {
    for (const [fieldName, fieldDef] of Object.entries(tableDef.fields)) {
      if (fieldDef.references) {
        // Check if the referenced table exists (by tableName property, not logical name)
        const refTableName = fieldDef.references.table;
        const refExists = Object.values(merged).some(
          (t) => t.tableName === refTableName || Object.keys(merged).includes(refTableName),
        );

        if (!refExists) {
          errors.push({
            type: 'invalid_reference',
            message: `Field "${fieldName}" on table "${tableName}" references table "${refTableName}" which does not exist.`,
            table: tableName,
            field: fieldName,
            plugin: tableSources[tableName] || 'unknown',
          });
        }
      }
    }
  }

  if (errors.length > 0) {
    const messages = errors.map((e) => `  - [${e.plugin}] ${e.message}`).join('\n');
    throw new Error(`Schema merge errors:\n${messages}`);
  }

  // Sort tables by order, then by name for stability
  const tables: MergedTable[] = Object.entries(merged)
    .map(([name, definition]) => ({
      name,
      definition,
      source: (tableSources[name] || 'core') as 'core' | string,
      indexes:
        indexesByTable[name] && indexesByTable[name].length > 0 ? indexesByTable[name] : undefined,
    }))
    .sort((a, b) => {
      const orderA = a.definition.order ?? 100;
      const orderB = b.definition.order ?? 100;
      if (orderA !== orderB) {
        return orderA - orderB;
      }
      return a.name.localeCompare(b.name);
    });

  return { tables, provenance };
}

// =============================================================================
// Transform Application
// =============================================================================

function applyTransforms(args: {
  transforms: SchemaTransform[];
  merged: Record<string, PluginTableDefinition>;
  provenance: SchemaProvenance[];
  tableSources: Record<string, string>;
  indexesByTable: Record<string, TableIndex[]>;
}): void {
  const { transforms, merged, provenance, tableSources, indexesByTable } = args;

  for (const transform of transforms) {
    if (!transform.name) {
      throw new Error('SchemaTransform requires a non-empty `name` for diagnostics.');
    }

    // Inject columns
    if (transform.injectColumns) {
      const { predicate, columns } = transform.injectColumns;
      for (const tableName of Object.keys(merged)) {
        if (predicate && !predicate(tableName)) {
          continue;
        }
        const target = merged[tableName];
        if (!target) {
          continue;
        }
        for (const [colName, colDef] of Object.entries(columns)) {
          if (colName in target.fields) {
            const existingSource = provenance.find(
              (p) => p.table === tableName && p.field === colName,
            )?.source;
            throw new SchemaConflictError({
              table: tableName,
              column: colName,
              transform: transform.name,
              existingSource,
            });
          }
          target.fields[colName] = { ...colDef };
          provenance.push({
            table: tableName,
            field: colName,
            source: `transform:${transform.name}`,
          });
        }
      }
    }

    // Inject indexes
    if (transform.injectIndexes) {
      for (const idx of transform.injectIndexes) {
        if (!Array.isArray(idx.columns) || idx.columns.length === 0) {
          continue;
        }
        for (const tableName of Object.keys(merged)) {
          if (idx.predicate && !idx.predicate(tableName)) {
            continue;
          }
          const target = merged[tableName];
          if (!target) {
            continue;
          }
          // Only add the index if every column actually exists on the target
          // table (post-injection). Otherwise it's silently skipped — this
          // matches the column-injection predicate semantics: an index that
          // refers to a column that wasn't injected on this table is a no-op.
          const allPresent = idx.columns.every((c) => c in target.fields);
          if (!allPresent) {
            continue;
          }
          const dbTableName = target.tableName || toSnakeCaseLocal(tableName);
          const colSegment = idx.columns.map((c) => toSnakeCaseLocal(c)).join('_');
          const indexName = `idx_${dbTableName}_${colSegment}`;
          // Dedupe by name in case the same transform is applied twice
          const list = indexesByTable[tableName] || (indexesByTable[tableName] = []);
          if (!list.some((i) => i.name === indexName)) {
            list.push({
              name: indexName,
              columns: [...idx.columns],
              source: transform.name,
            });
          }
        }
        // Track table source for diagnostics (no-op when table already known)
        // (reserved for future provenance enrichment)
        void tableSources;
      }
    }
  }
}

/** Local copy of the camelCase→snake_case helper used by the generators. */
function toSnakeCaseLocal(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

// =============================================================================
// Diff Utilities (for `npx flowlib-cli generate --diff` preview)
// =============================================================================

export interface SchemaDiff {
  newTables: { name: string; source: string }[];
  newFields: { table: string; field: string; source: string }[];
  unchangedTables: string[];
}

/**
 * Compare a merged schema against a "previous" schema (e.g., from last generation).
 * Used for preview/diff output in the CLI.
 */
export function diffSchemas(current: MergedSchema, previous: MergedSchema | null): SchemaDiff {
  const diff: SchemaDiff = {
    newTables: [],
    newFields: [],
    unchangedTables: [],
  };

  if (!previous) {
    // Everything is new
    diff.newTables = current.tables.map((t) => ({ name: t.name, source: t.source }));
    return diff;
  }

  const previousTableNames = new Set(previous.tables.map((t) => t.name));
  const previousFieldsByTable = new Map<string, Set<string>>();

  for (const table of previous.tables) {
    previousFieldsByTable.set(table.name, new Set(Object.keys(table.definition.fields)));
  }

  for (const table of current.tables) {
    if (!previousTableNames.has(table.name)) {
      diff.newTables.push({ name: table.name, source: table.source });
      continue;
    }

    const prevFields = previousFieldsByTable.get(table.name) || new Set();
    let hasNewFields = false;

    for (const fieldName of Object.keys(table.definition.fields)) {
      if (!prevFields.has(fieldName)) {
        diff.newFields.push({
          table: table.name,
          field: fieldName,
          source: table.source,
        });
        hasNewFields = true;
      }
    }

    if (!hasNewFields) {
      diff.unchangedTables.push(table.name);
    }
  }

  return diff;
}

// =============================================================================
// Helpers
// =============================================================================

function deepCopyTableDef(def: PluginTableDefinition): PluginTableDefinition {
  return {
    ...def,
    fields: Object.fromEntries(Object.entries(def.fields).map(([k, v]) => [k, { ...v }])),
    compositePrimaryKey: def.compositePrimaryKey ? [...def.compositePrimaryKey] : undefined,
  };
}
