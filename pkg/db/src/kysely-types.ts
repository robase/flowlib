/**
 * Kysely-side type contract for Flowlib's core tables.
 *
 * Plugins that read core tables import this and intersect with their own
 * owned-tables interface to type a single Kysely instance:
 *
 * ```ts
 * import type { CoreDB } from '@flowlib/db/kysely';
 * import type { RbacOwnedDB } from './db-types';
 *
 * type DB = CoreDB & RbacOwnedDB;
 * const k = ctx.database.kysely<DB>();
 * await k.selectFrom('flowlib_flows').select('id').execute();
 * ```
 *
 * ## Type conventions
 *
 * - **Date columns are typed `string`** (ISO 8601). On SQLite the underlying
 *   driver already returns text. On PostgreSQL (`pg`/`postgres-js`) and MySQL
 *   (`mysql2`), the raw driver may return `Date` objects — callers comparing
 *   timestamps should coerce defensively (`new Date(value).toISOString()` or
 *   `String(value)`). A future Kysely result-mapping plugin could normalize
 *   this transparently.
 *
 * - **Boolean columns are typed `boolean`**. SQLite stores 0/1 in INTEGER
 *   columns — Drizzle's `mode: 'boolean'` masks this for the Drizzle path,
 *   but Kysely talks to the driver layer directly and may surface the raw
 *   `0 | 1`. Plugins reading these defensively should accept either.
 *
 * - **JSON columns** carry their parsed shape via the column type. SQLite
 *   stores them as TEXT; the driver returns the raw string. Drizzle
 *   `mode: 'json'` parses on read; Kysely does not. Plugins reading JSON
 *   columns through Kysely should `JSON.parse` the value, OR continue to
 *   route those reads through Drizzle/`executeRows` until a Kysely
 *   serialization plugin is added.
 *
 * These caveats are documented because they're real — not a sign the types
 * are wrong. The interface describes the *intended* shape; runtime fidelity
 * depends on the driver and the column-mode wiring at the driver boundary.
 *
 * ## Why hand-authored
 *
 * The CLI emits Drizzle migrations from the abstract `core-schema.ts`. A
 * follow-up PR can codegen this Kysely interface from the same source so
 * the two stay in lockstep automatically. Until then, treat this file as
 * a hand-maintained mirror — touch it whenever you add columns to the
 * core schema.
 */

import type { ColumnType } from 'kysely';
import type {
  BatchProvider,
  BatchStatus,
  FlowRunStatus,
  NodeExecutionStatus,
  FlowlibDefinitionRuntime,
  NodeErrorDetails,
} from '@flowlib/action-kit';
import type { CredentialAuthType, CredentialConfig, CredentialType } from './credential-types';
import type { JSONValue } from './index';

export type TimestampColumn = ColumnType<string, string | Date | undefined, string | Date>;
export type DialectBoolean = boolean | 0 | 1;

export interface CoreFlowsTable {
  id: string;
  name: string;
  description: string | null;
  /** JSON-encoded `string[]` on the wire — parse on read if going through Kysely. */
  tags: string | string[] | null;
  is_active: DialectBoolean;
  live_version_number: number | null;
  created_at: string;
  updated_at: string;
}

export interface CoreFlowVersionsTable {
  flow_id: string;
  version: number;
  /** JSON-encoded `FlowlibDefinitionRuntime` on the wire. */
  flowlib_definition: string | FlowlibDefinitionRuntime;
  created_at: string;
  created_by: string | null;
}

export interface CoreFlowRunsTable {
  id: string;
  flow_id: string;
  flow_version: number;
  status: FlowRunStatus;
  inputs: string | JSONValue;
  outputs: string | JSONValue | null;
  error: string | null;
  started_at: string;
  completed_at: string | null;
  duration: number | null;
  created_by: string | null;
  trigger_type: string | null;
  trigger_id: string | null;
  trigger_node_id: string | null;
  trigger_data: string | JSONValue | null;
  last_heartbeat_at: string | null;
  node_outputs: string | JSONValue | null;
}

export interface CoreActionTracesTable {
  id: string;
  flow_run_id: string;
  parent_node_execution_id: string | null;
  node_id: string | null;
  node_type: string | null;
  tool_id: string | null;
  tool_name: string | null;
  iteration: number | null;
  status: NodeExecutionStatus;
  inputs: string | JSONValue;
  outputs: string | JSONValue | null;
  error: string | NodeErrorDetails | null;
  started_at: string;
  completed_at: string | null;
  duration: number | null;
  retry_count: number;
}

export interface CoreBatchJobsTable {
  id: string;
  flow_run_id: string;
  node_id: string;
  provider: BatchProvider;
  batch_id: string | null;
  status: BatchStatus;
  request_data: string | JSONValue;
  response_data: string | JSONValue | null;
  error: string | null;
  submitted_at: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CoreCredentialsTable {
  id: string;
  name: string;
  type: CredentialType;
  auth_type: CredentialAuthType;
  /** Encrypted JSON. Decrypt + parse via the credentials service, not directly. */
  config: string | CredentialConfig;
}

export interface CoreFlowTriggersTable {
  id: string;
  flow_id: string;
  node_id: string;
  type: 'manual' | 'webhook' | 'cron';
  config: string | JSONValue;
  is_enabled: DialectBoolean;
  created_at: string;
  updated_at: string;
}

export interface CoreChatMessagesTable {
  id: string;
  flow_id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  metadata: string | JSONValue | null;
  created_at: string;
}

export interface CoreSettingsTable {
  key: string;
  namespace: string;
  /** JSON value (potentially the encrypted envelope when `encrypted = true`). */
  value: string | JSONValue | null;
  encrypted: DialectBoolean;
  updated_at: string;
  updated_by: string | null;
}

/**
 * Composite Kysely DB type covering every core table. Plugins import this
 * and intersect with their own owned-tables interface.
 */
export interface CoreDB {
  flowlib_flows: CoreFlowsTable;
  flowlib_flow_versions: CoreFlowVersionsTable;
  flowlib_flow_executions: CoreFlowRunsTable;
  flowlib_action_traces: CoreActionTracesTable;
  flowlib_batch_jobs: CoreBatchJobsTable;
  flowlib_credentials: CoreCredentialsTable;
  flowlib_flow_triggers: CoreFlowTriggersTable;
  flowlib_chat_messages: CoreChatMessagesTable;
  flowlib_settings: CoreSettingsTable;
}
