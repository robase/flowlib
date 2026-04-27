/**
 * Flowlib Database Adapter Interface
 *
 * Inspired by better-auth's adapter pattern. Provides a model-string-based
 * interface for CRUD operations so that model classes no longer need 3-way
 * dialect branching.
 *
 * The adapter factory wraps a raw adapter with type coercion (booleans,
 * dates, JSON, arrays) so that raw adapters stay simple.
 */

// ---------------------------------------------------------------------------
// Where clause types
// ---------------------------------------------------------------------------

export type WhereOperator =
  | 'eq'
  | 'ne'
  | 'lt'
  | 'lte'
  | 'gt'
  | 'gte'
  | 'in'
  | 'not_in'
  | 'like'
  | 'is_null'
  | 'is_not_null';

export interface WhereClause {
  field: string;
  operator?: WhereOperator; // default: 'eq'
  value: unknown;
  connector?: 'AND' | 'OR'; // default: 'AND'
}

// ---------------------------------------------------------------------------
// Adapter interface — what model classes call
// ---------------------------------------------------------------------------

export interface FlowlibAdapter {
  readonly dialect: 'sqlite' | 'postgresql' | 'mysql';

  create<T extends Record<string, unknown>>(params: { model: string; data: T }): Promise<T>;

  findOne<T extends Record<string, unknown>>(params: {
    model: string;
    where: WhereClause[];
    select?: string[];
  }): Promise<T | null>;

  findMany<T extends Record<string, unknown>>(params: {
    model: string;
    where?: WhereClause[];
    limit?: number;
    offset?: number;
    sortBy?: { field: string; direction: 'asc' | 'desc' };
    select?: string[];
  }): Promise<T[]>;

  count(params: { model: string; where?: WhereClause[] }): Promise<number>;

  update<T extends Record<string, unknown>>(params: {
    model: string;
    where: WhereClause[];
    update: Record<string, unknown>;
    /** Return the updated record (needs extra SELECT on MySQL). */
    returning?: boolean;
  }): Promise<T | null>;

  updateMany(params: {
    model: string;
    where: WhereClause[];
    update: Record<string, unknown>;
  }): Promise<number>;

  delete(params: { model: string; where: WhereClause[] }): Promise<void>;

  deleteMany(params: { model: string; where: WhereClause[] }): Promise<number>;

  /**
   * Execute a raw SQL query string. Primarily used by the sql_query action
   * and the postgres action for user-provided queries against external DBs.
   */
  executeRaw?<T extends Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;

  /**
   * Run multiple operations in a database transaction.
   */
  transaction<R>(callback: (trx: FlowlibAdapter) => Promise<R>): Promise<R>;
}

// ---------------------------------------------------------------------------
// Raw adapter interface — what backend implementations provide
//
// This is the minimal set of operations a new adapter must implement.
// The adapter factory wraps this with type coercion.
// ---------------------------------------------------------------------------

export interface RawFlowlibAdapter {
  create<T extends Record<string, unknown>>(params: { model: string; data: T }): Promise<T>;

  findOne<T extends Record<string, unknown>>(params: {
    model: string;
    where: WhereClause[];
    select?: string[];
  }): Promise<T | null>;

  findMany<T extends Record<string, unknown>>(params: {
    model: string;
    where?: WhereClause[];
    limit?: number;
    offset?: number;
    sortBy?: { field: string; direction: 'asc' | 'desc' };
    select?: string[];
  }): Promise<T[]>;

  count(params: { model: string; where?: WhereClause[] }): Promise<number>;

  update<T extends Record<string, unknown>>(params: {
    model: string;
    where: WhereClause[];
    update: Record<string, unknown>;
    returning?: boolean;
  }): Promise<T | null>;

  updateMany(params: {
    model: string;
    where: WhereClause[];
    update: Record<string, unknown>;
  }): Promise<number>;

  delete(params: { model: string; where: WhereClause[] }): Promise<void>;

  deleteMany(params: { model: string; where: WhereClause[] }): Promise<number>;

  executeRaw?<T extends Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;

  transaction<R>(callback: (trx: RawFlowlibAdapter) => Promise<R>): Promise<R>;
}

// ---------------------------------------------------------------------------
// Adapter config — dialect capabilities
// ---------------------------------------------------------------------------

export interface AdapterConfig {
  dialect: 'sqlite' | 'postgresql' | 'mysql';
  /** SQLite stores booleans as 0/1 integers. @default true */
  supportsBooleans?: boolean;
  /** SQLite stores dates as ISO strings. @default true */
  supportsDates?: boolean;
  /** Only PostgreSQL has native JSON columns. @default false */
  supportsJSON?: boolean;
  /** MySQL doesn't support RETURNING. @default true */
  supportsReturning?: boolean;
  /** No native array columns outside PostgreSQL. @default false */
  supportsArrays?: boolean;
}

/**
 * Default capabilities per dialect.
 */
export function getDefaultCapabilities(
  dialect: AdapterConfig['dialect'],
): Required<Omit<AdapterConfig, 'dialect'>> {
  switch (dialect) {
    case 'sqlite':
      return {
        supportsBooleans: false,
        supportsDates: false,
        supportsJSON: false,
        supportsReturning: true,
        supportsArrays: false,
      };
    case 'postgresql':
      return {
        supportsBooleans: true,
        supportsDates: true,
        supportsJSON: true,
        supportsReturning: true,
        supportsArrays: true,
      };
    case 'mysql':
      return {
        supportsBooleans: true,
        supportsDates: true,
        supportsJSON: true,
        supportsReturning: false,
        supportsArrays: false,
      };
  }
}
