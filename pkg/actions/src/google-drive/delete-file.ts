/**
 * google_drive.delete_file — Delete a file from Google Drive
 *
 * Permanently deletes a file by its ID.
 * Requires a Google Drive OAuth2 credential.
 */

import { defineAction } from '@flowlib/action-kit';
import { GOOGLE_DRIVE_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Google Drive credential is required'),
  fileId: z.string().min(1, 'File ID is required'),
});

export const googleDriveDeleteFileAction = defineAction({
  id: 'google_drive.delete_file',
  name: 'Delete File',
  description:
    'Permanently delete a file from Google Drive (files.delete). Use when the user wants to remove a file — this cannot be undone. ' +
    'Call with `fileId` of the file to delete. The API returns 204 No Content; this action returns a confirmation object.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"fileId": "1abc", "deleted": true}\n' +
    '```',
  provider: GOOGLE_DRIVE_PROVIDER,
  actionCategory: 'delete',

  credential: {
    required: true,
    type: 'oauth2',
    oauth2Provider: 'google',
    requiredScopes: [
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/drive.file',
      'https://www.googleapis.com/auth/drive.metadata',
    ],
    description: 'Google Drive OAuth2 credential',
  },

  params: {
    schema: paramsSchema,
    fields: [
      {
        name: 'credentialId',
        label: 'Google Drive Credential',
        type: 'text',
        required: true,
        description: 'Google Drive OAuth2 credential for authentication',
        aiProvided: false,
      },
      {
        name: 'fileId',
        label: 'File ID',
        type: 'text',
        required: true,
        description: 'The ID of the file to delete',
        aiProvided: true,
      },
    ],
  },

  tags: ['google', 'drive', 'file', 'delete', 'oauth2'],

  async execute(params, context) {
    const { credentialId, fileId } = params;

    let credential = context.credential;
    if (!credential && context.functions?.getCredential) {
      credential = await context.functions.getCredential(credentialId);
    }
    if (!credential) {
      return { success: false, error: `Credential not found: ${credentialId}` };
    }

    const accessToken = credential.config?.accessToken as string;
    if (!accessToken) {
      return { success: false, error: 'No valid access token. Please re-authorize.' };
    }

    context.logger.debug('Deleting Google Drive file', { fileId });

    try {
      const response = await fetch(`${DRIVE_API_BASE}/files/${fileId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Google Drive API error: ${response.status} - ${errorText}`,
        };
      }

      return {
        success: true,
        output: { fileId, deleted: true },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Google Drive operation failed: ${msg}` };
    }
  },
});
