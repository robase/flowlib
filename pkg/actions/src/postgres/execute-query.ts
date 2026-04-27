/**
 * postgres.execute_query — Execute a raw SQL query
 *
 * Runs an arbitrary SQL statement against a PostgreSQL database and
 * returns the resulting rows. Supports JavaScript template expressions in the query.
 */

import { defineAction } from '@flowlib/action-kit';
import { POSTGRES_PROVIDER } from '../providers';
import { z } from 'zod/v4';
import pgLib from 'postgres';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Database credential is required'),
  query: z.string().min(1, 'SQL query is required'),
  timeout: z.number().int().positive().optional(),
});

export const postgresExecuteQueryAction = defineAction({
  id: 'postgres.execute_query',
  name: 'Execute Query',
  description:
    'Run an arbitrary SQL query (SELECT, INSERT, UPDATE, DELETE, etc.) against a PostgreSQL database and return the results. ' +
    'Use when you need to read or modify data in a PostgreSQL database with a custom SQL statement.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"data": [{"id": 1, "name": "Alice"}], "columns": ["id", "name"], "rowCount": 1}\n' +
    '```',
  provider: POSTGRES_PROVIDER,
  actionCategory: 'read',
  tags: [
    'postgres',
    'postgresql',
    'sql',
    'database',
    'query',
    'select',
    'insert',
    'update',
    'delete',
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
        name: 'query',
        label: 'SQL Query',
        type: 'code',
        required: true,
        description:
          'SQL statement to execute. Supports JavaScript template expressions (e.g. {{ variable }}) for dynamic values.',
        defaultValue: 'SELECT * FROM users LIMIT 10',
        aiProvided: true,
      },
      {
        name: 'timeout',
        label: 'Timeout (seconds)',
        type: 'number',
        description: 'Query timeout in seconds. Defaults to 30.',
        defaultValue: 30,
        extended: true,
        aiProvided: true,
      },
    ],
  },

  async execute(params, context) {
    const { query, credentialId, timeout } = params;

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

    context.logger.debug('postgres.execute_query', {
      query: query.substring(0, 120) + (query.length > 120 ? '…' : ''),
    });

    const sslOpt =
      config.ssl === true
        ? { rejectUnauthorized: false }
        : typeof config.ssl === 'object'
          ? (config.ssl as { rejectUnauthorized?: boolean })
          : undefined;

    const sql = pgLib(config.connectionString, {
      ssl: sslOpt,
      max: 1,
      idle_timeout: timeout ?? 30,
    });

    try {
      const result = await sql.unsafe(query);
      const data = Array.isArray(result) ? result : [];
      const columns = data.length > 0 ? Object.keys(data[0]) : [];

      return {
        success: true,
        output: { data, columns, rowCount: data.length },
        metadata: { rowCount: data.length, columns },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `SQL query failed: ${msg}` };
    } finally {
      await sql.end().catch(() => {
        /* connection cleanup */
      });
    }
  },
});
