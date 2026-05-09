/**
 * Tiny in-memory fake of the Kysely surface used by the agents
 * repositories. Just enough to exercise:
 *
 *   selectFrom().selectAll().where().limit().offset().orderBy().execute()
 *   selectFrom().selectAll().where().limit(1).executeTakeFirst()
 *   insertInto().values().execute()
 *   updateTable().set().where().execute()
 *   deleteFrom().where().execute()
 *
 * Rows live in a `Map<table, Row[]>`. WHERE clauses are evaluated
 * synchronously over the array. The fake honours `is null` semantics for
 * `org_id` matching and supports `>` / `=` operators (the only ones the
 * repos use).
 *
 * This is not a SQL engine — it's a unit-test substrate for the v1
 * repositories. It runs anywhere (Node, Workers) without native deps.
 */

import type { PluginDatabaseApi } from '@flowlib/core';

export type Row = Record<string, unknown>;

interface WhereClause {
  column: string;
  op: '=' | '>' | '<' | 'is';
  value: unknown;
}

interface OrderClause {
  column: string;
  dir: 'asc' | 'desc';
}

class SelectBuilder {
  private wheres: WhereClause[] = [];
  private orders: OrderClause[] = [];
  private _limit?: number;
  private _offset?: number;

  constructor(
    private readonly rows: Row[],
  ) {}

  selectAll(): this {
    return this;
  }

  where(column: string, op: WhereClause['op'], value: unknown): this {
    this.wheres.push({ column, op, value });
    return this;
  }

  orderBy(column: string, dir: OrderClause['dir']): this {
    this.orders.push({ column, dir });
    return this;
  }

  limit(n: number): this {
    this._limit = n;
    return this;
  }

  offset(n: number): this {
    this._offset = n;
    return this;
  }

  private apply(): Row[] {
    let result = this.rows.filter((row) =>
      this.wheres.every((w) => {
        const v = row[w.column];
        if (w.op === '=') {return v === w.value;}
        if (w.op === '>') {return typeof v === 'number' && typeof w.value === 'number' && v > w.value;}
        if (w.op === '<') {return typeof v === 'number' && typeof w.value === 'number' && v < w.value;}
        if (w.op === 'is' && w.value === null) {return v === null || v === undefined;}
        return false;
      }),
    );
    if (this.orders.length > 0) {
      result = result.slice().sort((a, b) => {
        for (const o of this.orders) {
          const av = a[o.column];
          const bv = b[o.column];
          if (av === bv) {continue;}
          if (av === null || av === undefined) {return o.dir === 'asc' ? -1 : 1;}
          if (bv === null || bv === undefined) {return o.dir === 'asc' ? 1 : -1;}
          if ((av as number) < (bv as number)) {return o.dir === 'asc' ? -1 : 1;}
          if ((av as number) > (bv as number)) {return o.dir === 'asc' ? 1 : -1;}
        }
        return 0;
      });
    }
    if (this._offset !== undefined) {result = result.slice(this._offset);}
    if (this._limit !== undefined) {result = result.slice(0, this._limit);}
    return result;
  }

  async execute(): Promise<Row[]> {
    return this.apply();
  }

  async executeTakeFirst(): Promise<Row | undefined> {
    const list = this.apply();
    return list[0];
  }
}

class InsertBuilder {
  private _values: Row | null = null;
  constructor(private readonly rows: Row[]) {}

  values(v: Row): this {
    this._values = { ...v };
    return this;
  }

  async execute(): Promise<void> {
    if (this._values) {
      this.rows.push(this._values);
    }
  }
}

class UpdateBuilder {
  private _set: Row = {};
  private wheres: WhereClause[] = [];

  constructor(private readonly rows: Row[]) {}

  set(s: Row): this {
    this._set = { ...s };
    return this;
  }

  where(column: string, op: WhereClause['op'], value: unknown): this {
    this.wheres.push({ column, op, value });
    return this;
  }

  async execute(): Promise<void> {
    for (const row of this.rows) {
      const matches = this.wheres.every((w) => {
        const v = row[w.column];
        if (w.op === '=') {return v === w.value;}
        if (w.op === 'is' && w.value === null) {return v === null || v === undefined;}
        return false;
      });
      if (matches) {
        Object.assign(row, this._set);
      }
    }
  }
}

class DeleteBuilder {
  private wheres: WhereClause[] = [];

  constructor(private readonly tables: Map<string, Row[]>, private readonly tableName: string) {}

  where(column: string, op: WhereClause['op'], value: unknown): this {
    this.wheres.push({ column, op, value });
    return this;
  }

  async execute(): Promise<void> {
    const current = this.tables.get(this.tableName) ?? [];
    const remaining = current.filter((row) =>
      !this.wheres.every((w) => {
        const v = row[w.column];
        if (w.op === '=') {return v === w.value;}
        if (w.op === 'is' && w.value === null) {return v === null || v === undefined;}
        return false;
      }),
    );
    this.tables.set(this.tableName, remaining);
  }
}

class FakeKysely {
  constructor(private readonly tables: Map<string, Row[]>) {}

  selectFrom(name: string): SelectBuilder {
    let rows = this.tables.get(name);
    if (!rows) {
      rows = [];
      this.tables.set(name, rows);
    }
    return new SelectBuilder(rows);
  }

  insertInto(name: string): InsertBuilder {
    let rows = this.tables.get(name);
    if (!rows) {
      rows = [];
      this.tables.set(name, rows);
    }
    return new InsertBuilder(rows);
  }

  updateTable(name: string): UpdateBuilder {
    let rows = this.tables.get(name);
    if (!rows) {
      rows = [];
      this.tables.set(name, rows);
    }
    return new UpdateBuilder(rows);
  }

  deleteFrom(name: string): DeleteBuilder {
    return new DeleteBuilder(this.tables, name);
  }
}

/** Build a fake `PluginDatabaseApi` backed by an in-memory table store. */
export function makeFakeDatabase(
  type: PluginDatabaseApi['type'] = 'sqlite',
): PluginDatabaseApi & { _tables: Map<string, Row[]> } {
  const tables = new Map<string, Row[]>();
  const kyselyHandle = new FakeKysely(tables);

  const api = {
    type,
    async query<T = Row>() {
      return [] as T[];
    },
    async execute() {
      // no-op
    },
    async executeRows<T = Row>() {
      return [] as T[];
    },
    drizzle: undefined,
    kysely<DB>(): unknown {
      return kyselyHandle as unknown as DB;
    },
    _tables: tables,
  } as unknown as PluginDatabaseApi & { _tables: Map<string, Row[]> };

  return api;
}
