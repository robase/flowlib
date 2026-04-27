/**
 * trello.list_lists — List lists in a Trello board
 *
 * Retrieves all lists within a specified board. Useful for discovering
 * list IDs before creating or moving cards.
 * Requires a Trello OAuth2 credential.
 */

import { defineAction } from '@flowlib/action-kit';
import { TRELLO_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const TRELLO_API = 'https://api.trello.com/1';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Trello credential is required'),
  boardId: z.string().min(1, 'Board ID is required'),
});

export const trelloListListsAction = defineAction({
  id: 'trello.list_lists',
  name: 'List Lists',
  description:
    'List all lists in a Trello board (GET /1/boards/{id}/lists). Use when the user needs to discover list IDs before creating or moving cards.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '[{"id": "list123", "name": "To Do", "pos": 1024, "closed": false}]\n' +
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
      {
        name: 'boardId',
        label: 'Board ID',
        type: 'text',
        required: true,
        placeholder: 'e.g. 60d5ecb2a...',
        description: 'The ID of the board to list lists from.',
        aiProvided: true,
      },
    ],
  },

  tags: ['trello', 'lists', 'boards', 'project-management'],

  async execute(params, context) {
    const { credentialId, boardId } = params;

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

    context.logger.debug('Listing Trello lists', { boardId });

    try {
      const url = new URL(`${TRELLO_API}/boards/${encodeURIComponent(boardId)}/lists`);
      url.searchParams.set('fields', 'name,closed,pos');

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

      const lists = await response.json();
      return { success: true, output: lists };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Trello request failed: ${msg}` };
    }
  },
});
