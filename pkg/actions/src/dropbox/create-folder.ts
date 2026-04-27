/**
 * dropbox.create_folder — Create a folder in Dropbox
 *
 * Creates a new folder at the specified path.
 * Uses the Dropbox RPC endpoint POST /2/files/create_folder_v2.
 * Requires a Dropbox OAuth2 credential with files.content.write scope.
 */

import { defineAction } from '@flowlib/action-kit';
import { DROPBOX_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const DROPBOX_API = 'https://api.dropboxapi.com';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Dropbox credential is required'),
  path: z.string().min(1, 'Path is required'),
  autorename: z.boolean().optional().default(false),
});

export const dropboxCreateFolderAction = defineAction({
  id: 'dropbox.create_folder',
  name: 'Create Folder',
  description:
    "Create a new folder in Dropbox (POST /2/files/create_folder_v2). Use when you need to organize files by creating a new directory in the user's Dropbox. Call with `path` (full path for the new folder); optional `autorename` avoids conflicts.\n\n" +
    'Example response:\n' +
    '```json\n' +
    '{"metadata": {"name": "New Folder", "path_display": "/Documents/New Folder", "id": "id:a4ayc_80_OEA..."}}\n' +
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
        placeholder: '/Documents/New Folder',
        description: 'Full path for the new folder',
        aiProvided: true,
      },
      {
        name: 'autorename',
        label: 'Auto-rename',
        type: 'boolean',
        defaultValue: false,
        description: 'If true, Dropbox will rename the folder if a conflict exists',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['dropbox', 'storage', 'folders', 'create', 'oauth2'],

  async execute(params, context) {
    const { credentialId, path, autorename } = params;

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

    context.logger.debug('Creating Dropbox folder', { path, autorename });

    try {
      const response = await fetch(`${DROPBOX_API}/2/files/create_folder_v2`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ path, autorename }),
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
          name: string;
          path_lower: string;
          path_display: string;
          id: string;
        };
      };

      return {
        success: true,
        output: {
          name: data.metadata.name,
          pathLower: data.metadata.path_lower,
          pathDisplay: data.metadata.path_display,
          id: data.metadata.id,
        },
        metadata: {
          path: data.metadata.path_display,
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Dropbox create folder failed: ${msg}` };
    }
  },
});
