/**
 * SettingsService — generic, namespaced runtime configuration store.
 *
 * Provides a single key/value surface usable by core and any plugin. Keys
 * are dot-namespaced (`<namespace>.<field>`); values are arbitrary JSON.
 * Sensitive values opt into AES-GCM encryption via the resolved
 * `EncryptionAdapter` — the same one credentials use.
 *
 * Plugins are not required to declare a schema to use this — calling
 * `get()` / `set()` directly is fine. Plugins that *do* declare a
 * `settings` descriptor get a generic UI page rendered for free in
 * `@flowlib/ui` and zod-validated writes through this service.
 */

import type { FlowlibAdapter } from '../../database/adapter';
import type { EncryptionAdapter } from '../../types/services';
import type { EncryptedData } from '../credentials/encryption.service';
import { isEncryptedData } from '../credentials/encryption.service';
import type { Logger } from 'src/schemas';
import { SettingsModel, type SettingsRow } from './settings.model';

export interface SettingsRecord {
  key: string;
  namespace: string;
  /**
   * Decrypted value. For records with `encrypted: true`, the underlying
   * envelope is decrypted before returning. For sensitive secrets,
   * `getSanitized()` returns null in the value slot — encrypted values
   * never escape the server unless explicitly fetched.
   */
  value: unknown;
  encrypted: boolean;
  updatedAt: string;
  updatedBy: string | null;
}

export interface SetSettingInput {
  key: string;
  value: unknown;
  /** When true, the value is encrypted at rest. */
  encrypted?: boolean;
  updatedBy?: string | null;
}

export type SettingsChangeEvent = {
  type: 'set' | 'delete';
  key: string;
  namespace: string;
  /** Present for `set`; the post-write decrypted value. */
  value?: unknown;
};

export type SettingsChangeListener = (event: SettingsChangeEvent) => void | Promise<void>;

export class SettingsService {
  private readonly model: SettingsModel;
  private readonly listeners = new Set<{
    prefix: string;
    handler: SettingsChangeListener;
  }>();

  constructor(
    adapter: FlowlibAdapter,
    private readonly encryption: EncryptionAdapter,
    private readonly logger: Logger,
  ) {
    this.model = new SettingsModel(adapter, logger);
  }

  /**
   * Read a single setting. Returns `undefined` if the key doesn't exist
   * (so callers can disambiguate from `null` values that were explicitly set).
   */
  async get<T = unknown>(key: string): Promise<T | undefined> {
    const row = await this.model.get(key);
    if (!row) {
      return undefined;
    }
    return (await this.decryptValue(row)) as T;
  }

  /**
   * Read with a fallback default — used by plugin init code that wants
   * "DB override OR constructor option OR schema default" semantics.
   */
  async getOrDefault<T>(key: string, defaultValue: T): Promise<T> {
    const value = await this.get<T>(key);
    return value === undefined ? defaultValue : value;
  }

  /**
   * List settings. With no args, returns every record (sanitized — encrypted
   * values are masked). Pass a `namespace` to scope to one plugin's keys.
   */
  async list(
    options: { namespace?: string; includeSecrets?: boolean } = {},
  ): Promise<SettingsRecord[]> {
    const rows = await this.model.list(options.namespace);
    return Promise.all(
      rows.map(async (row) => {
        if (row.encrypted && !options.includeSecrets) {
          return this.toSanitized(row);
        }
        return this.toRecord(row, await this.decryptValue(row));
      }),
    );
  }

  /**
   * Returns a record with the encrypted flag preserved but the value masked
   * (set to null) — safe to surface to a UI that should display "set"
   * without revealing the secret.
   */
  async getSanitized(key: string): Promise<SettingsRecord | null> {
    const row = await this.model.get(key);
    if (!row) {
      return null;
    }
    if (row.encrypted) {
      return this.toSanitized(row);
    }
    return this.toRecord(row, await this.decryptValue(row));
  }

