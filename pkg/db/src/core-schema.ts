/**
 * Core Abstract Schema
 *
 * The single source of truth for Flowlib's database tables.
 * Defined using the abstract `FlowlibPluginSchema` format.
 *
 * The CLI schema generator (`npx flowlib-cli generate`) uses this + plugin schemas
 * to produce the three dialect-specific Drizzle schema files:
 *   - schema-sqlite.ts
 *   - schema-postgres.ts
 *   - schema-mysql.ts
 *
 * When modifying the database schema, edit THIS file, then run `npx flowlib-cli generate`.
 */

import type { FlowlibPluginSchema } from './plugin-schema';

// =============================================================================
// Enum Definitions
// =============================================================================

/**
 * Enum value sets used across the schema.
 * The generator creates pgEnum / mysqlEnum from these.
 */
export const CORE_ENUMS = {
  flowRunStatus: [
    'PENDING',
    'RUNNING',
    'SUCCESS',
    'FAILED',
    'CANCELLED',
    'PAUSED',
    'PAUSED_FOR_BATCH',
  ],
  nodeExecutionStatus: [
    'PENDING',
    'RUNNING',
    'SUCCESS',
    'FAILED',
    'SKIPPED',
    'BATCH_SUBMITTED',
    'BATCH_PROCESSING',
  ],
  batchStatus: ['SUBMITTED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'],
  batchProvider: ['OPENAI', 'ANTHROPIC'],
} as const;

// =============================================================================
// Core Schema Definition
// =============================================================================

