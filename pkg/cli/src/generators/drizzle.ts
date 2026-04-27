/**
 * Drizzle Schema Generator
 *
 * Generates Drizzle ORM schema files from the merged abstract schema
 * (core + plugins). Produces dialect-specific TypeScript source code.
 *
 * This is the primary generator — Flowlib uses Drizzle exclusively.
 * The pattern generates dialect-specific Drizzle schema files from an abstract
 *   1. getAuthTables() → mergeSchemas() — merge core + plugin schemas
 *   2. Map abstract fields → dialect-specific Drizzle column code
 *   3. Return { code, fileName }
 *
 * Generates a single `flowlib.schema.ts` file for the user's selected dialect.
 */

import { existsSync, readFileSync } from 'node:fs';
import type { SchemaGenerator, SchemaGeneratorResult } from './types.js';

export const generateDrizzleSchema: SchemaGenerator = async ({
  plugins,
  file,
  dialect,
  transforms,
}) => {
  // Dynamically import @flowlib/core to avoid bundling it
  const { mergeSchemas, generateSqliteSchema, generatePostgresSchema, generateMysqlSchema } =
    await import('@flowlib/core');

  // Merge core + plugin schemas (with optional transforms)
  // oxlint-disable-next-line typescript/no-explicit-any -- plugins/transforms types from dynamic import don't match exactly
  const mergedSchema = mergeSchemas(plugins as any, transforms as any);

  // Select the right generator for the dialect
  const generators: Record<string, (schema: typeof mergedSchema) => string> = {
    sqlite: generateSqliteSchema,
    postgresql: generatePostgresSchema,
    mysql: generateMysqlSchema,
  };

  const generator = generators[dialect];
  if (!generator) {
    throw new Error(`Unsupported dialect "${dialect}". Expected one of: sqlite, postgresql, mysql`);
  }

  const code = generator(mergedSchema);

  const fileName = file || './db/flowlib.schema.ts';

  // Check if the file already exists with the same content
  if (existsSync(fileName)) {
    const existing = readFileSync(fileName, 'utf-8');
    if (existing === code) {
      return { code: undefined, fileName }; // No changes
    }
  }

  return { code, fileName, overwrite: existsSync(fileName) };
};

/**
 * Generate a single Drizzle schema file for the given dialect.
 *
 * This is the main entry point used by `npx flowlib-cli generate`.
 * Returns a single result for the specified dialect as `flowlib.schema.ts`.
 */
export async function generateAllDrizzleSchemas(options: {
  plugins: Array<{ id: string; schema?: Record<string, unknown>; [key: string]: unknown }>;
  outputDir?: string;
  dialect: 'sqlite' | 'postgresql' | 'mysql';
  /** Optional schema transforms (e.g., column injection for multi-tenancy) */
  transforms?: unknown[];
}): Promise<{
  results: SchemaGeneratorResult[];
  // oxlint-disable-next-line typescript/no-explicit-any -- merged schema type is opaque from dynamic import
  mergedSchema: any;
  stats: {
    totalTables: number;
    coreTableCount: number;
    pluginTableCount: number;
    pluginsWithSchema: number;
  };
}> {
  const { mergeSchemas, CORE_SCHEMA } = await import('@flowlib/core');

  // oxlint-disable-next-line typescript/no-explicit-any -- plugins/transforms types from dynamic import don't match exactly
  const mergedSchema = mergeSchemas(options.plugins as any, options.transforms as any);
  const coreTableCount = Object.keys(CORE_SCHEMA).length;
  const pluginsWithSchema = options.plugins.filter((p) => p.schema).length;

  const { generateSqliteSchema, generatePostgresSchema, generateMysqlSchema } =
    await import('@flowlib/core');

  const dir = options.outputDir || './db';

  const generators: Record<string, (schema: typeof mergedSchema) => string> = {
    sqlite: generateSqliteSchema,
    postgresql: generatePostgresSchema,
    mysql: generateMysqlSchema,
  };

  const generate = generators[options.dialect];
  if (!generate) {
    throw new Error(
      `Unsupported dialect "${options.dialect}". Expected one of: sqlite, postgresql, mysql`,
    );
  }

  const fileName = `${dir}/flowlib.schema.ts`;
  const code = generate(mergedSchema);
  const exists = existsSync(fileName);

  const results: SchemaGeneratorResult[] = [];

  if (exists) {
    const existing = readFileSync(fileName, 'utf-8');
    if (existing === code) {
      results.push({ code: undefined, fileName });
    } else {
      results.push({ code, fileName, overwrite: true });
    }
  } else {
    results.push({ code, fileName });
  }

  return {
    results,
    mergedSchema,
    stats: {
      totalTables: mergedSchema.tables.length,
      coreTableCount,
      pluginTableCount: mergedSchema.tables.length - coreTableCount,
      pluginsWithSchema,
    },
  };
}

/**
 * Generate Flowlib table definitions for appending to an existing schema file.
 *
 * This approach appends Flowlib tables into the user's existing schema file, instead of creating separate files,
 * generate only the table + relation code and append it to the user's
 * existing Drizzle schema file.
 *
 * Returns:
 *   - result.imports: import statements that may need to be added
 *   - result.code: table definitions, relations, and type exports
 *   - stats: generation statistics
 */
export async function generateAppendSchema(options: {
  plugins: Array<{ id: string; schema?: Record<string, unknown>; [key: string]: unknown }>;
  dialect: 'sqlite' | 'postgresql' | 'mysql';
  /** Optional schema transforms (e.g., column injection for multi-tenancy) */
  transforms?: unknown[];
}): Promise<{
  result: { imports: string[]; code: string };
  stats: {
    totalTables: number;
    coreTableCount: number;
    pluginTableCount: number;
  };
}> {
  const {
    mergeSchemas,
    CORE_SCHEMA,
    generateSqliteSchemaAppend,
    generatePostgresSchemaAppend,
    generateMysqlSchemaAppend,
  } = await import('@flowlib/core');

  // oxlint-disable-next-line typescript/no-explicit-any -- plugins/transforms types from dynamic import don't match exactly
  const mergedSchema = mergeSchemas(options.plugins as any, options.transforms as any);
  const coreTableCount = Object.keys(CORE_SCHEMA).length;

  const generators: Record<
    string,
    (schema: typeof mergedSchema) => { imports: string[]; code: string }
  > = {
    sqlite: generateSqliteSchemaAppend,
    postgresql: generatePostgresSchemaAppend,
    mysql: generateMysqlSchemaAppend,
  };

  const generator = generators[options.dialect];
  if (!generator) {
    throw new Error(
      `Unsupported dialect "${options.dialect}". Expected one of: sqlite, postgresql, mysql`,
    );
  }

  const result = generator(mergedSchema);

  return {
    result,
    stats: {
      totalTables: mergedSchema.tables.length,
      coreTableCount,
      pluginTableCount: mergedSchema.tables.length - coreTableCount,
    },
  };
}
