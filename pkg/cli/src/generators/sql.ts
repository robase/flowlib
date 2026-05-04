/**
 * Raw SQL Migration Generator
 *
 * Generates plain SQL CREATE TABLE statements from the merged abstract
 * schema (core + plugins). Produces a single .sql file for the selected dialect.
 *
 * This is for users who don't use an ORM and want to manage schema manually
 * or through their own migration tool.
 */

import { existsSync, readFileSync } from 'node:fs';
import type { SchemaGeneratorResult } from './types.js';

export async function generateRawSql(options: {
  plugins: Array<{ id: string; schema?: Record<string, unknown>; [key: string]: unknown }>;
  dialect: 'sqlite' | 'postgresql' | 'mysql';
  outputDir?: string;
  /** Optional schema transforms (e.g., column injection for multi-tenancy) */
  transforms?: unknown[];
}): Promise<{
  result: SchemaGeneratorResult;
  stats: {
    totalTables: number;
    coreTableCount: number;
    pluginTableCount: number;
  };
}> {
  const {
    mergeSchemas,
    CORE_SCHEMA,
    generateSqliteRawSql,
    generatePostgresRawSql,
    generateMysqlRawSql,
  } = await import('@flowlib/db');

  // oxlint-disable-next-line typescript/no-explicit-any -- plugins/transforms types from dynamic import don't match exactly
  const mergedSchema = mergeSchemas(options.plugins as any, options.transforms as any);
  const coreTableCount = Object.keys(CORE_SCHEMA).length;

  const generators: Record<string, (schema: typeof mergedSchema) => string> = {
    sqlite: generateSqliteRawSql,
    postgresql: generatePostgresRawSql,
    mysql: generateMysqlRawSql,
  };

  const generator = generators[options.dialect];
  if (!generator) {
    throw new Error(
      `Unsupported dialect "${options.dialect}". Expected one of: sqlite, postgresql, mysql`,
    );
  }

  const code = generator(mergedSchema);

  const dialectFileNames: Record<string, string> = {
    sqlite: 'flowlib-migration-sqlite.sql',
    postgresql: 'flowlib-migration-postgres.sql',
    mysql: 'flowlib-migration-mysql.sql',
  };

  const dir = options.outputDir || '.';
  const fileName = `${dir}/${dialectFileNames[options.dialect]}`;

  // Check for unchanged content
  if (existsSync(fileName)) {
    const existing = readFileSync(fileName, 'utf-8');
    if (existing === code) {
      return {
        result: { code: undefined, fileName },
        stats: {
          totalTables: mergedSchema.tables.length,
          coreTableCount,
          pluginTableCount: mergedSchema.tables.length - coreTableCount,
        },
      };
    }
  }

  return {
    result: { code, fileName, overwrite: existsSync(fileName) },
    stats: {
      totalTables: mergedSchema.tables.length,
      coreTableCount,
      pluginTableCount: mergedSchema.tables.length - coreTableCount,
    },
  };
}
