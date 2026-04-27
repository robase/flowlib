/**
 * google_drive.create_file — Create a file in Google Drive
 *
 * Creates a new file (text-based) with content in Google Drive.
 * Requires a Google Drive OAuth2 credential.
 */

import { defineAction } from '@flowlib/action-kit';
import { GOOGLE_DRIVE_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Google Drive credential is required'),
  name: z.string().min(1, 'File name is required'),
  content: z.string().optional().default(''),
  mimeType: z.string().optional().default('text/plain'),
  parentFolderId: z.string().optional().default(''),
  description: z.string().optional().default(''),
});

export const googleDriveCreateFileAction = defineAction({
  id: 'google_drive.create_file',
  name: 'Create File',
  description:
    'Create a new text-based file in Google Drive (files.create with multipart upload). Use when the user wants to upload or create a file with content. ' +
    'Call with `name` and `content`; optional `mimeType` (default text/plain), `parentFolderId`, and `description`.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"id": "1abc", "name": "report.txt", "mimeType": "text/plain", "size": "256", "webViewLink": "https://drive.google.com/file/d/1abc/view"}\n' +
    '```',
  provider: GOOGLE_DRIVE_PROVIDER,
  actionCategory: 'write',

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
        name: 'name',
        label: 'File Name',
        type: 'text',
        required: true,
        placeholder: 'report.txt',
        description: 'Name of the file to create',
        aiProvided: true,
      },
      {
        name: 'content',
        label: 'Content',
        type: 'textarea',
        placeholder: 'File content here...',
        description: 'Text content of the file',
        aiProvided: true,
      },
      {
        name: 'mimeType',
        label: 'MIME Type',
        type: 'text',
        defaultValue: 'text/plain',
        description: 'MIME type (e.g. text/plain, text/csv, application/json)',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'parentFolderId',
        label: 'Parent Folder ID',
        type: 'text',
        placeholder: 'folder-id-here',
        description: 'ID of the parent folder (root if empty)',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'description',
        label: 'Description',
        type: 'text',
        description: 'File description',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['google', 'drive', 'file', 'create', 'upload', 'oauth2'],

  async execute(params, context) {
    const { credentialId, name, content, mimeType, parentFolderId, description } = params;

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

    context.logger.debug('Creating file in Google Drive', { name, mimeType });

    try {
      const metadata: Record<string, unknown> = { name, mimeType };
      if (parentFolderId?.trim()) {
        metadata.parents = [parentFolderId];
      }
      if (description?.trim()) {
        metadata.description = description;
      }

      // Use multipart upload
      const boundary = 'invect_boundary_' + Date.now();
      const body =
        `--${boundary}\r\n` +
        `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
        `${JSON.stringify(metadata)}\r\n` +
        `--${boundary}\r\n` +
        `Content-Type: ${mimeType}\r\n\r\n` +
        `${content}\r\n` +
        `--${boundary}--`;

      const response = await fetch(
        `${DRIVE_UPLOAD_BASE}/files?uploadType=multipart&fields=id,name,mimeType,size,webViewLink`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': `multipart/related; boundary=${boundary}`,
          },
          body,
        },
      );

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
        metadata: { fileId: file.id },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Google Drive operation failed: ${msg}` };
    }
  },
});
