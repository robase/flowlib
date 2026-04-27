/**
 * trello.list_cards — List cards in a Trello list
 *
 * Retrieves all cards within a specified list. Returns card names,
 * descriptions, due dates, labels, and URLs.
 * Requires a Trello OAuth2 credential.
 */

import { defineAction } from '@flowlib/action-kit';
import { TRELLO_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const TRELLO_API = 'https://api.trello.com/1';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Trello credential is required'),
  listId: z.string().min(1, 'List ID is required'),
});

export const trelloListCardsAction = defineAction({
  id: 'trello.list_cards',
  name: 'List Cards',
  description:
    'List all cards in a Trello list (GET /1/lists/{id}/cards). Use when the user wants to see items in a specific list on a Trello board.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '[{"id": "card123", "name": "Fix bug", "desc": "Details...", "due": "2024-03-01T12:00:00.000Z", "labels": [{"name": "Bug", "color": "red"}], "url": "https://trello.com/c/abc123"}]\n' +
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
        name: 'listId',
        label: 'List ID',
        type: 'text',
        required: true,
        placeholder: 'e.g. 60d5ecb2b...',
        description: 'The ID of the list to retrieve cards from.',
        aiProvided: true,
      },
    ],
  },

  tags: ['trello', 'cards', 'lists', 'project-management'],

  async execute(params, context) {
    const { credentialId, listId } = params;

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

    context.logger.debug('Listing Trello cards', { listId });

    try {
      const url = new URL(`${TRELLO_API}/lists/${encodeURIComponent(listId)}/cards`);
      url.searchParams.set('fields', 'name,desc,due,dueComplete,labels,url');

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

      const cards = await response.json();
      return { success: true, output: cards };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Trello request failed: ${msg}` };
    }
  },
});
