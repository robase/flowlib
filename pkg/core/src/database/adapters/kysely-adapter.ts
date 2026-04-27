/**
 * Kysely-based raw adapter for Flowlib.
 *
 * Implements RawFlowlibAdapter using Kysely's type-safe query builder.
 * Dialect-specific quirks (e.g. MySQL's lack of RETURNING) are handled here.
 */

import { Kysely, sql, type Transaction } from 'kysely';
import type { RawFlowlibAdapter, WhereClause, AdapterConfig } from '../adapter';

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createKyselyAdapter(
  db: Kysely<Record<string, Record<string, unknown>>>,
  config: AdapterConfig,
): RawFlowlibAdapter {
  const supportsReturning = config.supportsReturning ?? config.dialect !== 'mysql';

  /**
   * Build a Kysely expression from WhereClause[].
   */
  function applyWhere(
    qb: { where: (...args: unknown[]) => unknown },
    where: WhereClause[],
  ): unknown {
    let q = qb as unknown;
    for (const clause of where) {
      const op = clause.operator ?? 'eq';
      const field = clause.field;
      const value = clause.value;

      const method = clause.connector === 'OR' ? 'orWhere' : 'where';

      switch (op) {
        case 'eq':
          q = (q as Record<string, CallableFunction>)[method](field, '=', value);
          break;
        case 'ne':
          q = (q as Record<string, CallableFunction>)[method](field, '<>', value);
          break;
        case 'lt':
          q = (q as Record<string, CallableFunction>)[method](field, '<', value);
          break;
        case 'lte':
          q = (q as Record<string, CallableFunction>)[method](field, '<=', value);
          break;
        case 'gt':
          q = (q as Record<string, CallableFunction>)[method](field, '>', value);
          break;
        case 'gte':
          q = (q as Record<string, CallableFunction>)[method](field, '>=', value);
          break;
        case 'in':
          q = (q as Record<string, CallableFunction>)[method](field, 'in', value as unknown[]);
          break;
        case 'not_in':
          q = (q as Record<string, CallableFunction>)[method](field, 'not in', value as unknown[]);
          break;
        case 'like':
          q = (q as Record<string, CallableFunction>)[method](field, 'like', value);
          break;
        case 'is_null':
          q = (q as Record<string, CallableFunction>)[method](field, 'is', null);
          break;
        case 'is_not_null':
          q = (q as Record<string, CallableFunction>)[method](field, 'is not', null);
          break;
      }
    }
    return q;
  }

  function buildAdapter(
    dbInstance:
      | Kysely<Record<string, Record<string, unknown>>>
      | Transaction<Record<string, Record<string, unknown>>>,
  ): RawFlowlibAdapter {
    return {
      // -------------------------------------------------------------------
      // CREATE
      // -------------------------------------------------------------------
      async create<T extends Record<string, unknown>>({
        model,
        data,
      }: {
        model: string;
        data: T;
      }): Promise<T> {
        if (supportsReturning) {
          const result = await dbInstance
            .insertInto(model)
            .values(data as never)
            .returningAll()
            .executeTakeFirstOrThrow();
          return result as T;
        }

        // MySQL: insert then select back
        await dbInstance
          .insertInto(model)
          .values(data as never)
          .execute();
        if ('id' in data && data.id !== null && data.id !== undefined) {
          const result = await dbInstance
            .selectFrom(model)
            .selectAll()
            .where('id', '=', data.id as string)
            .executeTakeFirstOrThrow();
          return result as T;
        }
        // Fallback — return the input data as-is (MySQL with no ID)
        return data;
      },

      // -------------------------------------------------------------------
      // FIND ONE
      // -------------------------------------------------------------------
      async findOne<T extends Record<string, unknown>>({
        model,
        where,
        select,
      }: {
        model: string;
        where: WhereClause[];
        select?: string[];
      }): Promise<T | null> {
        let qb = dbInstance.selectFrom(model) as unknown;

        if (select && select.length > 0) {
          qb = (qb as Record<string, CallableFunction>).select(select);
        } else {
          qb = (qb as Record<string, CallableFunction>).selectAll();
        }

        if (where.length > 0) {
          qb = applyWhere(qb as { where: (...args: unknown[]) => unknown }, where);
        }

        qb = (qb as Record<string, CallableFunction>).limit(1);

        const result = await (
          qb as { executeTakeFirst: () => Promise<Record<string, unknown> | undefined> }
        ).executeTakeFirst();

        return (result as T) ?? null;
      },

      // -------------------------------------------------------------------
      // FIND MANY
      // -------------------------------------------------------------------
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
        let qb = dbInstance.selectFrom(model) as unknown;

        if (select && select.length > 0) {
          qb = (qb as Record<string, CallableFunction>).select(select);
        } else {
          qb = (qb as Record<string, CallableFunction>).selectAll();
        }

        if (where && where.length > 0) {
          qb = applyWhere(qb as { where: (...args: unknown[]) => unknown }, where);
        }

        if (sortBy) {
          qb = (qb as Record<string, CallableFunction>).orderBy(sortBy.field, sortBy.direction);
        }

        if (limit !== undefined) {
          qb = (qb as Record<string, CallableFunction>).limit(limit);
        }

        if (offset !== undefined) {
          qb = (qb as Record<string, CallableFunction>).offset(offset);
        }

        const results = await (
          qb as { execute: () => Promise<Record<string, unknown>[]> }
        ).execute();

        return results as T[];
      },

      // -------------------------------------------------------------------
      // COUNT
      // -------------------------------------------------------------------
      async count({ model, where }: { model: string; where?: WhereClause[] }): Promise<number> {
        let qb = dbInstance.selectFrom(model).select(sql`count(*) as count` as never) as unknown;

        if (where && where.length > 0) {
          qb = applyWhere(qb as { where: (...args: unknown[]) => unknown }, where);
        }

        const result = await (
          qb as { executeTakeFirstOrThrow: () => Promise<{ count: unknown }> }
        ).executeTakeFirstOrThrow();

        return Number(result.count);
      },

      // -------------------------------------------------------------------
      // UPDATE
      // -------------------------------------------------------------------
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
        let qb = dbInstance.updateTable(model).set(updateData as never) as unknown;

        if (where.length > 0) {
          qb = applyWhere(qb as { where: (...args: unknown[]) => unknown }, where);
        }

        if (supportsReturning && returning !== false) {
          qb = (qb as Record<string, CallableFunction>).returningAll();
          const result = await (
            qb as { executeTakeFirst: () => Promise<Record<string, unknown> | undefined> }
          ).executeTakeFirst();
          return (result as T) ?? null;
        }

        // MySQL or returning=false: execute then select back
        await (qb as { execute: () => Promise<unknown> }).execute();

        if (returning !== false && where.length > 0) {
          // Re-select the updated record
          return this.findOne<T>({ model, where });
        }
        return null;
      },

      // -------------------------------------------------------------------
      // UPDATE MANY
      // -------------------------------------------------------------------
      async updateMany({
        model,
        where,
        update: updateData,
      }: {
        model: string;
        where: WhereClause[];
        update: Record<string, unknown>;
      }): Promise<number> {
        let qb = dbInstance.updateTable(model).set(updateData as never) as unknown;

        if (where.length > 0) {
          qb = applyWhere(qb as { where: (...args: unknown[]) => unknown }, where);
        }

        const result = await (
          qb as { executeTakeFirstOrThrow: () => Promise<{ numUpdatedRows: bigint }> }
        ).executeTakeFirstOrThrow();

        return Number(result.numUpdatedRows);
      },

      // -------------------------------------------------------------------
      // DELETE
      // -------------------------------------------------------------------
      async delete({ model, where }: { model: string; where: WhereClause[] }): Promise<void> {
        let qb = dbInstance.deleteFrom(model) as unknown;

        if (where.length > 0) {
          qb = applyWhere(qb as { where: (...args: unknown[]) => unknown }, where);
        }

        await (qb as { execute: () => Promise<unknown> }).execute();
      },

      // -------------------------------------------------------------------
      // DELETE MANY
      // -------------------------------------------------------------------
      async deleteMany({ model, where }: { model: string; where: WhereClause[] }): Promise<number> {
        let qb = dbInstance.deleteFrom(model) as unknown;

        if (where.length > 0) {
          qb = applyWhere(qb as { where: (...args: unknown[]) => unknown }, where);
        }

        const result = await (
          qb as { executeTakeFirstOrThrow: () => Promise<{ numDeletedRows: bigint }> }
        ).executeTakeFirstOrThrow();

        return Number(result.numDeletedRows);
      },

      // -------------------------------------------------------------------
      // RAW QUERY
      // -------------------------------------------------------------------
      async executeRaw<T extends Record<string, unknown>>(
        sqlStr: string,
        _params?: unknown[],
      ): Promise<T[]> {
        const result = await sql.raw(sqlStr).execute(dbInstance);
        return (result.rows ?? []) as T[];
      },

      // -------------------------------------------------------------------
      // TRANSACTION
      // -------------------------------------------------------------------
      async transaction<R>(callback: (trx: RawFlowlibAdapter) => Promise<R>): Promise<R> {
        return dbInstance.transaction().execute(async (trx) => {
          const transactionAdapter = buildAdapter(
            trx as Transaction<Record<string, Record<string, unknown>>>,
          );
          return callback(transactionAdapter);
        });
      },
    };
  }

  return buildAdapter(db);
}
