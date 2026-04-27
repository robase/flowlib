/**
 * notion.query_database — Query a Notion database
 *
 * Queries a database and returns matching pages, with optional filtering
 * and sorting. Supports Notion's structured filter syntax.
 * Requires a Notion OAuth2 credential with read content capabilities.
 */

import { defineAction } from '@flowlib/action-kit';
import { NOTION_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const NOTION_API_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Notion credential is required'),
  databaseId: z.string().min(1, 'Database ID is required'),
  filter: z.string().optional().default(''),
  sorts: z.string().optional().default(''),
  pageSize: z.number().int().min(1).max(100).optional().default(10),
  startCursor: z.string().optional().default(''),
});

export const notionQueryDatabaseAction = defineAction({
  id: 'notion.query_database',
  name: 'Query Database',
  description:
    'Query a Notion database with optional filters and sorts (POST /v1/databases/{database_id}/query). Use when the user wants to list, filter, or search entries in a Notion database. ' +
    'Call with `databaseId` (UUID). Optionally pass `filter` as a JSON object (e.g., {"property": "Status", "select": {"equals": "Done"}}) and `sorts` as a JSON array. ' +
    'Supports compound "and"/"or" filters. Paginate with `startCursor` and `pageSize` (1–100).\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"results": [{"id": "page-uuid", "properties": {"Name": {"title": [{"plain_text": "Task 1"}]}, "Status": {"select": {"name": "Done"}}}}], "has_more": false, "next_cursor": null}\n' +
    '```',
  provider: NOTION_PROVIDER,
  actionCategory: 'read',
  tags: ['notion', 'database', 'query', 'filter', 'sort', 'list', 'search', 'read', 'oauth2'],

  credential: {
    required: true,
    type: 'oauth2',
    oauth2Provider: 'notion',
    description: 'Notion OAuth2 credential',
  },

  params: {
    schema: paramsSchema,
    fields: [
      {
        name: 'credentialId',
        label: 'Notion Credential',
        type: 'text',
        required: true,
        description: 'Notion OAuth2 credential for authentication',
        aiProvided: false,
      },
      {
        name: 'databaseId',
        label: 'Database ID',
        type: 'text',
        required: true,
        placeholder: 'd9824bdc-8445-4327-be8b-5b47500af6ce',
        description: 'UUID of the Notion database to query.',
        aiProvided: true,
      },
      {
        name: 'filter',
        label: 'Filter (JSON)',
        type: 'json',
        placeholder: '{"property": "Status", "select": {"equals": "Done"}}',
        description:
          'Notion filter object as JSON. Supports compound "and"/"or" filters. See Notion docs for filter syntax.',
        aiProvided: true,
      },
      {
        name: 'sorts',
        label: 'Sorts (JSON)',
        type: 'json',
        placeholder: '[{"property": "Created", "direction": "descending"}]',
        description:
          'Array of sort objects. Each has "property" + "direction" ("ascending"/"descending"), or "timestamp" + "direction".',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'pageSize',
        label: 'Page Size',
        type: 'number',
        defaultValue: 10,
        description: 'Number of results to return (1–100).',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'startCursor',
        label: 'Start Cursor',
        type: 'text',
        placeholder: '',
        description: 'Pagination cursor from a previous response.',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  async execute(params, context) {
    const { credentialId, databaseId, filter, sorts, pageSize, startCursor } = params;

    let credential = context.credential;
    if (!credential && context.functions?.getCredential) {
      credential = await context.functions.getCredential(credentialId);
    }
    if (!credential) {
      return {
        success: false,
        error: `Credential not found: ${credentialId}. Please create a Notion OAuth2 credential.`,
      };
    }

    const accessToken =
      (credential.config?.accessToken as string) ?? (credential.config?.token as string);
    if (!accessToken) {
      return {
        success: false,
        error: 'No valid access token in credential. Please re-authorize the Notion credential.',
      };
    }

    context.logger.debug('Querying Notion database', { databaseId });

    try {
      const body: Record<string, unknown> = {
        page_size: pageSize,
      };

      if (filter?.trim()) {
        try {
          body.filter = JSON.parse(filter);
        } catch {
          return { success: false, error: 'Invalid JSON in filter field.' };
        }
      }

      if (sorts?.trim()) {
        try {
          body.sorts = JSON.parse(sorts);
        } catch {
          return { success: false, error: 'Invalid JSON in sorts field.' };
        }
      }

      if (startCursor) {
        body.start_cursor = startCursor;
      }

      const response = await fetch(
        `${NOTION_API_BASE}/databases/${encodeURIComponent(databaseId)}/query`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'Notion-Version': NOTION_VERSION,
          },
          body: JSON.stringify(body),
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Notion API error (${response.status}): ${errorText}`,
        };
      }

      const data = (await response.json()) as {
        results: Array<{
          id: string;
          object: string;
          url: string;
          created_time: string;
          last_edited_time: string;
          properties: Record<string, unknown>;
          parent: Record<string, unknown>;
          icon: { type: string; emoji?: string } | null;
        }>;
        has_more: boolean;
        next_cursor: string | null;
      };

      return {
        success: true,
        output: {
          results: data.results.map((r) => ({
            id: r.id,
            url: r.url,
            created_time: r.created_time,
            last_edited_time: r.last_edited_time,
            properties: r.properties,
            icon: r.icon?.emoji ?? null,
          })),
          has_more: data.has_more,
          next_cursor: data.next_cursor,
          totalCount: data.results.length,
        },
        metadata: { databaseId, resultCount: data.results.length },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Notion query database failed: ${msg}` };
    }
  },
});