export const CORE_SCHEMA: FlowlibPluginSchema = {
  // ----- Flow definition table -----
  flows: {
    tableName: 'flowlib_flows',
    order: 10,
    fields: {
      id: { type: 'string', primaryKey: true },
      name: { type: 'string', required: true },
      description: { type: 'string', required: false },
      tags: { type: 'json', required: false, typeAnnotation: 'string[]' },
      isActive: { type: 'boolean', required: true, defaultValue: true },
      liveVersionNumber: { type: 'number', required: false },
      createdAt: { type: 'date', required: true, defaultValue: 'now()' },
      updatedAt: { type: 'date', required: true, defaultValue: 'now()' },
    },
  },

  // ----- Flow version table -----
  flowVersions: {
    tableName: 'flowlib_flow_versions',
    order: 20,
    compositePrimaryKey: ['version', 'flowId'],
    fields: {
      flowId: {
        type: 'string',
        required: true,
        references: { table: 'flowlib_flows', field: 'id', onDelete: 'cascade' },
      },
      version: { type: 'number', required: true },
      flowlibDefinition: {
        type: 'json',
        required: true,
        typeAnnotation: 'FlowlibDefinitionRuntime',
      },
      createdAt: { type: 'date', required: true, defaultValue: 'now()' },
      createdBy: { type: 'string', required: false },
    },
  },

  // ----- Flow execution (runs) table -----
  flowRuns: {
    tableName: 'flowlib_flow_executions',
    order: 30,
    fields: {
      id: { type: 'uuid', primaryKey: true, defaultValue: 'uuid()' },
      flowId: {
        type: 'string',
        required: true,
        references: { table: 'flowlib_flows', field: 'id', onDelete: 'cascade' },
      },
      flowVersion: { type: 'number', required: true },
      status: {
        type: [...CORE_ENUMS.flowRunStatus],
        required: true,
        defaultValue: 'PENDING',
        typeAnnotation: 'FlowRunStatus',
      },
      inputs: { type: 'json', required: true, typeAnnotation: 'JSONValue' },
      outputs: { type: 'json', required: false, typeAnnotation: 'JSONValue' },
      error: { type: 'text', required: false },
      startedAt: { type: 'date', required: true, defaultValue: 'now()' },
      completedAt: { type: 'date', required: false },
      duration: { type: 'number', required: false },
      createdBy: { type: 'string', required: false },
      // Trigger provenance
      triggerType: { type: 'string', required: false },
      triggerId: { type: 'string', required: false },
      triggerNodeId: { type: 'string', required: false },
      triggerData: { type: 'json', required: false, typeAnnotation: 'JSONValue' },
      lastHeartbeatAt: { type: 'date', required: false },
      /**
       * Buffered node executions for `execution.persistence: 'per-run'` mode.
       * Populated only at flow-run completion (success OR failure) — never
       * during an in-flight run. Stores a JSON-encoded array of
       * `NodeExecution` rows that would otherwise have been written to
       * `flowlib_action_traces` one-row-per-node-per-state.
       *
       * NOT written by `'per-node'` (default) mode — readers must check
       * both this column AND `flowlib_action_traces` so a single deployment
       * can serve historical runs that were captured under either mode.
       *
       * Stored as JSONB on PostgreSQL, JSON on MySQL, and TEXT (json mode)
       * on SQLite — same physical encoding as `outputs` / `inputs` above.
       */
      nodeOutputs: { type: 'json', required: false, typeAnnotation: 'JSONValue' },
    },
  },

  // ----- Action traces (node executions + agent tool executions, unified) -----
  actionTraces: {
    tableName: 'flowlib_action_traces',
    order: 40,
    fields: {
      id: { type: 'uuid', primaryKey: true, defaultValue: 'uuid()' },
      flowRunId: {
        type: 'uuid',
        required: true,
        references: { table: 'flowlib_flow_executions', field: 'id', onDelete: 'cascade' },
      },
      parentNodeExecutionId: {
        type: 'uuid',
        required: false,
        references: { table: 'flowlib_action_traces', field: 'id', onDelete: 'cascade' },
      },
      // Node execution fields (null for tool traces)
      nodeId: { type: 'string', required: false },
      nodeType: { type: 'string', required: false },
      // Tool execution fields (null for node traces)
      toolId: { type: 'string', required: false },
      toolName: { type: 'string', required: false },
      iteration: { type: 'number', required: false },
      // Shared fields
      status: {
        type: [...CORE_ENUMS.nodeExecutionStatus],
        required: true,
        defaultValue: 'PENDING',
        typeAnnotation: 'NodeExecutionStatus',
      },
      inputs: { type: 'json', required: true, typeAnnotation: 'JSONValue' },
      outputs: { type: 'json', required: false, typeAnnotation: 'JSONValue' },
      // Structured failure: classifier output + human-readable message +
      // optional fieldErrors. Stored as JSON/JSONB; adapter-factory auto-
      // serializes on write and parses on read. Readers still accept a
      // plain string for pre-hardening rows and wrap it as `{ code: 'UNKNOWN', message }`.
      error: { type: 'json', required: false, typeAnnotation: 'NodeErrorDetails' },
      startedAt: { type: 'date', required: true, defaultValue: 'now()' },
      completedAt: { type: 'date', required: false },
      duration: { type: 'number', required: false },
      retryCount: { type: 'number', required: true, defaultValue: 0 },
    },
  },

  // ----- Batch jobs table -----
  batchJobs: {
    tableName: 'flowlib_batch_jobs',
    order: 50,
    fields: {
      id: { type: 'uuid', primaryKey: true, defaultValue: 'uuid()' },
      flowRunId: {
        type: 'uuid',
        required: true,
        references: { table: 'flowlib_flow_executions', field: 'id', onDelete: 'cascade' },
      },
      nodeId: { type: 'string', required: true },
      provider: {
        type: [...CORE_ENUMS.batchProvider],
        required: true,
        typeAnnotation: 'BatchProvider',
      },
      batchId: { type: 'string', required: false },
      status: {
        type: [...CORE_ENUMS.batchStatus],
        required: true,
        defaultValue: 'SUBMITTED',
        typeAnnotation: 'BatchStatus',
      },
      requestData: { type: 'json', required: true },
      responseData: { type: 'json', required: false },
      error: { type: 'text', required: false },
      submittedAt: { type: 'date', required: true, defaultValue: 'now()' },
      completedAt: { type: 'date', required: false },
      createdAt: { type: 'date', required: true, defaultValue: 'now()' },
      updatedAt: { type: 'date', required: true, defaultValue: 'now()' },
    },
  },

  // ----- Credentials table -----
  credentials: {
    tableName: 'flowlib_credentials',
    order: 10,
    fields: {
      id: { type: 'uuid', primaryKey: true, defaultValue: 'uuid()' },
      name: { type: 'string', required: true },
      type: { type: 'string', required: true, typeAnnotation: 'CredentialType' },
      authType: { type: 'string', required: true, typeAnnotation: 'CredentialAuthType' },
      config: { type: 'json', required: true, typeAnnotation: 'CredentialConfig' },
      description: { type: 'text', required: false },
      isActive: { type: 'boolean', required: true, defaultValue: true },
      workspaceId: { type: 'string', required: false },
      isShared: { type: 'boolean', required: true, defaultValue: false },
      metadata: { type: 'json', required: false, typeAnnotation: 'Record<string, unknown>' },
      lastUsedAt: { type: 'date', required: false },
      expiresAt: { type: 'date', required: false },
      createdAt: { type: 'date', required: true, defaultValue: 'now()' },
      updatedAt: { type: 'date', required: true, defaultValue: 'now()' },
    },
  },

  // ----- Flow triggers table -----
  flowTriggers: {
    tableName: 'flowlib_flow_triggers',
    order: 20,
    fields: {
      id: { type: 'uuid', primaryKey: true, defaultValue: 'uuid()' },
      flowId: {
        type: 'string',
        required: true,
        references: { table: 'flowlib_flows', field: 'id', onDelete: 'cascade' },
      },
      nodeId: { type: 'string', required: true },
      type: { type: 'string', required: true, typeAnnotation: 'TriggerType' },
      isEnabled: { type: 'boolean', required: true, defaultValue: true },
      webhookPath: { type: 'string', required: false, unique: true },
      webhookSecret: { type: 'string', required: false },
      cronExpression: { type: 'string', required: false },
      cronTimezone: { type: 'string', required: false },
      lastTriggeredAt: { type: 'date', required: false },
      createdAt: { type: 'date', required: true, defaultValue: 'now()' },
      updatedAt: { type: 'date', required: true, defaultValue: 'now()' },
    },
  },

  // ----- Settings (key/value, namespaced) -----
  //
  // Generic store for runtime-editable configuration shared by core and
  // plugins. Keys are namespaced (`<namespace>.<field>`); values are
  // arbitrary JSON. `encrypted: true` means `value` is an `EncryptedData`
  // envelope produced by `EncryptionService.encrypt()`; readers must
  // decrypt before parsing the JSON.
  //
  // Resolution at consumer side: plugin `init()` reads its DB-backed
  // overrides through `flowlib.settings.get(key)`, then falls back to the
  // constructor option, then to the schema default. So `flowlib.config.ts`
  // remains authoritative when the operator wants config-as-code.
  settings: {
    tableName: 'flowlib_settings',
    order: 5,
    fields: {
      key: { type: 'string', primaryKey: true, maxLength: 191 },
      namespace: { type: 'string', required: true, index: true, maxLength: 64 },
      value: { type: 'json', required: false, typeAnnotation: 'unknown' },
      encrypted: { type: 'boolean', required: true, defaultValue: false },
      updatedAt: { type: 'date', required: true, defaultValue: 'now()' },
      updatedBy: { type: 'string', required: false },
    },
  },

  // ----- Chat messages table -----
  chatMessages: {
    tableName: 'flowlib_chat_messages',
    order: 30,
    fields: {
      id: { type: 'uuid', primaryKey: true, defaultValue: 'uuid()' },
      flowId: {
        type: 'string',
        required: true,
        references: { table: 'flowlib_flows', field: 'id', onDelete: 'cascade' },
      },
      role: {
        type: 'string',
        required: true,
        typeAnnotation: "'user' | 'assistant' | 'system' | 'tool'",
      },
      content: { type: 'text', required: true, defaultValue: '' },
      toolMeta: { type: 'json', required: false, typeAnnotation: 'Record<string, unknown>' },
      createdAt: { type: 'date', required: true, defaultValue: 'now()' },
    },
  },
};

/**
 * List of core table names (used by the merger to detect
 * when a plugin extends a core table vs. creates a new one).
 */
export const CORE_TABLE_NAMES = Object.keys(CORE_SCHEMA);
