/**
 * dropbox.search — Search for files and folders in Dropbox
 *
 * Searches for files and folders by name using the Dropbox search API.
 * Uses the Dropbox RPC endpoint POST /2/files/search_v2.
 * Requires a Dropbox OAuth2 credential with files.metadata.read scope.
 */

import { defineAction } from '@flowlib/action-kit';
import { DROPBOX_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const DROPBOX_API = 'https://api.dropboxapi.com';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Dropbox credential is required'),
  query: z.string().min(1, 'Search query is required'),
  maxResults: z.number().int().min(1).max(1000).optional().default(25),
});

export const dropboxSearchAction = defineAction({
  id: 'dropbox.search',
  name: 'Search',
  description:
    'Search for files and folders in Dropbox by name or content (POST /2/files/search_v2). Use when you need to find files matching a keyword across the entire Dropbox account. Call with `query` (search string) and optional `maxResults` (1–1000, default 25).\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"matches": [{"metadata": {"metadata": {".tag": "file", "name": "report.pdf", "path_display": "/Documents/report.pdf", "id": "id:a4ayc..."}}}], "has_more": false}\n' +
    '```',
  provider: DROPBOX_PROVIDER,
  actionCategory: 'read',

  credential: {
    required: true,
    type: 'oauth2',
    oauth2Provider: 'dropbox',
    requiredScopes: ['files.metadata.read'],
    description: 'Dropbox OAuth2 credential with files.metadata.read scope',
  },

  params: {
    schema: paramsSchema,
    fields: [
      {
        name: 'credentialId',
        label: 'Dropbox Credential',
        type: 'text',
        required: true,
        description: 'Dropbox OAuth2 credential for authentication',
        aiProvided: false,
      },
      {
        name: 'query',
        label: 'Search Query',
        type: 'text',
        required: true,
        placeholder: 'quarterly report',
        description: 'The search query string',
        aiProvided: true,
      },
      {
        name: 'maxResults',
        label: 'Max Results',
        type: 'number',
        defaultValue: 25,
        description: 'Maximum number of results to return (1–1000)',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['dropbox', 'storage', 'files', 'search', 'oauth2'],

  async execute(params, context) {
    const { credentialId, query, maxResults } = params;

    // Resolve credential
    let credential = context.credential;
    if (!credential && context.functions?.getCredential) {
      credential = await context.functions.getCredential(credentialId);
    }
    if (!credential) {
      return {
        success: false,
        error: `Credential not found: ${credentialId}. Please create a Dropbox OAuth2 credential.`,
      };
    }

    const accessToken =
      (credential.config?.accessToken as string) ?? (credential.config?.token as string);
    if (!accessToken) {
      return {
        success: false,
        error: 'No valid access token in credential. Please re-authorize the Dropbox credential.',
      };
    }

    context.logger.debug('Searching Dropbox', { query, maxResults });

    try {
      const response = await fetch(`${DROPBOX_API}/2/files/search_v2`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          options: { max_results: Math.min(Math.max(1, maxResults), 1000) },
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        return {
          success: false,
          error: `Dropbox API error (${response.status}): ${errorBody}`,
        };
      }

      const data = (await response.json()) as {
        matches: Array<{
          metadata: {
            metadata: {
              '.tag': string;
              name: string;
              path_lower: string;
              path_display: string;
              id: string;
              size?: number;
              client_modified?: string;
              server_modified?: string;
            };
          };
        }>;
        has_more: boolean;
      };

      const matches = data.matches.map((m) => {
        const entry = m.metadata.metadata;
        return {
          tag: entry['.tag'],
          name: entry.name,
          pathLower: entry.path_lower,
          pathDisplay: entry.path_display,
          id: entry.id,
          size: entry.size,
          clientModified: entry.client_modified,
          serverModified: entry.server_modified,
        };
      });

      return {
        success: true,
        output: {
          matches,
          count: matches.length,
          hasMore: data.has_more,
        },
        metadata: {
          query,
          matchCount: matches.length,
          hasMore: data.has_more,
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Dropbox search failed: ${msg}` };
    }
  },
});
