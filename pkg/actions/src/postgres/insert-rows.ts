/**
 * postgres.insert_rows — Insert rows into a PostgreSQL table
 *
 * Accepts an array of JSON objects and inserts them into the specified
 * table. Returns the inserted rows (via RETURNING *).
 */

import { defineAction } from '@flowlib/action-kit';
import { POSTGRES_PROVIDER } from '../providers';
import { z } from 'zod/v4';
import pgLib from 'postgres';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Database credential is required'),
  tableName: z.string().min(1, 'Table name is required'),
  schemaName: z.string().optional().default('public'),
  rows: z
    .string()
    .min(1, 'Rows JSON is required')
    .describe('JSON array of objects, e.g. [{"name":"Alice","age":30}]'),
  onConflict: z.enum(['error', 'do_nothing']).optional().default('error'),
});

export const postgresInsertRowsAction = defineAction({
  id: 'postgres.insert_rows',
  name: 'Insert Rows',
  description:
    'Insert one or more rows into a PostgreSQL table from a JSON array. Returns the inserted rows via RETURNING *. ' +
    'Use when you need to add new records to a table. Pass `rows` as a JSON array of objects where keys match column names.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"inserted": [{"id": 1, "name": "Alice", "age": 30}], "insertedCount": 1}\n' +
    '```',
  provider: POSTGRES_PROVIDER,
  actionCategory: 'write',
  tags: ['postgres', 'postgresql', 'sql', 'database', 'insert', 'rows', 'write', 'add', 'db'],

  credential: {
    required: true,
    type: 'database',
    description: 'PostgreSQL database connection credential',
  },

  params: {
    schema: paramsSchema,
    fields: [
      {
        name: 'credentialId',
        label: 'Database Credential',
        type: 'text',
        required: true,
        description: 'Select a PostgreSQL database connection credential',
        aiProvided: false,
      },
      {
        name: 'tableName',
        label: 'Table Name',
        type: 'text',
        required: true,
        placeholder: 'e.g. users',
        description: 'Target table for the insert.',
        aiProvided: true,
      },
      {
        name: 'schemaName',
        label: 'Schema',
        type: 'text',
        defaultValue: 'public',
        description: 'PostgreSQL schema the table belongs to.',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'rows',
        label: 'Rows (JSON)',
        type: 'json',
        required: true,
        placeholder: '[{"name": "Alice", "age": 30}]',
        description:
          'JSON array of objects to insert. Keys must match column names. Supports template expressions.',
        aiProvided: true,
      },
      {
        name: 'onConflict',
        label: 'On Conflict',
        type: 'select',
        defaultValue: 'error',
        options: [
          { label: 'Raise Error', value: 'error' },
          { label: 'Do Nothing (skip duplicates)', value: 'do_nothing' },
        ],
        description: 'Behaviour when a unique/PK constraint is violated.',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  async execute(params, context) {
    const { credentialId, tableName, schemaName, rows: rowsJson, onConflict } = params;

    let credential = context.credential;
    if (!credential && context.functions?.getCredential) {
      credential = await context.functions.getCredential(credentialId);
    }
    if (!credential) {
      return { success: false, error: `Failed to load database credential: ${credentialId}` };
    }

    const config = credential.config;
    if (
      typeof config !== 'object' ||
      config === null ||
      !('connectionString' in config) ||
      typeof config.connectionString !== 'string'
    ) {
      return { success: false, error: 'Invalid database credential — missing connectionString' };
    }

    // Parse the rows JSON
    let rows: Record<string, unknown>[];
    try {
      const parsed = JSON.parse(rowsJson);
      rows = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return {
        success: false,
        error: 'Invalid JSON in rows field. Expected a JSON array of objects.',
      };
    }

    if (rows.length === 0) {
      return { success: false, error: 'At least one row is required.' };
    }

    const sslOpt =
      config.ssl === true
        ? { rejectUnauthorized: false }
        : typeof config.ssl === 'object'
          ? (config.ssl as { rejectUnauthorized?: boolean })
          : undefined;

    const sql = pgLib(config.connectionString, { ssl: sslOpt, max: 1 });

    try {
      const columns = Object.keys(rows[0]);
      const fqTable = `"${schemaName}"."${tableName}"`;

      // Build parameterised VALUES clause
      const valuePlaceholders = rows
        .map((_, rowIdx) => {
          const placeholders = columns.map(
            (_, colIdx) => `$${rowIdx * columns.length + colIdx + 1}`,
          );
          return `(${placeholders.join(', ')})`;
        })
        .join(', ');

      const flatValues = rows.flatMap((row) =>
        columns.map((col) => (row[col] ?? null) as string | number | boolean | null),
      );

      let insertQuery = `INSERT INTO ${fqTable} (${columns.map((c) => `"${c}"`).join(', ')}) VALUES ${valuePlaceholders}`;

      if (onConflict === 'do_nothing') {
        insertQuery += ' ON CONFLICT DO NOTHING';
      }

      insertQuery += ' RETURNING *';

      context.logger.debug('postgres.insert_rows', { tableName, rowCount: rows.length });

      const result = await sql.unsafe(insertQuery, flatValues);
      const inserted = Array.isArray(result) ? result : [];

      return {
        success: true,
        output: { inserted, insertedCount: inserted.length },
        metadata: { tableName, schema: schemaName, insertedCount: inserted.length },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Insert failed: ${msg}` };
    } finally {
      await sql.end().catch(() => {
        /* connection cleanup */
      });
    }
  },
});