  /**
   * Write a setting. Namespace is derived from the key prefix
   * (`vc.defaultBranch` → namespace `vc`). Encrypted writes wrap the JSON
   * value in an `EncryptedData` envelope before persisting.
   */
  async set(input: SetSettingInput): Promise<SettingsRecord> {
    const key = input.key.trim();
    if (!key) {
      throw new Error('Setting key cannot be empty');
    }
    const namespace = this.namespaceOf(key);
    const encrypted = input.encrypted === true;

    let storedValue: unknown = input.value;
    if (encrypted) {
      // Skip the encrypt step for null — clearing a secret should remain a
      // null value, not an envelope around the string "null".
      if (input.value !== null && input.value !== undefined) {
        storedValue = await this.encryption.encrypt(
          typeof input.value === 'string' ? input.value : JSON.stringify(input.value),
        );
      } else {
        storedValue = null;
      }
    }

    const row = await this.model.upsert({
      key,
      namespace,
      value: storedValue,
      encrypted,
      updatedBy: input.updatedBy ?? null,
    });

    const result = this.toRecord(row, await this.decryptValue(row));
    void this.notify({ type: 'set', key, namespace, value: result.value });
    return result;
  }

  /** Delete a setting; returns true if the row existed. */
  async delete(key: string, _identity?: string | null): Promise<boolean> {
    const namespace = this.namespaceOf(key);
    const removed = await this.model.delete(key);
    if (removed) {
      void this.notify({ type: 'delete', key, namespace });
    }
    return removed;
  }

  /**
   * Subscribe to setting changes. The listener fires after the DB write
   * completes. Returns an unsubscribe function.
   *
   * `prefix` matches the namespace (or the full key) — pass `'vc'` to
   * receive every change under `vc.*`, or `''` to receive everything.
   */
  onChange(prefix: string, handler: SettingsChangeListener): () => void {
    const entry = { prefix, handler };
    this.listeners.add(entry);
    return () => {
      this.listeners.delete(entry);
    };
  }

  private namespaceOf(key: string): string {
    const dot = key.indexOf('.');
    return dot >= 0 ? key.slice(0, dot) : key;
  }

  private async decryptValue(row: SettingsRow): Promise<unknown> {
    if (!row.encrypted) {
      return row.value;
    }
    if (row.value === null || row.value === undefined) {
      return null;
    }
    if (!isEncryptedData(row.value)) {
      this.logger.warn('Encrypted setting has malformed envelope; returning null', {
        key: row.key,
      });
      return null;
    }
    try {
      const plaintext = await this.encryption.decrypt(row.value as EncryptedData);
      try {
        return JSON.parse(plaintext);
      } catch {
        return plaintext;
      }
    } catch (error) {
      this.logger.error('Failed to decrypt setting', { key: row.key, error });
      return null;
    }
  }

  private toSanitized(row: SettingsRow): SettingsRecord {
    return {
      key: row.key,
      namespace: row.namespace,
      value: null,
      encrypted: row.encrypted,
      updatedAt:
        typeof row.updatedAt === 'string' ? row.updatedAt : (row.updatedAt as Date).toISOString(),
      updatedBy: row.updatedBy ?? null,
    };
  }

  private toRecord(row: SettingsRow, value: unknown): SettingsRecord {
    return {
      key: row.key,
      namespace: row.namespace,
      value,
      encrypted: row.encrypted,
      updatedAt:
        typeof row.updatedAt === 'string' ? row.updatedAt : (row.updatedAt as Date).toISOString(),
      updatedBy: row.updatedBy ?? null,
    };
  }

  private async notify(event: SettingsChangeEvent): Promise<void> {
    for (const { prefix, handler } of this.listeners) {
      if (prefix && !event.key.startsWith(prefix) && event.namespace !== prefix) {
        continue;
      }
      try {
        await handler(event);
      } catch (error) {
        this.logger.warn('Settings change listener threw', {
          key: event.key,
          error: (error as Error).message,
        });
      }
    }
  }
}
