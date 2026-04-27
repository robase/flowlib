/**
 * google_drive.create_folder — Create a folder in Google Drive
 *
 * Creates a new folder in Google Drive with optional parent folder.
 * Requires a Google Drive OAuth2 credential.
 */

import { defineAction } from '@flowlib/action-kit';
import { GOOGLE_DRIVE_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Google Drive credential is required'),
  name: z.string().min(1, 'Folder name is required'),
  parentFolderId: z.string().optional().default(''),
  description: z.string().optional().default(''),
});

export const googleDriveCreateFolderAction = defineAction({
  id: 'google_drive.create_folder',
  name: 'Create Folder',
  description:
    'Create a new folder in Google Drive (files.create with folder mimeType). Use when the user wants to organize files into a new folder. ' +
    'Call with `name`; optional `parentFolderId` to nest under an existing folder, and `description`.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"id": "1abc", "name": "My Folder", "mimeType": "application/vnd.google-apps.folder", "webViewLink": "https://drive.google.com/drive/folders/1abc"}\n' +
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
        label: 'Folder Name',
        type: 'text',
        required: true,
        placeholder: 'My Folder',
        description: 'Name of the folder to create',
        aiProvided: true,
      },
      {
        name: 'parentFolderId',
        label: 'Parent Folder ID',
        type: 'text',
        placeholder: 'parent-folder-id',
        description: 'ID of the parent folder (root if empty)',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'description',
        label: 'Description',
        type: 'text',
        description: 'Folder description',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['google', 'drive', 'folder', 'create', 'oauth2'],

  async execute(params, context) {
    const { credentialId, name, parentFolderId, description } = params;

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

    context.logger.debug('Creating Google Drive folder', { name });

    try {
      const metadata: Record<string, unknown> = {
        name,
        mimeType: 'application/vnd.google-apps.folder',
      };
      if (parentFolderId?.trim()) {
        metadata.parents = [parentFolderId];
      }
      if (description?.trim()) {
        metadata.description = description;
      }

      const response = await fetch(`${DRIVE_API_BASE}/files?fields=id,name,mimeType,webViewLink`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(metadata),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Google Drive API error: ${response.status} - ${errorText}`,
        };
      }

      const folder = (await response.json()) as Record<string, unknown>;

      return {
        success: true,
        output: folder,
        metadata: { folderId: folder.id },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Google Drive operation failed: ${msg}` };
    }
  },
});
