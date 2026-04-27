import type { PluginDatabaseApi } from '@flowlib/core';
import type {
  WebhookTrigger,
  WebhookProvider,
  CreateWebhookTriggerInput,
  UpdateWebhookTriggerInput,
} from '../shared/types';

interface WebhookTriggerRow {
  id: string;
  name: string;
  description: string | null;
  webhook_path: string;
  provider: WebhookProvider;
  is_enabled: boolean | number;
  allowed_methods: string;
  hmac_enabled: boolean | number;
  hmac_header_name: string | null;
  hmac_secret: string | null;
  allowed_ips: string | null;
  flow_id: string | null;
  node_id: string | null;
  last_triggered_at: string | null;
  last_payload: unknown;
  trigger_count: number | string;
  created_at: string;
  updated_at: string;
}

export interface CreateWebhookTriggerRecord extends CreateWebhookTriggerInput {
  id: string;
  webhookPath: string;
}

function toBoolean(value: boolean | number): boolean {
  return value === true || value === 1;
}

function toNumber(value: number | string): number {
  if (typeof value === 'number') {
    return value;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseJson(value: unknown): unknown {
  if (value === null || value === undefined || value === '') {
    return undefined;
  }

  if (typeof value !== 'string') {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function mapRow(row: WebhookTriggerRow): WebhookTrigger {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    webhookPath: row.webhook_path,
    provider: row.provider,
    isEnabled: toBoolean(row.is_enabled),
    allowedMethods: row.allowed_methods,
    hmacEnabled: toBoolean(row.hmac_enabled),
    hmacHeaderName: row.hmac_header_name ?? undefined,
    hmacSecret: row.hmac_secret ?? undefined,
    allowedIps: row.allowed_ips ?? undefined,
    flowId: row.flow_id ?? undefined,
    nodeId: row.node_id ?? undefined,
    lastTriggeredAt: row.last_triggered_at ?? undefined,
    lastPayload: parseJson(row.last_payload),
    triggerCount: toNumber(row.trigger_count),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class WebhookTriggersRepository {
  constructor(private readonly database: PluginDatabaseApi) {}

  async list(): Promise<WebhookTrigger[]> {
    const rows = await this.database.query<WebhookTriggerRow>(
      `SELECT
         id,
         name,
         description,
         webhook_path,
         provider,
         is_enabled,
         allowed_methods,
         hmac_enabled,
         hmac_header_name,
         hmac_secret,
         allowed_ips,
         flow_id,
         node_id,
         last_triggered_at,
         last_payload,
         trigger_count,
         created_at,
         updated_at
       FROM invect_webhook_triggers
       ORDER BY created_at DESC`,
    );

    return rows.map(mapRow);
  }

  async findById(id: string): Promise<WebhookTrigger | null> {
    const rows = await this.database.query<WebhookTriggerRow>(
      `SELECT
         id,
         name,
         description,
         webhook_path,
         provider,
         is_enabled,
         allowed_methods,
         hmac_enabled,
         hmac_header_name,
         hmac_secret,
         allowed_ips,
         flow_id,
         node_id,
         last_triggered_at,
         last_payload,
         trigger_count,
         created_at,
         updated_at
       FROM invect_webhook_triggers
       WHERE id = ?
       LIMIT 1`,
      [id],
    );

    return rows[0] ? mapRow(rows[0]) : null;
  }

  async findByWebhookPath(webhookPath: string): Promise<WebhookTrigger | null> {
    const rows = await this.database.query<WebhookTriggerRow>(
      `SELECT
         id,
         name,
         description,
         webhook_path,
         provider,
         is_enabled,
         allowed_methods,
         hmac_enabled,
         hmac_header_name,
         hmac_secret,
         allowed_ips,
         flow_id,
         node_id,
         last_triggered_at,
         last_payload,
         trigger_count,
         created_at,
         updated_at
       FROM invect_webhook_triggers
       WHERE webhook_path = ?
       LIMIT 1`,
      [webhookPath],
    );

    return rows[0] ? mapRow(rows[0]) : null;
  }

  async create(input: CreateWebhookTriggerRecord): Promise<WebhookTrigger> {
    const now = new Date().toISOString();
    await this.database.execute(
      `INSERT INTO invect_webhook_triggers (
         id,
         name,
         description,
         webhook_path,
         provider,
         is_enabled,
         allowed_methods,
         hmac_enabled,
         hmac_header_name,
         hmac_secret,
         allowed_ips,
         flow_id,
         node_id,
         trigger_count,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.name,
        input.description ?? null,
        input.webhookPath,
        input.provider ?? 'generic',
        true,
        input.allowedMethods ?? 'POST',
        input.hmacEnabled ?? false,
        input.hmacHeaderName ?? null,
        input.hmacSecret ?? null,
        input.allowedIps ?? null,
        input.flowId ?? null,
        input.nodeId ?? null,
        0,
        now,
        now,
      ],
    );

    const created = await this.findById(input.id);
    if (!created) {
      throw new Error('Failed to load created webhook trigger');
    }
    return created;
  }

  async update(id: string, input: UpdateWebhookTriggerInput): Promise<WebhookTrigger | null> {
    const updates: string[] = [];
    const params: unknown[] = [];

    if (input.name !== undefined) {
      updates.push('name = ?');
      params.push(input.name);
    }
    if (input.description !== undefined) {
      updates.push('description = ?');
      params.push(input.description ?? null);
    }
    if (input.provider !== undefined) {
      updates.push('provider = ?');
      params.push(input.provider);
    }
    if (input.isEnabled !== undefined) {
      updates.push('is_enabled = ?');
      params.push(input.isEnabled);
    }
    if (input.allowedMethods !== undefined) {
      updates.push('allowed_methods = ?');
      params.push(input.allowedMethods);
    }
    if (input.hmacEnabled !== undefined) {
      updates.push('hmac_enabled = ?');
      params.push(input.hmacEnabled);
    }
    if (input.hmacHeaderName !== undefined) {
      updates.push('hmac_header_name = ?');
      params.push(input.hmacHeaderName ?? null);
    }
    if (input.hmacSecret !== undefined) {
      updates.push('hmac_secret = ?');
      params.push(input.hmacSecret ?? null);
    }
    if (input.allowedIps !== undefined) {
      updates.push('allowed_ips = ?');
      params.push(input.allowedIps ?? null);
    }
    if (input.flowId !== undefined) {
      updates.push('flow_id = ?');
      params.push(input.flowId ?? null);
    }
    if (input.nodeId !== undefined) {
      updates.push('node_id = ?');
      params.push(input.nodeId ?? null);
    }

    if (updates.length === 0) {
      return this.findById(id);
    }

    updates.push('updated_at = ?');
    params.push(new Date().toISOString(), id);

    await this.database.execute(
      `UPDATE invect_webhook_triggers SET ${updates.join(', ')} WHERE id = ?`,
      params,
    );

    return this.findById(id);
  }

  async delete(id: string): Promise<void> {
    await this.database.execute('DELETE FROM invect_webhook_triggers WHERE id = ?', [id]);
  }

  async recordDelivery(id: string, payload: unknown): Promise<void> {
    const timestamp = new Date().toISOString();
    await this.database.execute(
      `UPDATE invect_webhook_triggers
       SET last_triggered_at = ?,
           last_payload = ?,
           trigger_count = trigger_count + 1,
           updated_at = ?
       WHERE id = ?`,
      [timestamp, JSON.stringify(payload ?? null), timestamp, id],
    );
  }
}
