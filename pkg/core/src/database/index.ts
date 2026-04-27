// Database layer exports for Flowlib core
export * from './connection';
export type { DatabaseDriver, DatabaseDriverType } from './drivers/types';
export { resolveDatabaseDriverType, createDatabaseDriver } from './drivers';

// Legacy re-export for backward compatibility
export type { DatabaseDriver as SqliteDriver } from './drivers/types';
export type { DatabaseDriverType as SqliteDriverType } from './drivers/types';
export { resolveDatabaseDriverType as resolveSqliteDriverType } from './drivers';

// Re-export database schema types
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
} from './schema-sqlite';

export type { ChatMessageRecord, NewChatMessageRecord } from './schema-sqlite';

export type JSONValue = Record<string, unknown>;

export * as drizzleSqliteSchema from './schema-sqlite';
export * as drizzleMySqlSchema from './schema-mysql';
export * as drizzlePostgresSchema from './schema-postgres';
