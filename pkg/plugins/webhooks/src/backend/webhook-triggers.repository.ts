import type { PluginDatabaseApi } from '@flowlib/core';
import { sql } from 'kysely';
import type { WebhooksDB } from './db-types';
import type {
  WebhookTrigger,
  WebhookProvider,
  CreateWebhookTriggerInput,
  UpdateWebhookTriggerInput,
} from '../shared/types';

/**
 * Webhook triggers persistence — Kysely-typed across SQLite/Postgres/MySQL.
 *
 * One typed query expression works on every dialect; column-level type
 * checking comes from the `WebhooksDB` interface in `db-types.ts`. Migrations
 * for `flowlib_webhook_triggers` are emitted by `flowlib-cli generate` from
 * the abstract `WEBHOOK_TRIGGERS_SCHEMA` in `plugin.ts`.
 */

interface WebhookTriggerRow {
  id: string;
  name: string;
  description: string | null;
  webhook_path: string;
  provider: string;
  is_enabled: boolean | 0 | 1;
  allowed_methods: string;
  hmac_enabled: boolean | 0 | 1;
  hmac_header_name: string | null;
  hmac_secret: string | null;
  allowed_ips: string | null;
  flow_id: string | null;
  node_id: string | null;
  last_triggered_at: string | Date | null;
  last_payload: unknown;
  trigger_count: number;
  created_at: string | Date;
  updated_at: string | Date;
}

export interface CreateWebhookTriggerRecord extends CreateWebhookTriggerInput {
  id: string;
  webhookPath: string;
}

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toIsoOrUndefined(value: string | Date | null): string | undefined {
  if (value === null) {
    return undefined;
  }
  return toIso(value);
}

/**
 * SQLite stores 0/1 in INTEGER columns; Postgres returns native bool;
 * MySQL returns 0/1 from `tinyint(1)`. Coerce uniformly.
 */
function toBool(value: boolean | 0 | 1): boolean {
  return value === true || value === 1;
}

/**
 * `last_payload` is stored as JSON text on SQLite/MySQL; Postgres jsonb
 * returns the parsed value. Defensive parse — only attempt when we got a
 * string back.
 */
