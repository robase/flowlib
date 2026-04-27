/**
 * onedrive.list_files — List files in OneDrive
 *
 * Lists files and folders in the root of OneDrive or inside a specific folder.
 * Requires a Microsoft OneDrive OAuth2 credential.
 */

import { defineAction } from '@flowlib/action-kit';
import { ONEDRIVE_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const GRAPH_API = 'https://graph.microsoft.com/v1.0';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'OneDrive credential is required'),
  folderId: z.string().optional().default(''),
});

export const onedriveListFilesAction = defineAction({
  id: 'onedrive.list_files',
  name: 'List Files',
  description:
    'List files and folders in OneDrive (GET /me/drive/root/children or /me/drive/items/{id}/children). Use when you need to browse or enumerate the contents of a folder.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"id": "01NKDM7HM...", "name": "Documents", "size": 0, "folder": {"childCount": 4}, "lastModifiedDateTime": "2025-01-15T10:30:00Z", "webUrl": "https://onedrive.live.com/..."}\n' +
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
        name: 'folderId',
        label: 'Folder ID',
        type: 'text',
        placeholder: 'folder-id-here',
        description: 'ID of the folder to list. Leave empty for root.',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['microsoft', 'onedrive', 'files', 'list', 'oauth2'],

  async execute(params, context) {
    const { credentialId, folderId } = params;

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

    context.logger.debug('Listing OneDrive files', { folderId });

    try {
      const endpoint = folderId?.trim()
        ? `${GRAPH_API}/me/drive/items/${encodeURIComponent(folderId)}/children`
        : `${GRAPH_API}/me/drive/root/children`;

      const response = await fetch(endpoint, {
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

      const data = (await response.json()) as { value: Record<string, unknown>[] };
      const items = (data.value ?? []).map((item: Record<string, unknown>) => ({
        id: item.id,
        name: item.name,
        size: item.size,
        lastModifiedDateTime: item.lastModifiedDateTime,
        webUrl: item.webUrl,
      }));

      return {
        success: true,
        output: { items, count: items.length },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `OneDrive operation failed: ${msg}` };
    }
  },
});
