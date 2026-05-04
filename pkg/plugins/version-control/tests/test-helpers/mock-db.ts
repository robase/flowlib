/**
 * Shared mock-db helpers for the version-control plugin's vitest suite.
 *
 * After the raw-SQL → `db.executeRows(sql\`\`)` conversion, every test
 * mock needs an `executeRows` implementation. Rather than reproduce the
 * dispatch logic in each file, we route `executeRows` back into the
 * test's existing `query` mock by compiling the Drizzle SQL template
 * with a real SQLite dialect — so per-test `db.query.mockImplementation`
 * overrides keep working transparently.
 */

import { vi } from 'vitest';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import type { SQL } from 'drizzle-orm';
import {
  Kysely,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
  type Kysely as KyselyType,
} from 'kysely';

const dialect = new SQLiteSyncDialect();

export function compileSqliteSql(query: SQL): { sql: string; params: unknown[] } {
  const compiled = dialect.sqlToQuery(query);
  return { sql: compiled.sql, params: compiled.params };
}

/**
 * Wraps a vitest `query` mock so the same dispatch logic services
 * `executeRows` calls. Pass it the test's already-constructed query
 * mock; returns an `executeRows` mock function. Both the compiled SQL
 * string AND the extracted parameter array are forwarded — many test
 * mocks pattern-match on `params[0]` for `WHERE id = ?` lookups.
 */
export function makeExecuteRowsMock(
  queryMock: (sqlText: string, params?: unknown[]) => Promise<unknown[]>,
): ReturnType<typeof vi.fn> {
  return vi.fn(async (q: SQL) => {
    const { sql, params } = compileSqliteSql(q);
    return queryMock(sql, params);
  });
}

/**
 * Mutates a partial mock-db in place: adds an `executeRows` member that
 * delegates to the existing `query` mock by compiling Drizzle `sql\`\``
 * templates with the SQLite dialect, and a `kysely<DB>()` accessor that
 * routes Kysely-compiled SQL through the same `query`/`execute` mocks.
 *
 * The Kysely instance uses a custom dialect whose driver bridges into the
 * mock's `query` (for SELECT / RETURNING) and `execute` (for mutations) —
 * so `kysely<DB>().selectFrom(...).execute()` calls the same string-pattern
 * dispatcher that the `query`/`executeRows` paths already use.
 */
export function patchMockDb<
  T extends {
    query: (s: string, p?: unknown[]) => Promise<unknown[]>;
    execute?: (s: string, p?: unknown[]) => Promise<unknown> | unknown;
  },
>(
  db: T,
): T & {
  executeRows: ReturnType<typeof vi.fn>;
  kysely: <DB>() => KyselyType<DB>;
} {
  const patched = db as T & {
    executeRows?: ReturnType<typeof vi.fn>;
    kysely?: <DB>() => KyselyType<DB>;
  };
  patched.executeRows = makeExecuteRowsMock(db.query);

  // Custom Kysely dialect that delegates query execution back into the
  // mock's existing query/execute spies. Reuses the SQLite syntax compiler
  // (so `?` placeholders are emitted, matching what the mock's `query`
  // pattern-matchers already expect from the Drizzle-emitted SQL).
  const kyselyInstance = new Kysely<unknown>({
    dialect: {
      createAdapter: () => new SqliteAdapter(),
      createDriver: () => ({
        init: async () => {},
        acquireConnection: async () => ({
          executeQuery: async (compiledQuery: { sql: string; parameters: unknown[] }) => {
            const text = compiledQuery.sql.trimStart();
            const isRead = /^(SELECT|WITH|PRAGMA|EXPLAIN)/i.test(text);
            const hasReturning = /\bRETURNING\b/i.test(text);
            if (isRead || hasReturning) {
              const rows = await db.query(compiledQuery.sql, [...compiledQuery.parameters]);
              return { rows, numAffectedRows: BigInt(rows.length) };
            }
            await db.execute?.(compiledQuery.sql, [...compiledQuery.parameters]);
            return { rows: [], numAffectedRows: 0n };
          },
          streamQuery: () => {
            throw new Error('Streaming not supported in test mock');
          },
        }),
        beginTransaction: async () => {},
        commitTransaction: async () => {},
        rollbackTransaction: async () => {},
        releaseConnection: async () => {},
        destroy: async () => {},
      }),
      createIntrospector: (k: KyselyType<unknown>) => new SqliteIntrospector(k),
      createQueryCompiler: () => new SqliteQueryCompiler(),
    },
  });
  patched.kysely = <DB>() => kyselyInstance as unknown as KyselyType<DB>;

  return patched as T & {
    executeRows: ReturnType<typeof vi.fn>;
    kysely: <DB>() => KyselyType<DB>;
  };
}
