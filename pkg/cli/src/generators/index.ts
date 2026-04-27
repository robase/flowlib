/**
 * Schema Generators — Router
 *
 * Barrel export for all schema generators.
 * Routes to the appropriate generator based on adapter type.
 *
 * Supports both Drizzle and Prisma generators.
 * The router pattern allows easy addition of further generators
 * (e.g., Kysely) in the future.
 */

import { generateDrizzleSchema, generateAllDrizzleSchemas } from './drizzle.js';
import { generatePrismaSchema } from './prisma.js';
import type { SchemaGeneratorResult } from './types.js';

export const adapters = {
  drizzle: generateDrizzleSchema,
  prisma: generatePrismaSchema,
} as const;

/**
 * Route to the correct generator based on adapter ID.
 *
 * @example
 * ```ts
 * // Drizzle
 * const result = await generateSchema({
 *   adapter: 'drizzle',
 *   dialect: 'sqlite',
 *   plugins: config.plugins,
 *   file: './schema-sqlite.ts',
 * });
 *
 * // Prisma
 * const result = await generateSchema({
 *   adapter: 'prisma',
 *   plugins: config.plugins,
 *   provider: 'postgresql',
 *   file: './prisma/schema.prisma',
 * });
 * ```
 */
export async function generateSchema(opts: {
  adapter: keyof typeof adapters;
  /** Drizzle dialect (required for drizzle adapter) */
  dialect?: 'sqlite' | 'postgresql' | 'mysql';
  /** Prisma provider (required for prisma adapter) */
  provider?: 'postgresql' | 'mysql' | 'sqlite';
  plugins: Array<{ id: string; schema?: Record<string, unknown>; [key: string]: unknown }>;
  file?: string;
}): Promise<SchemaGeneratorResult> {
  if (opts.adapter === 'prisma') {
    return generatePrismaSchema({
      plugins: opts.plugins,
      file: opts.file,
      provider: opts.provider,
    });
  }

  if (opts.adapter === 'drizzle') {
    if (!opts.dialect) {
      throw new Error('dialect is required for the drizzle adapter');
    }
    return generateDrizzleSchema({
      plugins: opts.plugins,
      file: opts.file,
      dialect: opts.dialect,
    });
  }

  throw new Error(
    `Unsupported adapter "${opts.adapter}". Flowlib supports: ${Object.keys(adapters).join(', ')}`,
  );
}

// Re-export everything
export {
  generateDrizzleSchema,
  generateAllDrizzleSchemas,
  generateAppendSchema,
} from './drizzle.js';
export { generatePrismaSchema } from './prisma.js';
export { generateRawSql } from './sql.js';
export type { PrismaSchemaGeneratorOptions } from './prisma.js';
export type { SchemaGenerator, SchemaGeneratorResult, SchemaGeneratorOptions } from './types.js';
