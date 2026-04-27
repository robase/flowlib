/**
 * trello.list_boards — List boards accessible by the authenticated user
 *
 * Retrieves all open boards for the current Trello member.
 * Requires a Trello OAuth2 credential with an API key and access token.
 */

import { defineAction } from '@flowlib/action-kit';
import { TRELLO_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const TRELLO_API = 'https://api.trello.com/1';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Trello credential is required'),
});

export const trelloListBoardsAction = defineAction({
  id: 'trello.list_boards',
  name: 'List Boards',
  description:
    'List all Trello boards accessible by the authenticated user (GET /1/members/me/boards). Use when the user needs to find board IDs before listing lists or cards.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '[{"id": "board123", "name": "Project Alpha", "desc": "Main board", "url": "https://trello.com/b/abc123", "closed": false}]\n' +
    '```',
  provider: TRELLO_PROVIDER,
  actionCategory: 'read',

  credential: {
    required: true,
    type: 'oauth2',
    oauth2Provider: 'trello',
    requiredScopes: ['read'],
    description: 'Trello OAuth2 credential',
  },

  params: {
    schema: paramsSchema,
    fields: [
      {
        name: 'credentialId',
        label: 'Trello Credential',
        type: 'text',
        required: true,
        description: 'Trello OAuth2 credential for authentication',
        aiProvided: false,
      },
    ],
  },

  tags: ['trello', 'boards', 'list', 'project-management'],

  async execute(params, context) {
    const { credentialId } = params;

    let credential = context.credential;
    if (!credential && context.functions?.getCredential) {
      credential = await context.functions.getCredential(credentialId);
    }
    if (!credential) {
      return {
        success: false,
        error: `Credential not found: ${credentialId}. Please create a Trello OAuth2 credential.`,
      };
    }

    const accessToken =
      (credential.config?.accessToken as string) ?? (credential.config?.token as string);
    if (!accessToken) {
      return {
        success: false,
        error: 'No valid access token in credential. Please re-authorize the Trello credential.',
      };
    }

    const apiKey = (credential.config?.apiKey as string) ?? (credential.config?.clientId as string);

    context.logger.debug('Listing Trello boards');

    try {
      const url = new URL(`${TRELLO_API}/members/me/boards`);
      url.searchParams.set('fields', 'name,desc,url,closed');

      const headers: Record<string, string> = { Accept: 'application/json' };

      if (apiKey) {
        url.searchParams.set('key', apiKey);
        url.searchParams.set('token', accessToken);
      } else {
        headers.Authorization = `Bearer ${accessToken}`;
      }

      const response = await fetch(url.toString(), { headers });

      if (!response.ok) {
        const errText = await response.text();
        return { success: false, error: `Trello API error (${response.status}): ${errText}` };
      }

      const boards = await response.json();
      return { success: true, output: boards };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Trello request failed: ${msg}` };
    }
  },
});
