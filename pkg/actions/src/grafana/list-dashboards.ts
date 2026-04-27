/**
 * grafana.list_dashboards — Search and list Grafana dashboards
 *
 * Search dashboards by query string, folder, tag, or type.
 * Returns dashboard metadata including UID, title, URL, tags, and folder.
 * Requires a Grafana service account token or API key credential.
 */

import { defineAction } from '@flowlib/action-kit';
import { GRAFANA_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Grafana credential is required'),
  baseUrl: z.string().url('A valid Grafana instance URL is required'),
  query: z.string().optional().default(''),
  tag: z.string().optional().default(''),
  folderUid: z.string().optional().default(''),
  limit: z.number().int().min(1).max(5000).optional().default(100),
});

export const grafanaListDashboardsAction = defineAction({
  id: 'grafana.list_dashboards',
  name: 'List Dashboards',
  description:
    'Search and list Grafana dashboards (GET /api/search?type=dash-db). Use when the user wants to find dashboards by name, tag, or folder.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"dashboards": [{"uid": "abc123", "title": "Production Overview", "url": "/d/abc123", "tags": ["prod"], "folderTitle": "Infrastructure"}], "totalCount": 5}\n' +
    '```',
  provider: GRAFANA_PROVIDER,
  actionCategory: 'read',

  credential: {
    required: true,
    type: 'api_key',
    description: 'Grafana service account token or API key',
  },

  params: {
    schema: paramsSchema,
    fields: [
      {
        name: 'credentialId',
        label: 'Grafana Credential',
        type: 'text',
        required: true,
        description: 'Grafana service account token or API key for authentication',
        aiProvided: false,
      },
      {
        name: 'baseUrl',
        label: 'Grafana URL',
        type: 'text',
        required: true,
        placeholder: 'https://your-instance.grafana.net',
        description: 'Base URL of the Grafana instance (no trailing slash)',
        aiProvided: true,
      },
      {
        name: 'query',
        label: 'Search Query',
        type: 'text',
        placeholder: 'e.g. production metrics',
        description: 'Search dashboards by title or description.',
        aiProvided: true,
      },
      {
        name: 'tag',
        label: 'Tag Filter',
        type: 'text',
        placeholder: 'e.g. kubernetes',
        description: 'Filter dashboards by tag.',
        aiProvided: true,
      },
      {
        name: 'folderUid',
        label: 'Folder UID',
        type: 'text',
        placeholder: 'e.g. abc123',
        description: 'Filter dashboards within a specific folder UID.',
        aiProvided: true,
      },
      {
        name: 'limit',
        label: 'Limit',
        type: 'number',
        defaultValue: 100,
        description: 'Maximum number of dashboards to return (1–5000).',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['grafana', 'dashboard', 'list', 'search', 'monitoring', 'observability'],

  async execute(params, context) {
    const { credentialId, baseUrl, query, tag, folderUid, limit } = params;

    let credential = context.credential;
    if (!credential && context.functions?.getCredential) {
      credential = await context.functions.getCredential(credentialId);
    }
    if (!credential) {
      return {
        success: false,
        error: `Credential not found: ${credentialId}. Please create a Grafana credential.`,
      };
    }

    const token =
      (credential.config?.accessToken as string) ?? (credential.config?.token as string);
    if (!token) {
      return {
        success: false,
        error: 'No valid token in credential. Please provide a Grafana service account token.',
      };
    }

    context.logger.debug('Searching Grafana dashboards', { query, tag, folderUid, limit });

    const url = new URL(`${baseUrl}/api/search`);
    url.searchParams.set('type', 'dash-db');
    if (query) {
      url.searchParams.set('query', query);
    }
    if (tag) {
      url.searchParams.set('tag', tag);
    }
    if (folderUid) {
      url.searchParams.set('folderUIDs', folderUid);
    }
    url.searchParams.set('limit', String(limit));

    try {
      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Grafana API error: ${response.status} ${response.statusText} - ${errorText}`,
        };
      }

      const dashboards = (await response.json()) as Array<{
        id: number;
        uid: string;
        title: string;
        uri: string;
        url: string;
        slug: string;
        type: string;
        tags: string[];
        isStarred: boolean;
        folderUid?: string;
        folderTitle?: string;
        folderUrl?: string;
      }>;

      return {
        success: true,
        output: {
          dashboards: dashboards.map((d) => ({
            uid: d.uid,
            title: d.title,
            url: d.url,
            tags: d.tags,
            isStarred: d.isStarred,
            folderUid: d.folderUid ?? null,
            folderTitle: d.folderTitle ?? null,
          })),
          totalCount: dashboards.length,
        },
      };
    } catch (err) {
      return {
        success: false,
        error: `Failed to search Grafana dashboards: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});
