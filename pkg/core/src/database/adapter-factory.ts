/**
 * Adapter Factory
 *
 * Wraps a RawFlowlibAdapter with automatic type coercion based on dialect
 * capabilities. Inspired by better-auth's createAdapterFactory.
 *
 * This layer handles:
 * - boolean ↔ 0/1 integer (SQLite)
 * - Date ↔ ISO string (SQLite)
 * - JSON objects ↔ JSON string (SQLite, MySQL for text-mode JSON)
 * - string[] ↔ JSON string (SQLite, MySQL)
 */

import type { FlowlibAdapter, RawFlowlibAdapter, WhereClause, AdapterConfig } from './adapter';
import { getDefaultCapabilities } from './adapter';
import { randomUUID } from 'crypto';

// ---------------------------------------------------------------------------
// Column type metadata — tells the factory how to coerce values
// ---------------------------------------------------------------------------

/** Known column types for coercion. */
export type ColumnType = 'string' | 'number' | 'uuid' | 'boolean' | 'date' | 'json' | 'string[]';

export interface ColumnMeta {
  type: ColumnType;
  defaultValue?: 'uuid';
}

/**
 * Schema metadata: for each table, a map of column name → column type.
 * Only columns that require coercion need to be listed.
 * Unlisted columns are passed through as-is.
 */
