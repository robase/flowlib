/**
 * google_drive.get_file — Get file metadata from Google Drive
 *
 * Retrieves metadata (and optionally content for text files) of a specific file.
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

export const googleDriveGetFileAction = defineAction({
  id: 'google_drive.get_file',
  name: 'Get File',
  description:
    'Retrieve metadata of a file in Google Drive by its ID (files.get). Use when the user wants to get details about a specific file such as name, size, MIME type, and view link. ' +
    'Call with `fileId` to retrieve file metadata.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"id": "1abc", "name": "Report.pdf", "mimeType": "application/pdf", "size": "12345", "webViewLink": "https://drive.google.com/file/d/1abc/view"}\n' +
    '```',
  provider: GOOGLE_DRIVE_PROVIDER,
  actionCategory: 'read',

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
        description: 'The ID of the file to retrieve',
        aiProvided: true,
      },
    ],
  },

  tags: ['google', 'drive', 'file', 'get', 'metadata', 'oauth2'],

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

    context.logger.debug('Getting Google Drive file', { fileId });

    try {
      const url = new URL(`${DRIVE_API_BASE}/files/${fileId}`);
      url.searchParams.set(
        'fields',
        'id,name,mimeType,size,createdTime,modifiedTime,webViewLink,webContentLink,parents,description,starred,trashed,owners',
      );

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Google Drive API error: ${response.status} - ${errorText}`,
        };
      }

      const file = (await response.json()) as Record<string, unknown>;

      return {
        success: true,
        output: file,
        metadata: { fileId, mimeType: file.mimeType },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Google Drive operation failed: ${msg}` };
    }
  },
});
