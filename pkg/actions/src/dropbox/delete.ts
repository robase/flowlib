/**
 * dropbox.delete — Delete a file or folder in Dropbox
 *
 * Permanently deletes a file or folder at the specified path.
 * Uses the Dropbox RPC endpoint POST /2/files/delete_v2.
 * Requires a Dropbox OAuth2 credential with files.content.write scope.
 */

import { defineAction } from '@flowlib/action-kit';
import { DROPBOX_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const DROPBOX_API = 'https://api.dropboxapi.com';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Dropbox credential is required'),
  path: z.string().min(1, 'Path is required'),
});

export const dropboxDeleteAction = defineAction({
  id: 'dropbox.delete',
  name: 'Delete',
  description:
    "Delete a file or folder in Dropbox (POST /2/files/delete_v2). Use when you need to permanently remove a file or folder from the user's Dropbox. Call with `path` (full Dropbox path to the file or folder to delete).\n\n" +
    'Example response:\n' +
    '```json\n' +
    '{"metadata": {".tag": "file", "name": "old-file.pdf", "path_display": "/Documents/old-file.pdf", "id": "id:a4ayc_80_OEA..."}}\n' +
    '```',
  provider: DROPBOX_PROVIDER,
  actionCategory: 'write',

  credential: {
    required: true,
    type: 'oauth2',
    oauth2Provider: 'dropbox',
    requiredScopes: ['files.content.write'],
    description: 'Dropbox OAuth2 credential with files.content.write scope',
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
        placeholder: '/Documents/old-file.pdf',
        description: 'Full path to the file or folder to delete',
        aiProvided: true,
      },
    ],
  },

  tags: ['dropbox', 'storage', 'files', 'delete', 'oauth2'],

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

    context.logger.debug('Deleting Dropbox item', { path });

    try {
      const response = await fetch(`${DROPBOX_API}/2/files/delete_v2`, {
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
        metadata: {
          '.tag': string;
          name: string;
          path_lower: string;
          path_display: string;
          id: string;
        };
      };

      return {
        success: true,
        output: {
          tag: data.metadata['.tag'],
          name: data.metadata.name,
          pathLower: data.metadata.path_lower,
          pathDisplay: data.metadata.path_display,
          id: data.metadata.id,
        },
        metadata: {
          deletedPath: data.metadata.path_display,
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Dropbox delete failed: ${msg}` };
    }
  },
});
