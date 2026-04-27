/**
 * Schema Generator Types
 *
 * Generator type system — each generator takes
 * a common input and returns { code, fileName, overwrite? }.
 */

export interface SchemaGeneratorOptions {
  /** Resolved plugins from the config */
  plugins: Array<{
    id: string;
    name?: string;
    schema?: Record<string, unknown>;
    [key: string]: unknown;
  }>;
  /** Output file path (relative or absolute) */
  file?: string;
  /** Database dialect to generate for */
  dialect: 'sqlite' | 'postgresql' | 'mysql';
  /**
   * Optional schema transforms (e.g., column injection for multi-tenancy).
   * Typed as `unknown[]` here so this types module stays free of `@flowlib/core`
   * dependencies; the generator passes them straight through to `mergeSchemas`.
   */
  transforms?: unknown[];
}

export interface SchemaGeneratorResult {
  /** Generated source code (undefined if no changes needed) */
  code: string | undefined;
  /** Output file name/path */
  fileName: string;
  /** Whether to overwrite an existing file */
  overwrite?: boolean;
}

export type SchemaGenerator = (options: SchemaGeneratorOptions) => Promise<SchemaGeneratorResult>;
