// oxlint-disable typescript/no-explicit-any -- @mrleebo/prisma-ast has no type definitions
/**
 * Prisma Schema Generator (CLI wrapper)
 *
 * Generates Prisma schema from the merged abstract schema (core + plugins).
 * Generates a complete Prisma schema from the merged abstract schema:
 *
 * 1. If a schema.prisma already exists, read it and ADD Flowlib models
 *    into it (using `@mrleebo/prisma-ast` to parse + produce the AST).
 * 2. If no schema.prisma exists, generate a complete file including
 *    generator + datasource blocks.
 * 3. Compare with existing file and return `code: undefined` if unchanged.
 *
 * This allows users to have their own Prisma models alongside Flowlib's
 * auto-generated ones — just like we preserve user models.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { produceSchema } from '@mrleebo/prisma-ast';
import type { PrismaProvider } from '@flowlib/db';
import type { SchemaGeneratorResult } from './types.js';

function isDebug(): boolean {
  return process.argv.includes('--debug');
}

function debug(...args: unknown[]) {
  if (isDebug()) {
    console.log(
      `  [debug] ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a, null, 2))).join(' ')}`,
    );
  }
}

// =============================================================================
// Prisma Version Detection
// =============================================================================

/**
 * Detect the major Prisma version from the project's package.json.
 * Returns null if Prisma is not installed.
 *
 * Checks both `prisma` and `@prisma/client` in dependencies/devDependencies.
 */
