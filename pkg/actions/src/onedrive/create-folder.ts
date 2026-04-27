/**
 * onedrive.create_folder — Create a folder in OneDrive
 *
 * Creates a new folder in OneDrive under the root or a specified parent folder.
 * Requires a Microsoft OneDrive OAuth2 credential.
 */

import { defineAction } from '@flowlib/action-kit';
import { ONEDRIVE_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const GRAPH_API = 'https://graph.microsoft.com/v1.0';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'OneDrive credential is required'),
  name: z.string().min(1, 'Folder name is required'),
  parentId: z.string().optional().default(''),
});

export const onedriveCreateFolderAction = defineAction({
  id: 'onedrive.create_folder',
  name: 'Create Folder',
  description:
    'Create a new folder in OneDrive (POST /me/drive/items/{parent-id}/children). Use when you need to organize files by creating a new directory. Renames automatically on conflict.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"id": "ACEA49D1-...", "name": "New Folder", "folder": {"childCount": 0}, "size": 0, "createdDateTime": "2025-01-15T14:34:00Z", "webUrl": "https://onedrive.live.com/..."}\n' +
    '```',
  provider: ONEDRIVE_PROVIDER,
  actionCategory: 'write',

  credential: {
    required: true,
    type: 'oauth2',
    oauth2Provider: 'microsoft',
    requiredScopes: ['Files.ReadWrite'],
    description: 'Microsoft OAuth2 credential with Files.ReadWrite scope',
  },

  params: {
    schema: paramsSchema,
    fields: [
      {
        name: 'credentialId',
        label: 'Microsoft Credential',
        type: 'text',
        required: true,
        description:
          'Microsoft OAuth2 credential for authentication (requires Files.ReadWrite scope)',
        aiProvided: false,
      },
      {
        name: 'name',
        label: 'Folder Name',
        type: 'text',
        required: true,
        placeholder: 'My Folder',
        description: 'Name of the folder to create',
        aiProvided: true,
      },
      {
        name: 'parentId',
        label: 'Parent Folder ID',
        type: 'text',
        placeholder: 'parent-folder-id',
        description: 'ID of the parent folder. Leave empty for root.',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['microsoft', 'onedrive', 'folder', 'create', 'oauth2'],

  async execute(params, context) {
    const { credentialId, name, parentId } = params;

    let credential = context.credential;
    if (!credential && context.functions?.getCredential) {
      credential = await context.functions.getCredential(credentialId);
    }
    if (!credential) {
      return { success: false, error: `Credential not found: ${credentialId}` };
    }

    const accessToken =
      (credential.config?.accessToken as string) ?? (credential.config?.token as string);
    if (!accessToken) {
      return { success: false, error: 'No valid access token. Please re-authorize.' };
    }

    context.logger.debug('Creating OneDrive folder', { name, parentId });

    try {
      const endpoint = parentId?.trim()
        ? `${GRAPH_API}/me/drive/items/${encodeURIComponent(parentId)}/children`
        : `${GRAPH_API}/me/drive/root/children`;

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name,
          folder: {},
          '@microsoft.graph.conflictBehavior': 'rename',
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `OneDrive API error: ${response.status} - ${errorText}`,
        };
      }

      const folder = await response.json();

      return {
        success: true,
        output: folder,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `OneDrive operation failed: ${msg}` };
    }
  },
});
