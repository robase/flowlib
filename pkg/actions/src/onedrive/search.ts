/**
 * onedrive.search — Search for files in OneDrive
 *
 * Searches OneDrive for files matching a text query.
 * Requires a Microsoft OneDrive OAuth2 credential.
 */

import { defineAction } from '@flowlib/action-kit';
import { ONEDRIVE_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const GRAPH_API = 'https://graph.microsoft.com/v1.0';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'OneDrive credential is required'),
  query: z.string().min(1, 'Search query is required'),
});

export const onedriveSearchAction = defineAction({
  id: 'onedrive.search',
  name: 'Search Files',
  description:
    "Search for files and folders in OneDrive by name or content (GET /me/drive/root/search(q='{query}')). Use when you need to find files matching a keyword across the entire drive.\n\n" +
    'Example response:\n' +
    '```json\n' +
    '{"id": "0123456789abc!123", "name": "Contoso Project", "size": 4096, "folder": {}, "webUrl": "https://onedrive.live.com/..."}\n' +
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
        name: 'query',
        label: 'Search Query',
        type: 'text',
        required: true,
        placeholder: 'quarterly report',
        description: 'Text to search for in file names and content',
        aiProvided: true,
      },
    ],
  },

  tags: ['microsoft', 'onedrive', 'search', 'files', 'find', 'oauth2'],

  async execute(params, context) {
    const { credentialId, query } = params;

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

    context.logger.debug('Searching OneDrive', { query });

    try {
      const response = await fetch(
        `${GRAPH_API}/me/drive/root/search(q='${encodeURIComponent(query)}')`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        },
      );

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
