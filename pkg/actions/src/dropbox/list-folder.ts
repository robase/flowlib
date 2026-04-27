/**
 * dropbox.list_folder — List files and folders in a Dropbox path
 *
 * Lists the contents of a folder in the user's Dropbox.
 * An empty path ("") refers to the root folder.
 * Uses the Dropbox RPC endpoint POST /2/files/list_folder.
 * Requires a Dropbox OAuth2 credential with files.metadata.read scope.
 */

import { defineAction } from '@flowlib/action-kit';
import { DROPBOX_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const DROPBOX_API = 'https://api.dropboxapi.com';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Dropbox credential is required'),
  path: z.string().optional().default(''),
  limit: z.number().int().min(1).max(2000).optional().default(100),
  recursive: z.boolean().optional().default(false),
});

export const dropboxListFolderAction = defineAction({
  id: 'dropbox.list_folder',
  name: 'List Folder',
  description:
    'List files and folders in a Dropbox directory (POST /2/files/list_folder). Use when you need to browse or enumerate the contents of a folder. Call with `path` (empty string for root), optional `limit` (1–2000, default 100), and optional `recursive` flag.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"entries": [{".tag": "file", "name": "report.pdf", "path_display": "/Documents/report.pdf", "id": "id:a4ayc...", "size": 7212}], "has_more": false}\n' +
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
        name: 'path',
        label: 'Path',
        type: 'text',
        defaultValue: '',
        placeholder: '/Documents or leave empty for root',
        description: 'Folder path to list. Empty string ("") means root.',
        aiProvided: true,
      },
      {
        name: 'limit',
        label: 'Limit',
        type: 'number',
        defaultValue: 100,
        description: 'Maximum number of entries to return (1–2000)',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'recursive',
        label: 'Recursive',
        type: 'boolean',
        defaultValue: false,
        description: 'If true, list contents of all sub-folders recursively',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['dropbox', 'storage', 'files', 'folders', 'list', 'oauth2'],

  async execute(params, context) {
    const { credentialId, path, limit, recursive } = params;

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

    context.logger.debug('Listing Dropbox folder', { path, limit, recursive });

    try {
      const response = await fetch(`${DROPBOX_API}/2/files/list_folder`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          path: path || '',
          limit: Math.min(Math.max(1, limit), 2000),
          recursive,
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
        entries: Array<{
          '.tag': string;
          name: string;
          path_lower: string;
          path_display: string;
          id: string;
          size?: number;
          client_modified?: string;
          server_modified?: string;
        }>;
        cursor: string;
        has_more: boolean;
      };

      const entries = data.entries.map((entry) => ({
        tag: entry['.tag'],
        name: entry.name,
        pathLower: entry.path_lower,
        pathDisplay: entry.path_display,
        id: entry.id,
        size: entry.size,
        clientModified: entry.client_modified,
        serverModified: entry.server_modified,
      }));

      return {
        success: true,
        output: {
          entries,
          count: entries.length,
          hasMore: data.has_more,
          cursor: data.cursor,
        },
        metadata: {
          entryCount: entries.length,
          path: path || '/',
          hasMore: data.has_more,
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Dropbox list folder failed: ${msg}` };
    }
  },
});
