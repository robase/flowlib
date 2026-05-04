/**
 * Plugin Schema Types (Abstract, database-agnostic)
 *
 * Plugins declare their database schema in this dialect-agnostic format.
 * The schema generator (`./schema-generator.ts`) translates this into
 * concrete Drizzle column definitions per dialect (SQLite/Postgres/MySQL).
 *
 * Lives in `@flowlib/db` rather than `@flowlib/core` so that schema
 * tooling (CLI generator, schema-merger, third-party schema consumers)
 * can use these types without pulling in the full core runtime.
 *
 * `@flowlib/core`'s `plugin.types.ts` re-exports these for back-compat
 * with existing plugin authors.
 */

/**
 * Abstract field types that map to concrete column types per dialect.
 *
 * | Abstract    | SQLite        | PostgreSQL       | MySQL              |
 * |-------------|---------------|------------------|--------------------|
 * | "string"    | text          | text             | varchar(255)       |
 * | "text"      | text          | text             | text               |
 * | "number"    | integer       | integer          | int                |
 * | "boolean"   | integer(bool) | boolean          | boolean            |
 * | "date"      | text          | timestamp        | timestamp          |
 * | "json"      | text(json)    | json             | json               |
 * | "uuid"      | text          | uuid             | varchar(36)        |
 * | "bigint"    | integer       | bigint           | bigint             |
 * | string[]    | N/A (enum)    | pgEnum values    | mysqlEnum values   |
 */
export type PluginFieldType =
  | 'string'
  | 'text'
  | 'number'
  | 'boolean'
  | 'date'
  | 'json'
  | 'uuid'
  | 'bigint'
  | string[]; // Enum values — generates pgEnum/mysqlEnum/text

/**
 * Abstract field definition for plugin database schemas.
 *
 * Plugins declare fields using this format. The CLI schema generator
 * converts these to dialect-specific Drizzle column definitions.
 */
export interface PluginFieldAttribute {
  /** Abstract column type */
  type: PluginFieldType;

  /**
   * Whether the field is required (NOT NULL).
   * @default true
   */
  required?: boolean;

  /** Whether to add a UNIQUE constraint */
  unique?: boolean;

  /** Whether this field is the primary key (or part of a composite PK) */
  primaryKey?: boolean;

  /**
   * Foreign key reference.
   * `table` is the Drizzle table name (e.g., "flows", "credentials").
   */
  references?: {
    table: string;
    field: string;
    onDelete?: 'cascade' | 'set null' | 'restrict' | 'no action';
  };

  /** Whether to create an index on this column */
  index?: boolean;

  /**
   * Default value for the column.
   * - Primitives are used as literal defaults
   * - "uuid()" generates a UUID default
   * - "now()" generates a current timestamp default
   * - "true" / "false" for booleans
   */
  defaultValue?: string | number | boolean | 'uuid()' | 'now()';

  /**
   * For string fields, the max length (MySQL varchar).
   * Ignored for SQLite/PostgreSQL text columns.
   * @default 255
   */
  maxLength?: number;

  /**
   * TypeScript type annotation for the column (Drizzle's $type<>()).
   * Used for JSON columns or text columns storing typed data.
   *
   * @example "Record<string, unknown>"
   * @example "string[]"
   */
  typeAnnotation?: string;

  /**
   * JSON mode for text/json columns.
   * When true on SQLite, uses text({ mode: 'json' }).
   */
  jsonMode?: boolean;
}

/**
 * Abstract table definition for plugin schemas.
 */
export interface PluginTableDefinition {
  /**
   * Column definitions keyed by field name.
   * Field names are camelCase; the generator converts to snake_case for DB columns.
   */
  fields: Record<string, PluginFieldAttribute>;

  /**
   * Composite primary key columns (if not using a single-column PK).
   * Array of field names that together form the primary key.
   */
  compositePrimaryKey?: string[];

  /**
   * Whether to skip this table in migration generation.
   * Useful for tables that are conditionally created.
   * @default false
   */
  disableMigration?: boolean;

  /**
   * Custom DB table name. If not provided, the key in the schema object
   * is used, converted to snake_case.
   */
  tableName?: string;

  /**
   * Table creation order hint. Lower numbers are created first.
   * Use this when tables have foreign key dependencies.
   * @default 100
   */
  order?: number;
}

/**
 * Plugin schema declaration.
 *
 * Keys are logical table names (camelCase). Use an existing core table name
 * (e.g., "flows", "credentials") to add fields to that table (additive only).
 *
 * @example
 * ```typescript
 * const schema: FlowlibPluginSchema = {
 *   // New table
 *   auditLogs: {
 *     fields: {
 *       id: { type: 'uuid', primaryKey: true, defaultValue: 'uuid()' },
 *       action: { type: 'string', required: true },
 *       userId: { type: 'string', references: { table: 'flows', field: 'id' } },
 *       metadata: { type: 'json' },
 *       createdAt: { type: 'date', defaultValue: 'now()' },
 *     },
 *   },
 *   // Extend existing core table
 *   flows: {
 *     fields: {
 *       ownerId: { type: 'string' },
 *       tenantId: { type: 'string', index: true },
 *     },
 *   },
 * };
 * ```
 */
export type FlowlibPluginSchema = Record<string, PluginTableDefinition>;

/**
 * The narrow plugin shape `mergeSchemas()` needs — just the fields
 * touched during schema merging. The full `FlowlibPlugin` interface in
 * `@flowlib/core` is structurally a superset, so passing a list of
 * plugins to `mergeSchemas()` works without an explicit cast.
 */
export interface PluginSchemaSource {
  id: string;
  schema?: FlowlibPluginSchema;
}
