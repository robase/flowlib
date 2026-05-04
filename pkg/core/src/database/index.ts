// Database layer exports for Flowlib core.
//
// Runtime pieces only: connection lifecycle + drivers. Schema authoring,
// dialect tables, schema-merger, and schema-generator all live in
// `@flowlib/db` — import directly from there.
export * from './connection';
export type { DatabaseDriver, DatabaseDriverType } from './drivers/types';
export { resolveDatabaseDriverType, createDatabaseDriver } from './drivers';
