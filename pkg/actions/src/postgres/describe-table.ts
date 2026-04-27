/**
 * postgres.describe_table — Describe columns of a PostgreSQL table
 *
 * Returns column names, data types, nullability, defaults, and
 * primary-key / foreign-key constraints for a given table.
 */

import { defineAction } from '@flowlib/action-kit';
import { POSTGRES_PROVIDER } from '../providers';
import { z } from 'zod/v4';
import pgLib from 'postgres';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Database credential is required'),
  tableName: z.string().min(1, 'Table name is required'),
  schemaName: z.string().optional().default('public'),
});

export const postgresDescribeTableAction = defineAction({
  id: 'postgres.describe_table',
  name: 'Describe Table',
  description:
    'Retrieve column definitions, data types, nullability, defaults, and key constraints for a PostgreSQL table. ' +
    'Use when you need to understand the schema of a specific table before writing queries or inserting data.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"tableName": "users", "columns": [{"column_name": "id", "data_type": "integer", "is_nullable": "NO", "is_primary_key": true, "foreign_key": null}], "columnCount": 5, "primaryKeyColumns": ["id"]}\n' +
    '```',
  provider: POSTGRES_PROVIDER,
  actionCategory: 'read',
  tags: [
    'postgres',
    'postgresql',
    'sql',
    'database',
    'table',
    'columns',
    'schema',
    'describe',
    'inspect',
    'db',
  ],

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
        description: 'Name of the table to describe.',
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
    ],
  },

  async execute(params, context) {
    const { credentialId, tableName, schemaName } = params;

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

    const sslOpt =
      config.ssl === true
        ? { rejectUnauthorized: false }
        : typeof config.ssl === 'object'
          ? (config.ssl as { rejectUnauthorized?: boolean })
          : undefined;

    const sql = pgLib(config.connectionString, { ssl: sslOpt, max: 1 });

    try {
      // Columns
      const columns = await sql`
        SELECT
          c.column_name,
          c.data_type,
          c.udt_name,
          c.is_nullable,
          c.column_default,
          c.character_maximum_length,
          c.numeric_precision,
          c.ordinal_position
        FROM information_schema.columns c
        WHERE c.table_schema = ${schemaName}
          AND c.table_name   = ${tableName}
        ORDER BY c.ordinal_position
      `;

      // Primary key columns
      const pkCols = await sql`
        SELECT kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema    = kcu.table_schema
        WHERE tc.table_schema    = ${schemaName}
          AND tc.table_name      = ${tableName}
          AND tc.constraint_type = 'PRIMARY KEY'
      `;

      // Foreign keys
      const fkCols = await sql`
        SELECT
          kcu.column_name,
          ccu.table_name  AS foreign_table_name,
          ccu.column_name AS foreign_column_name,
          tc.constraint_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema    = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = tc.constraint_name
         AND ccu.table_schema    = tc.table_schema
        WHERE tc.table_schema    = ${schemaName}
          AND tc.table_name      = ${tableName}
          AND tc.constraint_type = 'FOREIGN KEY'
      `;

      const pkSet = new Set(
        (pkCols as unknown as { column_name: string }[]).map((r) => r.column_name),
      );
      const fkMap = new Map(
        (
          fkCols as unknown as {
            column_name: string;
            foreign_table_name: string;
            foreign_column_name: string;
          }[]
        ).map((r) => [
          r.column_name,
          { foreignTable: r.foreign_table_name, foreignColumn: r.foreign_column_name },
        ]),
      );

      const enrichedColumns = (columns as Record<string, unknown>[]).map((col) => ({
        ...col,
        is_primary_key: pkSet.has(col.column_name as string),
        foreign_key: fkMap.get(col.column_name as string) ?? null,
      }));

      return {
        success: true,
        output: {
          tableName,
          schema: schemaName,
          columns: enrichedColumns,
          columnCount: enrichedColumns.length,
          primaryKeyColumns: Array.from(pkSet),
        },
        metadata: { tableName, schema: schemaName, columnCount: enrichedColumns.length },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Failed to describe table: ${msg}` };
    } finally {
      await sql.end().catch(() => {
        /* connection cleanup */
      });
    }
  },
});