function parseJsonPayload(value: unknown): unknown {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

function mapRow(row: WebhookTriggerRow): WebhookTrigger {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    webhookPath: row.webhook_path,
    provider: row.provider as WebhookProvider,
    isEnabled: toBool(row.is_enabled),
    allowedMethods: row.allowed_methods,
    hmacEnabled: toBool(row.hmac_enabled),
    hmacHeaderName: row.hmac_header_name ?? undefined,
    hmacSecret: row.hmac_secret ?? undefined,
    allowedIps: row.allowed_ips ?? undefined,
    flowId: row.flow_id ?? undefined,
    nodeId: row.node_id ?? undefined,
    lastTriggeredAt: toIsoOrUndefined(row.last_triggered_at),
    lastPayload: parseJsonPayload(row.last_payload),
    triggerCount: row.trigger_count,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export class WebhookTriggersRepository {
  constructor(private readonly database: PluginDatabaseApi) {}

  async list(): Promise<WebhookTrigger[]> {
    const rows = await this.database
      .kysely<WebhooksDB>()
      .selectFrom('flowlib_webhook_triggers')
      .selectAll()
      .orderBy('created_at', 'desc')
      .execute();
    return rows.map((row) => mapRow(row as unknown as WebhookTriggerRow));
  }

  async findById(id: string): Promise<WebhookTrigger | null> {
    const row = await this.database
      .kysely<WebhooksDB>()
      .selectFrom('flowlib_webhook_triggers')
      .where('id', '=', id)
      .selectAll()
      .limit(1)
      .executeTakeFirst();
    return row ? mapRow(row as unknown as WebhookTriggerRow) : null;
  }

  async findByWebhookPath(webhookPath: string): Promise<WebhookTrigger | null> {
    const row = await this.database
      .kysely<WebhooksDB>()
      .selectFrom('flowlib_webhook_triggers')
      .where('webhook_path', '=', webhookPath)
      .selectAll()
      .limit(1)
      .executeTakeFirst();
    return row ? mapRow(row as unknown as WebhookTriggerRow) : null;
  }

  async create(input: CreateWebhookTriggerRecord): Promise<WebhookTrigger> {
    const now = this.nowValue();
    await this.database
      .kysely<WebhooksDB>()
      .insertInto('flowlib_webhook_triggers')
      .values({
        id: input.id,
        name: input.name,
        description: input.description ?? null,
        webhook_path: input.webhookPath,
        provider: input.provider ?? 'generic',
        is_enabled: this.boolValue(true),
        allowed_methods: input.allowedMethods ?? 'POST',
        hmac_enabled: this.boolValue(input.hmacEnabled ?? false),
        hmac_header_name: input.hmacHeaderName ?? null,
        hmac_secret: input.hmacSecret ?? null,
        allowed_ips: input.allowedIps ?? null,
        flow_id: input.flowId ?? null,
        node_id: input.nodeId ?? null,
        last_triggered_at: null,
        last_payload: null,
        trigger_count: 0,
        created_at: now,
        updated_at: now,
      })
      .execute();

    const created = await this.findById(input.id);
    if (!created) {
      throw new Error('Failed to load created webhook trigger');
    }
    return created;
  }

  async update(id: string, input: UpdateWebhookTriggerInput): Promise<WebhookTrigger | null> {
    const set: Record<string, unknown> = {};
    if (input.name !== undefined) {
      set.name = input.name;
    }
    if (input.description !== undefined) {
      set.description = input.description ?? null;
    }
    if (input.provider !== undefined) {
      set.provider = input.provider;
    }
    if (input.isEnabled !== undefined) {
      set.is_enabled = this.boolValue(input.isEnabled);
    }
    if (input.allowedMethods !== undefined) {
      set.allowed_methods = input.allowedMethods;
    }
    if (input.hmacEnabled !== undefined) {
      set.hmac_enabled = this.boolValue(input.hmacEnabled);
    }
    if (input.hmacHeaderName !== undefined) {
      set.hmac_header_name = input.hmacHeaderName ?? null;
    }
    if (input.hmacSecret !== undefined) {
      set.hmac_secret = input.hmacSecret ?? null;
    }
    if (input.allowedIps !== undefined) {
      set.allowed_ips = input.allowedIps ?? null;
    }
    if (input.flowId !== undefined) {
      set.flow_id = input.flowId ?? null;
    }
    if (input.nodeId !== undefined) {
      set.node_id = input.nodeId ?? null;
    }

    if (Object.keys(set).length === 0) {
      return this.findById(id);
    }

    set.updated_at = this.nowValue();

    await this.database
      .kysely<WebhooksDB>()
      .updateTable('flowlib_webhook_triggers')
      .set(set as never)
      .where('id', '=', id)
      .execute();

    return this.findById(id);
  }

  async delete(id: string): Promise<void> {
    await this.database
      .kysely<WebhooksDB>()
      .deleteFrom('flowlib_webhook_triggers')
      .where('id', '=', id)
      .execute();
  }

  async recordDelivery(id: string, payload: unknown): Promise<void> {
    const now = this.nowValue();
    await this.database
      .kysely<WebhooksDB>()
      .updateTable('flowlib_webhook_triggers')
      .set({
        last_triggered_at: now,
        // Always persist as JSON text — works uniformly across SQLite (TEXT),
        // MySQL (JSON), and Postgres (jsonb accepts JSON-encoded strings).
        last_payload: payload === null || payload === undefined ? null : JSON.stringify(payload),
        trigger_count: sql`trigger_count + 1`,
        updated_at: now,
      } as never)
      .where('id', '=', id)
      .execute();
  }

  // ─── Internals ─────────────────────────────────────────────────────

  /** Dialect-appropriate "now" value. SQLite stores timestamps as TEXT
   *  (ISO-8601); Postgres/MySQL accept Date objects through the driver. */
  private nowValue(): string | Date {
    return this.database.type === 'sqlite' ? new Date().toISOString() : new Date();
  }

  /** Dialect-appropriate boolean. SQLite stores 0/1 in INTEGER; Postgres
   *  has native bool; MySQL accepts both. */
  private boolValue(value: boolean): boolean | 0 | 1 {
    return this.database.type === 'sqlite' ? (value ? 1 : 0) : value;
  }
}
