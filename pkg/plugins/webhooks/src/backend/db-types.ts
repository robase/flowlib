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

import type { DialectBoolean, TimestampColumn } from '@flowlib/db/kysely';

// Shared Kysely aliases keep plugin-owned tables aligned with the core DB surface.

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
  remote_webhook_id: string | null;
  remote_credential_id: string | null;
  remote_provider: string | null;
  /** JSON-encoded scope object (e.g., `{ teamId: '...' }`). Same dialect
   *  caveats as `last_payload`. */
  remote_scope: string | unknown | null;
  /** JSON-encoded array of event names. */
  remote_events: string | unknown | null;
  last_triggered_at: TimestampColumn | null;
  /** JSON-encoded payload. Driver returns `string` (SQLite/MySQL) or already-parsed
   *  value (Postgres jsonb) — repository normalises via `JSON.parse` defensively. */
  last_payload: string | unknown | null;
  trigger_count: number;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

export interface WebhooksDB {
  flowlib_webhook_triggers: WebhookTriggersTable;
}
