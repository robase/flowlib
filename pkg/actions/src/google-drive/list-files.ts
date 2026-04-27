/**
 * google_drive.list_files — List files in Google Drive
 *
 * Lists files and folders in Google Drive with optional search filtering.
 * Requires a Google Drive OAuth2 credential.
 */

import { defineAction } from '@flowlib/action-kit';
import { GOOGLE_DRIVE_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Google Drive credential is required'),
  query: z.string().optional().default(''),
  maxResults: z.number().int().min(1).max(1000).optional().default(20),
  folderId: z.string().optional().default(''),
  orderBy: z.string().optional().default('modifiedTime desc'),
  fields: z
    .string()
    .optional()
    .default('files(id,name,mimeType,size,modifiedTime,webViewLink,parents)'),
});

export const googleDriveListFilesAction = defineAction({
  id: 'google_drive.list_files',
  name: 'List Files',
  description:
    'List files and folders in Google Drive (files.list). Use when the user wants to browse their Drive, list recent files, or filter by folder. ' +
    'Call with optional `query` (Drive search syntax, e.g. "name contains \'report\'"), `folderId` to limit to a specific folder, and `maxResults` to control page size.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"files": [{"id": "1abc", "name": "Report.pdf", "mimeType": "application/pdf", "modifiedTime": "2025-03-15T10:00:00Z"}], "fileCount": 1, "hasMore": false}\n' +
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
        name: 'query',
        label: 'Search Query',
        type: 'text',
        placeholder: "name contains 'report' and mimeType='application/pdf'",
        description: 'Google Drive search query syntax. Leave empty to list all files.',
        aiProvided: true,
      },
      {
        name: 'folderId',
        label: 'Folder ID',
        type: 'text',
        placeholder: 'folder-id-here',
        description: 'Limit results to a specific folder by ID',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'maxResults',
        label: 'Max Results',
        type: 'number',
        defaultValue: 20,
        description: 'Maximum number of files to return (1–1000)',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'orderBy',
        label: 'Order By',
        type: 'text',
        defaultValue: 'modifiedTime desc',
        description: "Sort order (e.g. 'modifiedTime desc', 'name')",
        extended: true,
      },
      {
        name: 'fields',
        label: 'Fields',
        type: 'text',
        defaultValue: 'files(id,name,mimeType,size,modifiedTime,webViewLink,parents)',
        description: 'Specific fields to include in response',
        extended: true,
        aiProvided: false,
      },
    ],
  },

  tags: ['google', 'drive', 'files', 'list', 'search', 'oauth2'],

  async execute(params, context) {
    const { credentialId, query, maxResults, folderId, orderBy, fields } = params;

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

    context.logger.debug('Listing Google Drive files', { query, maxResults, folderId });

    try {
      const url = new URL(`${DRIVE_API_BASE}/files`);
      url.searchParams.set('pageSize', String(maxResults));
      url.searchParams.set('orderBy', orderBy);
      url.searchParams.set('fields', `nextPageToken,${fields}`);

      // Build query parts
      const queryParts: string[] = [];
      if (query?.trim()) {
        queryParts.push(query);
      }
      if (folderId?.trim()) {
        queryParts.push(`'${folderId}' in parents`);
      }
      queryParts.push('trashed = false');
      url.searchParams.set('q', queryParts.join(' and '));

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

      const data = (await response.json()) as {
        files?: Array<Record<string, unknown>>;
        nextPageToken?: string;
      };

      return {
        success: true,
        output: {
          files: data.files ?? [],
          fileCount: data.files?.length ?? 0,
          hasMore: !!data.nextPageToken,
        },
        metadata: { fileCount: data.files?.length ?? 0 },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Google Drive operation failed: ${msg}` };
    }
  },
});
