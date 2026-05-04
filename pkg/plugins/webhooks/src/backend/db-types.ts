/**
 * Kysely DB shape for the webhooks plugin's queries.
 *
 * Migrations for `flowlib_webhook_triggers` flow through the abstract
 * `WEBHOOK_TRIGGERS_SCHEMA` declared in `plugin.ts` + `flowlib-cli generate`
 * — this file is the runtime-query type contract only.
 *
 * See [pkg/db/src/kysely-types.ts] for type-convention notes (date columns,
 * booleans, JSON encoding) that apply here too.
 */

import type { ColumnType } from 'kysely';

// ISO-string timestamp on select; either string or Date accepted on write.
type Timestamp = ColumnType<string, string | Date | undefined, string | Date>;

// SQLite stores 0/1 in INTEGER columns — Drizzle's mode:'boolean' isn't
// applied through the Kysely path, so accept either form on read. Both
// `boolean` (PG) and `0 | 1` (SQLite/MySQL) are coerced via `Boolean(v)`
// at the repository's `mapRow` boundary.
type DialectBoolean = boolean | 0 | 1;

export interface WebhookTriggersTable {
  id: string;
  name: string;
  description: string | null;
  webhook_path: string;
  provider: string;
  is_enabled: DialectBoolean;
  allowed_methods: string;
  hmac_enabled: DialectBoolean;
  hmac_header_name: string | null;
  hmac_secret: string | null;
  allowed_ips: string | null;
  flow_id: string | null;
  node_id: string | null;
  last_triggered_at: Timestamp | null;
  /** JSON-encoded payload. Driver returns `string` (SQLite/MySQL) or already-parsed
   *  value (Postgres jsonb) — repository normalises via `JSON.parse` defensively. */
  last_payload: string | unknown | null;
  trigger_count: number;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface WebhooksDB {
  flowlib_webhook_triggers: WebhookTriggersTable;
}
