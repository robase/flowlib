/**
 * Shared utility functions for the agents repositories.
 *
 * Mirrors the helpers in
 * `pkg/plugins/webhooks/src/backend/webhook-triggers.repository.ts` —
 * dialect-portable date / boolean / JSON normalisation around the Kysely
 * query layer.
 */

import type { PluginDatabaseApi } from '@flowlib/core';
import type { DialectBoolean } from '@flowlib/db/kysely';

/** Convert a date-ish value to ISO-8601 string. */
export function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

/** Convert a nullable date-ish value to an ISO string or null. */
export function toIsoOrNull(value: string | Date | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return toIso(value);
}

/** SQLite stores 0/1 in INTEGER columns; coerce uniformly. */
export function toBool(value: DialectBoolean): boolean {
  return value === true || value === 1;
}

/**
 * Defensive JSON parse. SQLite/MySQL surface JSON columns as TEXT
 * strings; Postgres jsonb returns the parsed value already. Accept either.
 */
export function parseJson<T = unknown>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) {
    return fallback;
  }
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

/** Like `parseJson` but returns `null` rather than a typed fallback. */
export function parseJsonOrNull<T>(value: unknown): T | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }
  return value as T;
}

/** Encode a JS value for a JSON column. Always emits a string for portability. */
export function encodeJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

/** Encode a JS value for a JSON column or pass through `null`. */
export function encodeJsonOrNull(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return JSON.stringify(value);
}

/** Dialect-appropriate "now" value. SQLite stores TEXT; PG/MySQL accept Date. */
export function nowFor(database: PluginDatabaseApi): string | Date {
  return database.type === 'sqlite' ? new Date().toISOString() : new Date();
}

/** Dialect-appropriate boolean. SQLite stores 0/1; PG bool; MySQL accepts both. */
export function boolFor(database: PluginDatabaseApi, value: boolean): DialectBoolean {
  return database.type === 'sqlite' ? (value ? 1 : 0) : value;
}

/**
 * Random UUID. The Workers runtime (and Node 19+) ships `crypto.randomUUID()`.
 * Repositories that accept a caller-supplied id won't call this.
 */
export function generateId(): string {
  return crypto.randomUUID();
}
