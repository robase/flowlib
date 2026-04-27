/**
 * onedrive.delete_item — Delete a file or folder from OneDrive
 *
 * Deletes a file or folder by its item ID, moving it to the recycle bin.
 * Requires a Microsoft OneDrive OAuth2 credential.
 */

import { defineAction } from '@flowlib/action-kit';
import { ONEDRIVE_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const GRAPH_API = 'https://graph.microsoft.com/v1.0';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'OneDrive credential is required'),
  itemId: z.string().min(1, 'Item ID is required'),
});

export const onedriveDeleteItemAction = defineAction({
  id: 'onedrive.delete_item',
  name: 'Delete Item',
  description:
    'Delete a file or folder from OneDrive (DELETE /me/drive/items/{item-id}). Moves the item to the recycle bin. Use when you need to remove a file or folder. The Graph API returns 204 No Content on success.\n\n' +
    'Action output:\n' +
    '```json\n' +
    '{"itemId": "01NKDM7HM...", "deleted": true}\n' +
    '```',
  provider: ONEDRIVE_PROVIDER,
  actionCategory: 'delete',

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
        name: 'itemId',
        label: 'Item ID',
        type: 'text',
        required: true,
        description: 'The ID of the file or folder to delete',
        aiProvided: true,
      },
    ],
  },

  tags: ['microsoft', 'onedrive', 'file', 'folder', 'delete', 'oauth2'],

  async execute(params, context) {
    const { credentialId, itemId } = params;

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

    context.logger.debug('Deleting OneDrive item', { itemId });

    try {
      const response = await fetch(`${GRAPH_API}/me/drive/items/${encodeURIComponent(itemId)}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `OneDrive API error: ${response.status} - ${errorText}`,
        };
      }

      return {
        success: true,
        output: { itemId, deleted: true },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `OneDrive operation failed: ${msg}` };
    }
  },
});
