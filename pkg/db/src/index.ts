/**
 * `@flowlib/db` — Drizzle schemas + schema tooling for Flowlib core.
 *
 * Lightweight by design: no `@flowlib/core` dependency. Consumable from
 * Cloudflare Workers, edge runtimes, third-party apps that want to
 * query Flowlib tables without bundling the executor.
 *
 * Subpath exports for dialect schemas:
 *   - `@flowlib/db/sqlite`   → schema-sqlite.ts
 *   - `@flowlib/db/postgres` → schema-postgres.ts
 *   - `@flowlib/db/mysql`    → schema-mysql.ts
 */

// Plugin schema types (abstract, dialect-agnostic).
export type {
  PluginFieldType,
  PluginFieldAttribute,
  PluginTableDefinition,
  FlowlibPluginSchema,
  PluginSchemaSource,
} from './plugin-schema';

// Core abstract schema (used by the schema generator and merger).
export { CORE_SCHEMA, CORE_TABLE_NAMES, CORE_ENUMS } from './core-schema';

// Schema merger — combines core + plugin schemas.
export { mergeSchemas, diffSchemas, SchemaConflictError } from './schema-merger';
export type {
  MergedSchema,
  MergedTable,
  TableIndex,
  SchemaTransform,
  SchemaProvenance,
  SchemaMergeError,
  SchemaDiff,
} from './schema-merger';

// Drizzle source-code generators (CLI uses these).
export {
  generateSqliteSchema,
  generatePostgresSchema,
  generateMysqlSchema,
  generateSqliteSchemaAppend,
  generatePostgresSchemaAppend,
  generateMysqlSchemaAppend,
  generateSqliteRawSql,
  generatePostgresRawSql,
  generateMysqlRawSql,
} from './schema-generator';
export type { AppendSchemaResult } from './schema-generator';

// Prisma schema generator.
export { generateFullPrismaSchema, generatePrismaModels } from './prisma-schema-generator';
export type { PrismaProvider } from './prisma-schema-generator';

// Aggregate dialect schema namespaces — useful for callers that want
// `drizzle(db, { schema: sqliteSchema })`. Importing the namespace pulls
// in only the dialect actually referenced.
export * as sqliteSchema from './schema-sqlite';
export * as postgresqlSchema from './schema-postgres';
export * as mysqlSchema from './schema-mysql';

// Re-export the dialect-specific row types most commonly consumed.
// Callers needing a different table's row type should import from the
// dialect subpath directly (`@flowlib/db/sqlite`).
export type {
  Flow,
  NewFlow,
  FlowVersion,
  NewFlowVersion,
  FlowRun,
  NewFlowRun,
  NodeExecution,
  NewNodeExecution,
  BatchJob,
  NewBatchJob,
  FlowTrigger,
  NewFlowTrigger,
  TriggerType,
  ChatMessageRecord,
  NewChatMessageRecord,
} from './schema-sqlite';

/**
 * JSON value type used by the dialect schemas for `$type<JSONValue>()`
 * column annotations. Re-exported so the Drizzle modules' type
 * references resolve cleanly across package boundaries.
 */
export type JSONValue = Record<string, unknown>;
