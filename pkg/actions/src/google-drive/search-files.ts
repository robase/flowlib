/**
 * google_drive.search_files — Search files in Google Drive
 *
 * Search for files and folders in Google Drive using advanced query syntax.
 * Requires a Google Drive OAuth2 credential.
 */

import { defineAction } from '@flowlib/action-kit';
import { GOOGLE_DRIVE_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Google Drive credential is required'),
  searchQuery: z.string().min(1, 'Search query is required'),
  maxResults: z.number().int().min(1).max(1000).optional().default(20),
  supportsAllDrives: z.boolean().optional().default(false),
});

export const googleDriveSearchFilesAction = defineAction({
  id: 'google_drive.search_files',
  name: 'Search Files',
  description:
    'Search for files in Google Drive using query syntax (files.list with q parameter). Use when the user wants to find files by name, type, or other criteria. ' +
    "Call with `searchQuery` using Drive search syntax (e.g. \"name contains 'report' and mimeType='application/pdf'\"); optional `maxResults` and `supportsAllDrives`.\n\n" +
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
        name: 'searchQuery',
        label: 'Search Query',
        type: 'text',
        required: true,
        placeholder: "name contains 'report' and mimeType='application/pdf'",
        description: 'Google Drive search query syntax',
        aiProvided: true,
      },
      {
        name: 'maxResults',
        label: 'Max Results',
        type: 'number',
        defaultValue: 20,
        description: 'Maximum number of results (1–1000)',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'supportsAllDrives',
        label: 'Include Shared Drives',
        type: 'boolean',
        defaultValue: false,
        description: 'Include files from shared drives in results',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['google', 'drive', 'search', 'files', 'find', 'oauth2'],

  async execute(params, context) {
    const { credentialId, searchQuery, maxResults, supportsAllDrives } = params;

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

    context.logger.debug('Searching Google Drive', { searchQuery, maxResults });

    try {
      const url = new URL(`${DRIVE_API_BASE}/files`);
      url.searchParams.set('q', `${searchQuery} and trashed = false`);
      url.searchParams.set('pageSize', String(maxResults));
      url.searchParams.set(
        'fields',
        'nextPageToken,files(id,name,mimeType,size,modifiedTime,webViewLink,parents,owners)',
      );
      url.searchParams.set('orderBy', 'modifiedTime desc');

      if (supportsAllDrives) {
        url.searchParams.set('supportsAllDrives', 'true');
        url.searchParams.set('includeItemsFromAllDrives', 'true');
      }

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
          query: searchQuery,
        },
        metadata: { fileCount: data.files?.length ?? 0 },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Google Drive operation failed: ${msg}` };
    }
  },
});
