/**
 * Programmatic API for @flowlib/cli
 *
 * Programmatic API for the Flowlib CLI generators.
 * Import this to use schema generators in tests or build scripts.
 *
 * @example
 * ```ts
 * import { generateSchema, generateAllDrizzleSchemas } from '@flowlib/cli/api';
 *
 * const result = await generateSchema({
 *   adapter: 'drizzle',
 *   dialect: 'sqlite',
 *   plugins: myPlugins,
 * });
 * ```
 */

export {
  adapters,
  generateSchema,
  generateDrizzleSchema,
  generateAllDrizzleSchemas,
  generateAppendSchema,
  generatePrismaSchema,
} from './generators/index.js';
export type { PrismaSchemaGeneratorOptions } from './generators/prisma.js';
export type {
  SchemaGenerator,
  SchemaGeneratorResult,
  SchemaGeneratorOptions,
} from './generators/types.js';
