/**
 * postgres.list_tables — List tables in a PostgreSQL database
 *
 * Queries the information_schema to enumerate user tables, their row
 * counts (estimated), and column counts.
 */

import { defineAction } from '@flowlib/action-kit';
import { POSTGRES_PROVIDER } from '../providers';
import { z } from 'zod/v4';
import pgLib from 'postgres';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Database credential is required'),
  schemaName: z.string().optional().default('public'),
  includeViews: z.boolean().optional().default(false),
});

export const postgresListTablesAction = defineAction({
  id: 'postgres.list_tables',
  name: 'List Tables',
  description:
    'List all tables (and optionally views) in a PostgreSQL schema with estimated row counts and column counts. ' +
    'Use when you need to discover what tables exist in a database before querying or describing them.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"tables": [{"table_name": "users", "table_type": "BASE TABLE", "column_count": 5, "estimated_row_count": 1200}], "schema": "public", "tableCount": 1}\n' +
    '```',
  provider: POSTGRES_PROVIDER,
  actionCategory: 'read',
  tags: ['postgres', 'postgresql', 'sql', 'database', 'tables', 'schema', 'list', 'db'],

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
        name: 'schemaName',
        label: 'Schema',
        type: 'text',
        defaultValue: 'public',
        description: 'PostgreSQL schema to list tables from.',
        aiProvided: true,
      },
      {
        name: 'includeViews',
        label: 'Include Views',
        type: 'boolean',
        defaultValue: false,
        description: 'Also include views in the results.',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  async execute(params, context) {
    const { credentialId, schemaName, includeViews } = params;

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
      const tableTypes = includeViews ? ['BASE TABLE', 'VIEW'] : ['BASE TABLE'];

      const result = await sql`
        SELECT
          t.table_name,
          t.table_type,
          COALESCE(c.column_count, 0)    AS column_count,
          COALESCE(s.n_live_tup, 0)      AS estimated_row_count
        FROM information_schema.tables t
        LEFT JOIN (
          SELECT table_name, COUNT(*)::int AS column_count
          FROM information_schema.columns
          WHERE table_schema = ${schemaName}
          GROUP BY table_name
        ) c ON c.table_name = t.table_name
        LEFT JOIN pg_stat_user_tables s
          ON s.relname = t.table_name AND s.schemaname = ${schemaName}
        WHERE t.table_schema = ${schemaName}
          AND t.table_type = ANY(${tableTypes})
        ORDER BY t.table_name
      `;

      const tables = Array.isArray(result) ? result : [];

      return {
        success: true,
        output: {
          tables,
          schema: schemaName,
          tableCount: tables.length,
        },
        metadata: { schema: schemaName, tableCount: tables.length },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Failed to list tables: ${msg}` };
    } finally {
      await sql.end().catch(() => {
        /* connection cleanup */
      });
    }
  },
});
