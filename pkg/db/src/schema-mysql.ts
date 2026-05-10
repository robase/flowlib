// MySQL schema for Flowlib core
import {
  mysqlTable,
  varchar,
  text,
  int,
  boolean,
  timestamp,
  json,
  mysqlEnum,
  primaryKey,
} from 'drizzle-orm/mysql-core';
import { relations, sql } from 'drizzle-orm';
import type { FlowlibDefinitionRuntime, NodeErrorDetails } from '@flowlib/action-kit';
import { randomUUID } from 'crypto';
import {
  CREDENTIAL_AUTH_TYPES,
  CREDENTIAL_TYPES,
  type CredentialAuthType,
  type CredentialConfig,
  type CredentialType,
} from './credential-types';
import type { JSONValue } from './index';
export type { CredentialAuthType, CredentialConfig, CredentialType } from './credential-types';

// =============================================================================
// Tables
// =============================================================================

// Flow definition table
export const flows = mysqlTable('flowlib_flows', {
  id: varchar('id', { length: 36 }).primaryKey(), // Will be generated using IdGenerator.generateFlowId()
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  tags: json('tags').$type<string[]>(),
  isActive: boolean('is_active').notNull().default(true),
  liveVersionNumber: int('live_version_number'),
  createdAt: timestamp('created_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp('updated_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`),
});

// Flow version table to support version history
export const flowVersions = mysqlTable(
  'flowlib_flow_versions',
  {
    flowId: varchar('flow_id', { length: 36 })
      .notNull()
      .references(() => flows.id, { onDelete: 'cascade' }),
    version: int('version').notNull().unique(),
    flowlibDefinition: json('flowlib_definition').$type<FlowlibDefinitionRuntime>().notNull(),
    createdAt: timestamp('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    createdBy: varchar('created_by', { length: 255 }),
  },
  (table) => [primaryKey({ columns: [table.version, table.flowId] })],
);

// Flow execution table to track execution instances
export const flowRuns = mysqlTable('flowlib_flow_executions', {
  id: varchar('id', { length: 36 })
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  flowId: varchar('flow_id', { length: 36 })
    .notNull()
    .references(() => flows.id, { onDelete: 'cascade' }),
  flowVersion: int('flow_version')
    .notNull()
    .references(() => flowVersions.version, { onDelete: 'cascade' }),
  status: mysqlEnum('status', [
    'PENDING',
    'RUNNING',
    'SUCCESS',
    'FAILED',
    'CANCELLED',
    'PAUSED',
    'PAUSED_FOR_BATCH',
  ])
    .notNull()
    .default('PENDING'),
  inputs: json('inputs').$type<JSONValue>().notNull(),
  outputs: json('outputs').$type<JSONValue>(),
  error: text('error'),
  startedAt: timestamp('started_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  completedAt: timestamp('completed_at'),
  duration: int('duration'), // in milliseconds
  createdBy: varchar('created_by', { length: 255 }),
  // Trigger provenance
  triggerType: varchar('trigger_type', { length: 50 }), // 'manual' | 'webhook' | 'cron' | 'api' | null
  triggerId: varchar('trigger_id', { length: 36 }), // References flow_triggers.id
  triggerNodeId: varchar('trigger_node_id', { length: 255 }), // The trigger node that initiated this run
  triggerData: json('trigger_data').$type<JSONValue>(), // Webhook payload / cron metadata
  lastHeartbeatAt: timestamp('last_heartbeat_at'), // Updated periodically during execution for stale run detection
  // Buffered node executions for execution.persistence: 'per-run' mode.
  // Populated only at flow-run completion — never during in-flight runs.
  nodeOutputs: json('node_outputs').$type<JSONValue>(),
});

// Action traces table — unified node executions + agent tool executions
import type { AnyMySqlColumn } from 'drizzle-orm/mysql-core';

export const actionTraces = mysqlTable('flowlib_action_traces', {
  id: varchar('id', { length: 36 })
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  flowRunId: varchar('flow_run_id', { length: 36 })
    .notNull()
    .references(() => flowRuns.id, { onDelete: 'cascade' }),
  // Self-referential FK: NULL for node traces, set for tool traces
  parentNodeExecutionId: varchar('parent_node_execution_id', { length: 36 }).references(
    (): AnyMySqlColumn => actionTraces.id,
    { onDelete: 'cascade' },
  ),
  // Node execution fields (null for tool traces)
  nodeId: varchar('node_id', { length: 255 }),
  nodeType: varchar('node_type', { length: 100 }),
  // Tool execution fields (null for node traces)
  toolId: varchar('tool_id', { length: 255 }),
  toolName: varchar('tool_name', { length: 255 }),
  iteration: int('iteration'),
  // Shared fields
  status: mysqlEnum('status', [
    'PENDING',
    'RUNNING',
    'SUCCESS',
    'FAILED',
    'SKIPPED',
    'BATCH_SUBMITTED',
    'BATCH_PROCESSING',
  ])
    .notNull()
    .default('PENDING'),
  inputs: json('inputs').$type<JSONValue>().notNull(),
  outputs: json('outputs').$type<JSONValue>(),
  // Structured failure (NodeErrorDetails) — classifier code + message +
  // fieldErrors / providerRequestId / attempts.
  error: json('error').$type<NodeErrorDetails>(),
  startedAt: timestamp('started_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  completedAt: timestamp('completed_at'),
  duration: int('duration'), // in milliseconds
  retryCount: int('retry_count').notNull().default(0),
});

// Batch job table to track batch processing jobs
export const batchJobs = mysqlTable('flowlib_batch_jobs', {
  id: varchar('id', { length: 36 })
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  flowRunId: varchar('flow_run_id', { length: 36 })
    .notNull()
    .references(() => flowRuns.id, { onDelete: 'cascade' }),
  nodeId: varchar('node_id', { length: 255 }).notNull(),
  provider: mysqlEnum('provider', ['OPENAI', 'ANTHROPIC', 'OPENROUTER']).notNull(),
  batchId: varchar('batch_id', { length: 255 }),
  status: mysqlEnum('status', ['SUBMITTED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'])
    .notNull()
    .default('SUBMITTED'),
  requestData: json('request_data').notNull(),
  responseData: json('response_data'),
  error: text('error'),
  submittedAt: timestamp('submitted_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp('updated_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`),
});

