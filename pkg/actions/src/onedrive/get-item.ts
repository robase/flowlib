/**
 * onedrive.get_item — Get item metadata from OneDrive
 *
 * Retrieves metadata for a specific file or folder by its item ID.
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

export const onedriveGetItemAction = defineAction({
  id: 'onedrive.get_item',
  name: 'Get Item',
  description:
    'Get metadata for a file or folder in OneDrive by its item ID (GET /me/drive/items/{item-id}). Use when you need file size, modification date, download URL, or other properties. The response includes `@microsoft.graph.downloadUrl` for files.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"id": "01NKDM7HM...", "name": "report.docx", "size": 157286400, "createdDateTime": "2025-01-10T08:00:00Z", "webUrl": "https://onedrive.live.com/...", "@microsoft.graph.downloadUrl": "https://...", "file": {"mimeType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}}\n' +
    '```',
  provider: ONEDRIVE_PROVIDER,
  actionCategory: 'read',

  credential: {
    required: true,
    type: 'oauth2',
    oauth2Provider: 'microsoft',
    requiredScopes: ['Files.Read'],
    description: 'Microsoft OAuth2 credential with Files.Read scope',
  },

  params: {
    schema: paramsSchema,
    fields: [
      {
        name: 'credentialId',
        label: 'Microsoft Credential',
        type: 'text',
        required: true,
        description: 'Microsoft OAuth2 credential for authentication (requires Files.Read scope)',
        aiProvided: false,
      },
      {
        name: 'itemId',
        label: 'Item ID',
        type: 'text',
        required: true,
        description: 'The ID of the file or folder to retrieve',
        aiProvided: true,
      },
    ],
  },

  tags: ['microsoft', 'onedrive', 'file', 'get', 'metadata', 'oauth2'],

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

    context.logger.debug('Getting OneDrive item', { itemId });

    try {
      const response = await fetch(`${GRAPH_API}/me/drive/items/${encodeURIComponent(itemId)}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `OneDrive API error: ${response.status} - ${errorText}`,
        };
      }

      const item = await response.json();

      return {
        success: true,
        output: item,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `OneDrive operation failed: ${msg}` };
    }
  },
});
