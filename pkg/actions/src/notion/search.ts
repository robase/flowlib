/**
 * notion.search — Search pages and databases in Notion
 *
 * Searches all pages and databases shared with the integration by title.
 * Supports filtering by object type (page or database) and sorting.
 * Requires a Notion OAuth2 credential.
 */

import { defineAction } from '@flowlib/action-kit';
import { NOTION_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const NOTION_API_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Notion credential is required'),
  query: z.string().optional().default(''),
  filterType: z.enum(['', 'page', 'database']).optional().default(''),
  sortDirection: z.enum(['ascending', 'descending']).optional().default('descending'),
  pageSize: z.number().int().min(1).max(100).optional().default(10),
  startCursor: z.string().optional().default(''),
});

export const notionSearchAction = defineAction({
  id: 'notion.search',
  name: 'Search',
  description:
    'Search pages and databases in Notion by title (POST /v1/search). Use when the user wants to find a specific page or database in their workspace. ' +
    'Call with an optional `query` string to match titles; use `filterType` to restrict to "page" or "database"; results are sorted by `last_edited_time` (descending by default). ' +
    'Supports pagination via `startCursor` and `pageSize` (1–100).\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"results": [{"id": "page-uuid", "object": "page", "url": "https://notion.so/...", "created_time": "2025-01-15T10:00:00Z", "last_edited_time": "2025-04-01T12:00:00Z"}], "has_more": false, "next_cursor": null}\n' +
    '```',
  provider: NOTION_PROVIDER,
  actionCategory: 'read',
  tags: ['notion', 'search', 'find', 'pages', 'databases', 'workspace', 'oauth2'],

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
        name: 'query',
        label: 'Search Query',
        type: 'text',
        placeholder: 'Meeting notes',
        description: 'Text to search for in page and database titles. Leave empty to list all.',
        aiProvided: true,
      },
      {
        name: 'filterType',
        label: 'Filter Type',
        type: 'select',
        defaultValue: '',
        options: [
          { label: 'All', value: '' },
          { label: 'Pages only', value: 'page' },
          { label: 'Databases only', value: 'database' },
        ],
        description: 'Restrict results to pages or databases.',
        aiProvided: true,
      },
      {
        name: 'sortDirection',
        label: 'Sort Direction',
        type: 'select',
        defaultValue: 'descending',
        options: [
          { label: 'Newest first', value: 'descending' },
          { label: 'Oldest first', value: 'ascending' },
        ],
        description: 'Sort by last edited time.',
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
    const { credentialId, query, filterType, sortDirection, pageSize, startCursor } = params;

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

    context.logger.debug('Searching Notion', { query, filterType });

    try {
      const body: Record<string, unknown> = {
        page_size: pageSize,
        sort: {
          direction: sortDirection,
          timestamp: 'last_edited_time',
        },
      };
      if (query?.trim()) {
        body.query = query;
      }
      if (filterType) {
        body.filter = { property: 'object', value: filterType };
      }
      if (startCursor) {
        body.start_cursor = startCursor;
      }

      const response = await fetch(`${NOTION_API_BASE}/search`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Notion-Version': NOTION_VERSION,
        },
        body: JSON.stringify(body),
      });

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
          properties?: Record<string, unknown>;
          parent?: Record<string, unknown>;
          icon?: { type: string; emoji?: string } | null;
        }>;
        has_more: boolean;
        next_cursor: string | null;
      };

      return {
        success: true,
        output: {
          results: data.results.map((r) => ({
            id: r.id,
            object: r.object,
            url: r.url,
            created_time: r.created_time,
            last_edited_time: r.last_edited_time,
            icon: r.icon?.emoji ?? null,
          })),
          has_more: data.has_more,
          next_cursor: data.next_cursor,
          totalCount: data.results.length,
        },
        metadata: { query, filterType, resultCount: data.results.length },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Notion search failed: ${msg}` };
    }
  },
});
