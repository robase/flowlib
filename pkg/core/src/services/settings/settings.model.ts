/**
 * Settings Model — adapter-based CRUD for `flowlib_settings`.
 *
 * Generic key/value store keyed by namespaced strings (e.g.
 * `vc.defaultBranch`). Values are arbitrary JSON; secrets are stored as
 * encrypted envelopes (`EncryptedData`) and tagged with `encrypted: true`.
 */

import type { FlowlibAdapter } from '../../database/adapter';
import type { Logger } from 'src/schemas';

export interface SettingsRow {
  key: string;
  namespace: string;
  value: unknown;
  encrypted: boolean;
  updatedAt: string | Date;
  updatedBy?: string | null;
}

const TABLE = 'flowlib_settings';

/**
 * "Table doesn't exist" is a routine state in pre-migration / fresh-database
 * setups — the rest of Flowlib boots fine without persisted overrides. Reads
 * silently return empty so the per-request log isn't spammed; writes still
 * surface the error because the user genuinely tried to save something.
 *
 * Matched across drivers: D1 ("no such table"), Postgres ("does not exist"
 * / "relation … does not exist"), MySQL ("doesn't exist").
 */
function isMissingTableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /no such table|relation .* does not exist|doesn['’]t exist/i.test(message);
}

export class SettingsModel {
  constructor(
    private readonly adapter: FlowlibAdapter,
    private readonly logger: Logger,
  ) {}

  async get(key: string): Promise<SettingsRow | null> {
    try {
      const row = await this.adapter.findOne<Record<string, unknown>>({
        model: TABLE,
        where: [{ field: 'key', value: key }],
      });
      return row ? this.normalize(row) : null;
    } catch (error) {
      if (isMissingTableError(error)) {
        // Pre-migration / fresh DB — silently treat as "no override".
        return null;
      }
      this.logger.error('Failed to read setting', { key, error });
      throw error;
    }
  }

  async list(namespace?: string): Promise<SettingsRow[]> {
    try {
      const rows = await this.adapter.findMany<Record<string, unknown>>({
        model: TABLE,
        where: namespace ? [{ field: 'namespace', value: namespace }] : undefined,
        sortBy: { field: 'key', direction: 'asc' },
      });
      return rows.map((r) => this.normalize(r));
    } catch (error) {
      if (isMissingTableError(error)) {
        return [];
      }
      this.logger.error('Failed to list settings', { namespace, error });
      throw error;
    }
  }

  async upsert(input: {
    key: string;
    namespace: string;
    value: unknown;
    encrypted: boolean;
    updatedBy?: string | null;
  }): Promise<SettingsRow> {
    const now = new Date();
    const existing = await this.adapter.findOne<Record<string, unknown>>({
      model: TABLE,
      where: [{ field: 'key', value: input.key }],
    });

    const data = {
      key: input.key,
      namespace: input.namespace,
      value: input.value as Record<string, unknown> | null,
      encrypted: input.encrypted,
      updated_at: now,
      updated_by: input.updatedBy ?? null,
    };

    if (existing) {
      await this.adapter.update({
        model: TABLE,
        where: [{ field: 'key', value: input.key }],
        update: {
          namespace: input.namespace,
          value: input.value as Record<string, unknown> | null,
          encrypted: input.encrypted,
          updated_at: now,
          updated_by: input.updatedBy ?? null,
        },
      });
    } else {
      await this.adapter.create({ model: TABLE, data });
    }

    return {
      key: input.key,
      namespace: input.namespace,
      value: input.value,
      encrypted: input.encrypted,
      updatedAt: now.toISOString(),
      updatedBy: input.updatedBy ?? null,
    };
  }

  async delete(key: string): Promise<boolean> {
    const existing = await this.adapter.findOne<Record<string, unknown>>({
      model: TABLE,
      where: [{ field: 'key', value: key }],
    });
    if (!existing) {
      return false;
    }
    await this.adapter.delete({
      model: TABLE,
      where: [{ field: 'key', value: key }],
    });
    return true;
  }

  private normalize(raw: Record<string, unknown>): SettingsRow {
    const valueRaw = raw.value;
    let value: unknown = valueRaw;
    if (typeof valueRaw === 'string') {
      try {
        value = JSON.parse(valueRaw);
      } catch {
        value = valueRaw;
      }
    }
    const encryptedRaw = raw.encrypted;
    const encrypted =
      encryptedRaw === true ||
      encryptedRaw === 1 ||
      encryptedRaw === '1' ||
      encryptedRaw === 'true';
    return {
      key: String(raw.key),
      namespace: String(raw.namespace ?? ''),
      value,
      encrypted,
      updatedAt: (raw.updated_at ?? raw.updatedAt ?? new Date()) as string | Date,
      updatedBy: (raw.updated_by ?? raw.updatedBy ?? null) as string | null,
    };
  }
}