function getPrismaVersion(cwd?: string): number | null {
  try {
    const pkgPath = path.join(cwd || process.cwd(), 'package.json');
    if (!existsSync(pkgPath)) {
      return null;
    }
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    const version =
      pkg.dependencies?.prisma ||
      pkg.devDependencies?.prisma ||
      pkg.dependencies?.['@prisma/client'] ||
      pkg.devDependencies?.['@prisma/client'];
    if (!version) {
      return null;
    }
    // Extract major version from strings like "^7.0.0", "~5.1.0", "7.0.0"
    const match = version.match(/(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  } catch {
    return null;
  }
}

// =============================================================================
// Types
// =============================================================================

export interface PrismaSchemaGeneratorOptions {
  /** Resolved plugins from the config */
  plugins: Array<{
    id: string;
    name?: string;
    schema?: Record<string, unknown>;
    [key: string]: unknown;
  }>;
  /** Output file path (relative or absolute) */
  file?: string;
  /** Prisma provider: postgresql, mysql, sqlite */
  provider?: PrismaProvider;
}

// =============================================================================
// Main Generator
// =============================================================================

/**
 * Generate Prisma schema from merged abstract schema.
 *
 * If `file` points to an existing schema.prisma, Flowlib models are
 * merged into it (existing user models preserved). If the file does not
 * exist, a complete schema.prisma is produced.
 */
export async function generatePrismaSchema(
  options: PrismaSchemaGeneratorOptions,
): Promise<SchemaGeneratorResult> {
  // Dynamically import @flowlib/db to avoid bundling it
  const { mergeSchemas } = await import('@flowlib/db');

  // Merge core + plugin schemas
  const mergedSchema = mergeSchemas(options.plugins as any);

  debug('mergeSchemas result:', {
    tableCount: mergedSchema.tables?.length ?? 0,
    tableNames: mergedSchema.tables?.map((t: any) => t.name),
  });

  const provider = options.provider || 'postgresql';
  const filePath = options.file || './prisma/schema.prisma';
  const fileExists = existsSync(filePath);

  let code: string;

  if (fileExists) {
    // Existing schema — merge Flowlib models into it
    const existingContent = readFileSync(filePath, 'utf-8');
    debug('Existing schema length:', existingContent.length);
    code = mergeIntoExistingSchema(existingContent, mergedSchema, provider);
    debug('Merged schema length:', code.length);
  } else {
    // No existing schema — create a minimal base and merge into it.
    // This ensures the output format is identical to subsequent runs
    // (which always go through the merge path), making the generator
    // idempotent from the very first run.
    const baseSchema = generateMinimalPrismaBase(provider);
    code = mergeIntoExistingSchema(baseSchema, mergedSchema, provider);
  }

  // Compare with existing file content.
  // prisma-ast's produceSchema() normalizes whitespace/formatting, so we
  // compare the normalized (trimmed) output to detect actual schema changes
  // rather than formatting-only differences.
  if (fileExists) {
    const existingContent = readFileSync(filePath, 'utf-8');
    if (normalizeSchema(existingContent) === normalizeSchema(code)) {
      return { code: undefined, fileName: filePath };
    }
  }

  return {
    code,
    fileName: filePath,
    overwrite: fileExists,
  };
}

/**
 * Normalize a Prisma schema string for comparison purposes.
 * Strips trailing whitespace per line and collapses multiple blank lines,
 * so that prisma-ast formatting differences don't cause false positives.
 */
function normalizeSchema(schema: string): string {
  return schema
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Generate a minimal Prisma schema base with only generator + datasource.
 * Used as the starting point when no schema.prisma exists yet.
 *
 * Handles Prisma v7+ changes:
 * - Provider changes from "prisma-client-js" to "prisma-client"
 * - URL is configured in prisma.config.ts, not in the schema
 */
function generateMinimalPrismaBase(provider: PrismaProvider): string {
  const prismaVersion = getPrismaVersion();
  const isV7 = prismaVersion !== null && prismaVersion >= 7;
  const clientProvider = isV7 ? 'prisma-client' : 'prisma-client-js';

  if (isV7) {
    // Prisma v7+: no url in datasource (configured in prisma.config.ts)
    return `generator client {
  provider = "${clientProvider}"
}

datasource db {
  provider = "${provider}"
}
`;
  }

  const url = provider === 'sqlite' ? '"file:./dev.db"' : 'env("DATABASE_URL")';
  return `generator client {
  provider = "${clientProvider}"
}

datasource db {
  provider = "${provider}"
  url      = ${url}
}
`;
}

// =============================================================================
// Merge into Existing Schema (uses prisma-ast)
// =============================================================================

/**
 * Merge Flowlib models into an existing Prisma schema.
 *
 * Uses `@mrleebo/prisma-ast` to parse the existing schema, then adds
 * Flowlib models/fields that don't already exist. This preserves all
 * user-defined models, relations, and configuration.
 *
 * Generate the Prisma schema from the merged abstract schema.
 */
function mergeIntoExistingSchema(
  existingContent: string,
  mergedSchema: any, // MergedSchema from core
  provider: PrismaProvider,
): string {
  // Migrate existing schemas for Prisma v7+
  const prismaVersion = getPrismaVersion();
  const isV7 = prismaVersion !== null && prismaVersion >= 7;
  let contentToMerge = existingContent;

  if (isV7) {
    contentToMerge = produceSchema(contentToMerge, (builder: any) => {
      // Update generator provider
      const generator: any = builder.findByType('generator', { name: 'client' });
      if (generator?.assignments) {
        const providerProp = generator.assignments.find(
          (prop: any) => prop.type === 'assignment' && prop.key === 'provider',
        );
        if (providerProp && providerProp.value === '"prisma-client-js"') {
          providerProp.value = '"prisma-client"';
        }
      }
      // Remove url from datasource (now in prisma.config.ts)
      const datasource: any = builder.findByType('datasource', { name: 'db' });
      if (datasource?.assignments) {
        const urlIndex = datasource.assignments.findIndex(
          (prop: any) => prop.type === 'assignment' && prop.key === 'url',
        );
        if (urlIndex !== -1) {
          datasource.assignments.splice(urlIndex, 1);
        }
      }
    });
  }

  return produceSchema(contentToMerge, (builder: any) => {
    for (const table of mergedSchema.tables) {
      const modelName = capitalize(table.name);
      const existingModel = builder.findByType('model', { name: modelName });

      if (!existingModel) {
        // Model doesn't exist — create it with all fields
        // createPrismaModel also adds @@map, so no separate addTableMapping needed
        createPrismaModel(builder, table, mergedSchema, provider);
      } else {
        // Model exists — only add missing fields, then add @@map if needed
        addMissingFields(builder, existingModel, table, mergedSchema, provider);
        addTableMapping(builder, table, modelName, existingModel);
      }
    }
  });
}

// =============================================================================
// Model Creation (for new models)
// =============================================================================

function createPrismaModel(builder: any, table: any, schema: any, provider: PrismaProvider): void {
  const modelName = capitalize(table.name);
  const { definition } = table;

  // Track unique fields and indexes for block attributes (added after all fields)
  const uniqueFields: string[] = [];

  // Add all fields
  for (const [fieldName, field] of Object.entries(definition.fields) as [string, any][]) {
    const prismaType = getPrismaType(field, provider);
    const fieldBuilder = builder.model(modelName).field(fieldName, prismaType);

    // Chain all field-level attributes immediately — prisma-ast requires
    // that .attribute() calls happen directly in the chain after .field()

    // @id
    if (field.primaryKey) {
      fieldBuilder.attribute('id');
    }

    // @default
    addDefaultAttribute(fieldBuilder, field, fieldName, provider);

    // @updatedAt
    if (fieldName === 'updatedAt' && field.type === 'date') {
      fieldBuilder.attribute('updatedAt');
    }

    // @map (column name differs from field name)
    const dbColName = toSnakeCase(fieldName);
    if (dbColName !== fieldName) {
      fieldBuilder.attribute(`map("${dbColName}")`);
    }

    // @db annotations
    if (provider === 'mysql' && field.type === 'text') {
      fieldBuilder.attribute('db.Text');
    }
    if (provider === 'postgresql' && field.type === 'date') {
      fieldBuilder.attribute('db.Timestamptz(3)');
    }

    // Track unique for block attributes
    if (field.unique) {
      uniqueFields.push(fieldName);
    }
  }

  // Add relation fields AFTER all regular fields
  // One-side: this table has FK fields
  for (const [fieldName, field] of Object.entries(definition.fields) as [string, any][]) {
    if (!field.references) {
      continue;
    }

    const refLogical = findLogicalName(schema, field.references.table);
    const refModel = capitalize(refLogical);
    const relName = fieldName.replace(/Id$/, '').replace(/_id$/, '');
    const onDelete = mapOnDelete(field.references.onDelete);

    builder
      .model(modelName)
      .field(relName, `${refModel}${!field.required ? '?' : ''}`)
      .attribute(
        `relation(fields: [${fieldName}], references: [${field.references.field}], onDelete: ${onDelete})`,
      );
  }

  // Many-side: other tables have FKs pointing to this table
  for (const otherTable of schema.tables) {
    if (otherTable.name === table.name) {
      continue;
    }

    for (const [_, field] of Object.entries(otherTable.definition.fields) as [string, any][]) {
      if (!field.references) {
        continue;
      }

      const refsThisTable =
        field.references.table === table.name ||
        field.references.table === (definition.tableName || toSnakeCase(table.name));

      if (refsThisTable) {
        const otherModelName = capitalize(otherTable.name);
        // Unique FK = one-to-one (singular optional), otherwise one-to-many (array)
        const isUnique = field.unique === true;
        builder
          .model(modelName)
          .field(otherTable.name, `${otherModelName}${isUnique ? '?' : '[]'}`);
      }
    }
  }

  // Block-level attributes (@@unique, @@index, @@id, @@map)
  for (const fieldName of uniqueFields) {
    builder.model(modelName).blockAttribute(`unique([${fieldName}])`);
  }

  // @@index for indexed non-unique, non-PK fields
  for (const [fieldName, field] of Object.entries(definition.fields) as [string, any][]) {
    if (field.index && !field.unique && !field.primaryKey) {
      builder.model(modelName).blockAttribute(`index([${fieldName}])`);
    }
  }

  if (definition.compositePrimaryKey?.length) {
    builder.model(modelName).blockAttribute(`id([${definition.compositePrimaryKey.join(', ')}])`);
  }

  const dbTableName = definition.tableName || toSnakeCase(table.name);
  if (dbTableName !== table.name) {
    builder.model(modelName).blockAttribute('map', dbTableName);
  }
}

// =============================================================================
// Field Addition (for existing models)
// =============================================================================

function addMissingFields(
  builder: any,
  existingModel: any,
  table: any,
  schema: any,
  provider: PrismaProvider,
): void {
  const modelName = capitalize(table.name);
  const { definition } = table;
  const uniqueFields: string[] = [];

  for (const [fieldName, field] of Object.entries(definition.fields) as [string, any][]) {
    // Check if field already exists
    const isAlreadyExist = builder.findByType('field', {
      name: fieldName,
      within: existingModel.properties,
    });
    if (isAlreadyExist) {
      continue;
    }

    const prismaType = getPrismaType(field, provider);
    const fieldBuilder = builder.model(modelName).field(fieldName, prismaType);

    // Chain all field-level attributes immediately
    if (field.primaryKey) {
      fieldBuilder.attribute('id');
    }

    addDefaultAttribute(fieldBuilder, field, fieldName, provider);

    if (fieldName === 'updatedAt' && field.type === 'date') {
      fieldBuilder.attribute('updatedAt');
    }

    const dbColName = toSnakeCase(fieldName);
    if (dbColName !== fieldName) {
      fieldBuilder.attribute(`map("${dbColName}")`);
    }

    if (provider === 'mysql' && field.type === 'text') {
      fieldBuilder.attribute('db.Text');
    }
    if (provider === 'postgresql' && field.type === 'date') {
      fieldBuilder.attribute('db.Timestamptz(3)');
    }

    if (field.unique) {
      uniqueFields.push(fieldName);
    }
  }

  // Add relation fields after all regular fields
  for (const [fieldName, field] of Object.entries(definition.fields) as [string, any][]) {
    if (!field.references) {
      continue;
    }

    const isFieldAlreadyExist = builder.findByType('field', {
      name: fieldName,
      within: existingModel.properties,
    });
    // Only add relation if the FK field was newly added
    if (isFieldAlreadyExist) {
      continue;
    }

    const refLogical = findLogicalName(schema, field.references.table);
    const refModel = capitalize(refLogical);
    const relName = fieldName.replace(/Id$/, '').replace(/_id$/, '');
    const onDelete = mapOnDelete(field.references.onDelete);

    const relExists = builder.findByType('field', {
      name: relName,
      within: existingModel.properties,
    });

    if (!relExists) {
      builder
        .model(modelName)
        .field(relName, `${refModel}${!field.required ? '?' : ''}`)
        .attribute(
          `relation(fields: [${fieldName}], references: [${field.references.field}], onDelete: ${onDelete})`,
        );
    }
  }

  // Block-level attributes
  for (const fieldName of uniqueFields) {
    builder.model(modelName).blockAttribute(`unique([${fieldName}])`);
  }

  // @@index for indexed non-unique, non-PK fields (skip if already exists)
  for (const [fieldName, field] of Object.entries(definition.fields) as [string, any][]) {
    if (field.index && !field.unique && !field.primaryKey) {
      const indexExists = existingModel.properties?.some(
        (v: any) =>
          v.type === 'attribute' &&
          v.name === 'index' &&
          JSON.stringify(v.args?.[0]?.value)?.includes(fieldName),
      );
      if (!indexExists) {
        builder.model(modelName).blockAttribute(`index([${fieldName}])`);
      }
    }
  }
}

// =============================================================================
// Table Mapping
// =============================================================================

function addTableMapping(builder: any, table: any, modelName: string, existingModel: any): void {
  const dbTableName = table.definition.tableName || toSnakeCase(table.name);
  if (dbTableName === table.name) {
    return;
  }

  // Check if @@map already exists
  if (existingModel) {
    const hasMap = builder.findByType('attribute', {
      name: 'map',
      within: existingModel.properties,
    });
    if (hasMap) {
      return;
    }
  }

  builder.model(modelName).blockAttribute('map', dbTableName);
}

// =============================================================================
// Type Mapping
// =============================================================================

function getPrismaType(field: any, provider: PrismaProvider): string {
  const optional = field.required === false ? '?' : '';

  if (Array.isArray(field.type)) {
    // Enum — SQLite falls back to String
    return `String${optional}`;
  }

  switch (field.type) {
    case 'string':
    case 'text':
    case 'uuid':
      return `String${optional}`;
    case 'number':
      return `Int${optional}`;
    case 'bigint':
      return `BigInt${optional}`;
    case 'boolean':
      return `Boolean${optional}`;
    case 'date':
      return `DateTime${optional}`;
    case 'json':
      if (provider === 'sqlite') {
        return `String${optional}`;
      }
      return `Json${optional}`;
    default:
      return `String${optional}`;
  }
}

// =============================================================================
// Default Attributes
// =============================================================================

function addDefaultAttribute(
  fieldBuilder: any,
  field: any,
  fieldName: string,
  _provider: PrismaProvider,
): void {
  if (field.defaultValue === undefined) {
    return;
  }

  if (field.defaultValue === 'uuid()') {
    fieldBuilder.attribute('default(uuid())');
  } else if (field.defaultValue === 'now()') {
    // Only add @default(now()) for createdAt, not updatedAt (which uses @updatedAt)
    if (fieldName !== 'updatedAt') {
      fieldBuilder.attribute('default(now())');
    }
  } else if (typeof field.defaultValue === 'boolean') {
    fieldBuilder.attribute(`default(${field.defaultValue})`);
  } else if (typeof field.defaultValue === 'number') {
    fieldBuilder.attribute(`default(${field.defaultValue})`);
  } else if (typeof field.defaultValue === 'string') {
    fieldBuilder.attribute(`default("${field.defaultValue}")`);
  }
}

// =============================================================================
// Helpers
// =============================================================================

function mapOnDelete(onDelete?: string): string {
  switch (onDelete) {
    case 'cascade':
      return 'Cascade';
    case 'set null':
      return 'SetNull';
    case 'restrict':
      return 'Restrict';
    case 'no action':
      return 'NoAction';
    default:
      return 'NoAction';
  }
}

function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Find the logical (camelCase) table name from a DB table name.
 */
function findLogicalName(schema: any, tableRef: string): string {
  const exact = schema.tables.find((t: any) => t.name === tableRef);
  if (exact) {
    return exact.name;
  }

  const byDbName = schema.tables.find(
    (t: any) => t.definition.tableName === tableRef || toSnakeCase(t.name) === tableRef,
  );
  if (byDbName) {
    return byDbName.name;
  }

  if (tableRef.includes('_')) {
    return tableRef.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  }
  return tableRef;
}