export type SchemaMetadata = Record<string, Record<string, ColumnMeta>>;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createFlowlibAdapterFactory(
  rawAdapter: RawFlowlibAdapter,
  config: AdapterConfig,
  schemaMeta: SchemaMetadata,
): FlowlibAdapter {
  const caps = {
    ...getDefaultCapabilities(config.dialect),
    ...config,
  };

  // -------------------------------------------------------------------------
  // Input transform — before writing to DB
  // -------------------------------------------------------------------------

  function transformInput(model: string, data: Record<string, unknown>): Record<string, unknown> {
    const tableMeta = schemaMeta[model];
    if (!tableMeta) {
      return data;
    }

    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      const meta = tableMeta[key];
      if (!meta || value === undefined || value === null) {
        out[key] = value;
        continue;
      }

      out[key] = coerceInput(value, meta.type);
    }
    return out;
  }

  function applyCreateDefaults(
    model: string,
    data: Record<string, unknown>,
  ): Record<string, unknown> {
    const tableMeta = schemaMeta[model];
    if (!tableMeta) {
      return data;
    }

    const out = { ...data };
    for (const [key, meta] of Object.entries(tableMeta)) {
      if (out[key] !== undefined && out[key] !== null) {
        continue;
      }

      if (meta.defaultValue === 'uuid') {
        out[key] = randomUUID();
      }
    }

    return out;
  }

  function coerceInput(value: unknown, type: ColumnType): unknown {
    switch (type) {
      case 'boolean':
        if (!caps.supportsBooleans && typeof value === 'boolean') {
          return value ? 1 : 0;
        }
        return value;

      case 'date':
        if (!caps.supportsDates && value instanceof Date) {
          return value.toISOString();
        }
        return value;

      case 'json':
        if (!caps.supportsJSON && typeof value === 'object' && value !== null) {
          return JSON.stringify(value);
        }
        return value;

      case 'string[]':
        if (!caps.supportsArrays && Array.isArray(value)) {
          return JSON.stringify(value);
        }
        return value;

      default:
        return value;
    }
  }

  // -------------------------------------------------------------------------
  // Output transform — after reading from DB
  // -------------------------------------------------------------------------

  function transformOutput(
    model: string,
    data: Record<string, unknown> | null,
  ): Record<string, unknown> | null {
    if (!data) {
      return null;
    }

    const tableMeta = schemaMeta[model];
    if (!tableMeta) {
      return data;
    }

    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      const meta = tableMeta[key];
      if (!meta || value === undefined || value === null) {
        out[key] = value;
        continue;
      }

      out[key] = coerceOutput(value, meta.type);
    }
    return out;
  }

  function coerceOutput(value: unknown, type: ColumnType): unknown {
    switch (type) {
      case 'boolean':
        if (!caps.supportsBooleans && typeof value === 'number') {
          return value === 1;
        }
        return value;

      case 'date':
        if (!caps.supportsDates && typeof value === 'string') {
          return new Date(value);
        }
        return value;

      case 'json':
        if (!caps.supportsJSON && typeof value === 'string') {
          try {
            return JSON.parse(value);
          } catch {
            return value;
          }
        }
        return value;

      case 'string[]':
        if (!caps.supportsArrays && typeof value === 'string') {
          try {
            return JSON.parse(value);
          } catch {
            return value;
          }
        }
        return value;

      default:
        return value;
    }
  }

  // -------------------------------------------------------------------------
  // Where clause coercion
  // -------------------------------------------------------------------------

  function transformWhere(model: string, where: WhereClause[]): WhereClause[] {
    const tableMeta = schemaMeta[model];
    if (!tableMeta) {
      return where;
    }

    return where.map((clause) => {
      const meta = tableMeta[clause.field];
      if (!meta || clause.value === null || clause.value === undefined) {
        return clause;
      }
      return { ...clause, value: coerceInput(clause.value, meta.type) };
    });
  }

  // -------------------------------------------------------------------------
  // Build the wrapped adapter
  // -------------------------------------------------------------------------

  function wrapAdapter(raw: RawFlowlibAdapter): FlowlibAdapter {
    const executeRaw = raw.executeRaw;

    return {
      dialect: config.dialect,

      async create<T extends Record<string, unknown>>({
        model,
        data,
      }: {
        model: string;
        data: T;
      }): Promise<T> {
        const withDefaults = applyCreateDefaults(model, data);
        const transformed = transformInput(model, withDefaults) as T;
        const result = await raw.create({ model, data: transformed });
        return transformOutput(model, result) as T;
      },

      async findOne<T extends Record<string, unknown>>({
        model,
        where,
        select,
      }: {
        model: string;
        where: WhereClause[];
        select?: string[];
      }): Promise<T | null> {
        const transformedWhere = transformWhere(model, where);
        const result = await raw.findOne({ model, where: transformedWhere, select });
        return transformOutput(model, result) as T | null;
      },

      async findMany<T extends Record<string, unknown>>({
        model,
        where,
        limit,
        offset,
        sortBy,
        select,
      }: {
        model: string;
        where?: WhereClause[];
        limit?: number;
        offset?: number;
        sortBy?: { field: string; direction: 'asc' | 'desc' };
        select?: string[];
      }): Promise<T[]> {
        const transformedWhere = where ? transformWhere(model, where) : undefined;
        const results = await raw.findMany({
          model,
          where: transformedWhere,
          limit,
          offset,
          sortBy,
          select,
        });
        return results.map((r) => transformOutput(model, r) as T);
      },

      async count({ model, where }: { model: string; where?: WhereClause[] }): Promise<number> {
        const transformedWhere = where ? transformWhere(model, where) : undefined;
        return raw.count({ model, where: transformedWhere });
      },

      async update<T extends Record<string, unknown>>({
        model,
        where,
        update: updateData,
        returning,
      }: {
        model: string;
        where: WhereClause[];
        update: Record<string, unknown>;
        returning?: boolean;
      }): Promise<T | null> {
        const transformedWhere = transformWhere(model, where);
        const transformedUpdate = transformInput(model, updateData);
        const result = await raw.update<T>({
          model,
          where: transformedWhere,
          update: transformedUpdate,
          returning,
        });
        return transformOutput(model, result) as T | null;
      },

      async updateMany({
        model,
        where,
        update: updateData,
      }: {
        model: string;
        where: WhereClause[];
        update: Record<string, unknown>;
      }): Promise<number> {
        const transformedWhere = transformWhere(model, where);
        const transformedUpdate = transformInput(model, updateData);
        return raw.updateMany({
          model,
          where: transformedWhere,
          update: transformedUpdate,
        });
      },

      async delete({ model, where }: { model: string; where: WhereClause[] }): Promise<void> {
        const transformedWhere = transformWhere(model, where);
        return raw.delete({ model, where: transformedWhere });
      },

      async deleteMany({ model, where }: { model: string; where: WhereClause[] }): Promise<number> {
        const transformedWhere = transformWhere(model, where);
        return raw.deleteMany({ model, where: transformedWhere });
      },

      executeRaw: executeRaw
        ? async <T extends Record<string, unknown>>(sqlStr: string, params?: unknown[]) => {
            return executeRaw<T>(sqlStr, params);
          }
        : undefined,

      async transaction<R>(callback: (trx: FlowlibAdapter) => Promise<R>): Promise<R> {
        return raw.transaction(async (rawTrx) => {
          const wrappedTrx = wrapAdapter(rawTrx);
          return callback(wrappedTrx);
        });
      },
    };
  }

  return wrapAdapter(rawAdapter);
}
