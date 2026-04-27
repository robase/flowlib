/**
 * dropbox.get_metadata — Get metadata for a file or folder in Dropbox
 *
 * Retrieves metadata (name, size, modified dates, etc.) for a given path.
 * Uses the Dropbox RPC endpoint POST /2/files/get_metadata.
 * Requires a Dropbox OAuth2 credential with files.metadata.read scope.
 */

import { defineAction } from '@flowlib/action-kit';
import { DROPBOX_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const DROPBOX_API = 'https://api.dropboxapi.com';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Dropbox credential is required'),
  path: z.string().min(1, 'Path is required'),
});

export const dropboxGetMetadataAction = defineAction({
  id: 'dropbox.get_metadata',
  name: 'Get Metadata',
  description:
    'Get metadata for a file or folder in Dropbox (POST /2/files/get_metadata). Use when you need file size, modification dates, or to check if a path exists. Call with `path` (full Dropbox path or file ID).\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{".tag": "file", "name": "report.pdf", "path_display": "/Documents/report.pdf", "id": "id:a4ayc...", "size": 7212, "server_modified": "2025-05-12T15:50:38Z"}\n' +
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
        required: true,
        placeholder: '/Documents/report.pdf',
        description: 'Full path to the file or folder',
        aiProvided: true,
      },
    ],
  },

  tags: ['dropbox', 'storage', 'files', 'metadata', 'oauth2'],

  async execute(params, context) {
    const { credentialId, path } = params;

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

    context.logger.debug('Getting Dropbox metadata', { path });

    try {
      const response = await fetch(`${DROPBOX_API}/2/files/get_metadata`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ path }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        return {
          success: false,
          error: `Dropbox API error (${response.status}): ${errorBody}`,
        };
      }

      const data = (await response.json()) as {
        '.tag': string;
        name: string;
        path_lower: string;
        path_display: string;
        id: string;
        size?: number;
        client_modified?: string;
        server_modified?: string;
        is_downloadable?: boolean;
        content_hash?: string;
      };

      return {
        success: true,
        output: {
          tag: data['.tag'],
          name: data.name,
          pathLower: data.path_lower,
          pathDisplay: data.path_display,
          id: data.id,
          size: data.size,
          clientModified: data.client_modified,
          serverModified: data.server_modified,
          isDownloadable: data.is_downloadable,
          contentHash: data.content_hash,
        },
        metadata: {
          tag: data['.tag'],
          path: data.path_display,
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Dropbox get metadata failed: ${msg}` };
    }
  },
});