export const credentials = mysqlTable('flowlib_credentials', {
  id: varchar('id', { length: 36 })
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  name: varchar('name', { length: 255 }).notNull(),
  type: mysqlEnum('type', CREDENTIAL_TYPES).$type<CredentialType>().notNull(),
  authType: mysqlEnum('auth_type', CREDENTIAL_AUTH_TYPES).$type<CredentialAuthType>().notNull(),
  config: json('config').$type<CredentialConfig>().notNull(),
  description: text('description'),
  isActive: boolean('is_active').notNull().default(true),
  workspaceId: varchar('workspace_id', { length: 255 }),
  isShared: boolean('is_shared').notNull().default(false),
  metadata: json('metadata').$type<Record<string, unknown>>(),
  lastUsedAt: timestamp('last_used_at'),
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp('updated_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`),
});

// =============================================================================
// Flow Triggers - Registration table for webhook/cron/manual triggers
// =============================================================================

/** Trigger type discriminant */
export type TriggerType = 'manual' | 'webhook' | 'cron';

export const flowTriggers = mysqlTable('flowlib_flow_triggers', {
  id: varchar('id', { length: 36 })
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  flowId: varchar('flow_id', { length: 36 })
    .notNull()
    .references(() => flows.id, { onDelete: 'cascade' }),
  /** The trigger node's ID in the flow graph */
  nodeId: varchar('node_id', { length: 255 }).notNull(),
  type: varchar('type', { length: 50 }).$type<TriggerType>().notNull(),
  isEnabled: boolean('is_enabled').notNull().default(true),

  // Webhook-only: top-level for unique index + O(1) lookup
  webhookPath: varchar('webhook_path', { length: 255 }).unique(),
  webhookSecret: varchar('webhook_secret', { length: 255 }),

  // Cron-only: denormalized from node params so scheduler doesn't need to load flow
  cronExpression: varchar('cron_expression', { length: 255 }),
  cronTimezone: varchar('cron_timezone', { length: 100 }),

  lastTriggeredAt: timestamp('last_triggered_at'),
  createdAt: timestamp('created_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp('updated_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`),
});

// =============================================================================
// Settings — generic namespaced key/value store shared by core and plugins
// =============================================================================

export const settings = mysqlTable('flowlib_settings', {
  key: varchar('key', { length: 191 }).primaryKey(),
  namespace: varchar('namespace', { length: 64 }).notNull(),
  value: json('value').$type<unknown>(),
  encrypted: boolean('encrypted').notNull().default(false),
  updatedAt: timestamp('updated_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedBy: varchar('updated_by', { length: 255 }),
});

// =============================================================================
// Chat Messages — persisted chat history scoped to flows
// =============================================================================

export const chatMessages = mysqlTable('flowlib_chat_messages', {
  id: varchar('id', { length: 36 })
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  flowId: varchar('flow_id', { length: 36 })
    .notNull()
    .references(() => flows.id, { onDelete: 'cascade' }),
  role: varchar('role', { length: 20 }).$type<'user' | 'assistant' | 'system' | 'tool'>().notNull(),
  content: text('content').notNull(),
  toolMeta: json('tool_meta').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

// =============================================================================
// Relations
// =============================================================================

export const chatMessagesRelations = relations(chatMessages, ({ one }) => ({
  flow: one(flows, {
    fields: [chatMessages.flowId],
    references: [flows.id],
  }),
}));

export const flowsRelations = relations(flows, ({ many, one }) => ({
  versions: many(flowVersions),
  chatMessages: many(chatMessages),
  liveVersion: one(flowVersions, {
    fields: [flows.liveVersionNumber, flows.id],
    references: [flowVersions.version, flowVersions.flowId],
  }),
}));

export const flowVersionsRelations = relations(flowVersions, ({ one, many }) => ({
  flow: one(flows, {
    fields: [flowVersions.flowId],
    references: [flows.id],
  }),
  executions: many(flowRuns),
}));

export const flowRunsRelations = relations(flowRuns, ({ one, many }) => ({
  version: one(flowVersions, {
    fields: [flowRuns.flowVersion, flowRuns.flowId],
    references: [flowVersions.version, flowVersions.flowId],
  }),
  traces: many(actionTraces),
  batchJobs: many(batchJobs),
}));

export const actionTracesRelations = relations(actionTraces, ({ one, many }) => ({
  execution: one(flowRuns, {
    fields: [actionTraces.flowRunId],
    references: [flowRuns.id],
  }),
  parentNodeExecution: one(actionTraces, {
    fields: [actionTraces.parentNodeExecutionId],
    references: [actionTraces.id],
    relationName: 'parentChild',
  }),
  childToolExecutions: many(actionTraces, { relationName: 'parentChild' }),
}));

export const batchJobsRelations = relations(batchJobs, ({ one }) => ({
  execution: one(flowRuns, {
    fields: [batchJobs.flowRunId],
    references: [flowRuns.id],
  }),
}));

// =============================================================================
// Type exports
// =============================================================================

export type Flow = typeof flows.$inferSelect;
export type NewFlow = typeof flows.$inferInsert;

export type FlowVersion = typeof flowVersions.$inferSelect;
export type NewFlowVersion = typeof flowVersions.$inferInsert;

export type FlowRun = typeof flowRuns.$inferSelect;
export type NewFlowRun = typeof flowRuns.$inferInsert;

export type NodeExecution = typeof actionTraces.$inferSelect;
export type NewNodeExecution = typeof actionTraces.$inferInsert;

export type BatchJob = typeof batchJobs.$inferSelect;
export type NewBatchJob = typeof batchJobs.$inferInsert;

export type Credential = typeof credentials.$inferSelect;
export type NewCredential = typeof credentials.$inferInsert;

export const flowTriggersRelations = relations(flowTriggers, ({ one }) => ({
  flow: one(flows, {
    fields: [flowTriggers.flowId],
    references: [flows.id],
  }),
}));

export type FlowTrigger = typeof flowTriggers.$inferSelect;
export type NewFlowTrigger = typeof flowTriggers.$inferInsert;

export type ChatMessageRecord = typeof chatMessages.$inferSelect;
export type NewChatMessageRecord = typeof chatMessages.$inferInsert;
