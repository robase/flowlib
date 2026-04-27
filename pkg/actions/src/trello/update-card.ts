/**
 * trello.update_card — Update an existing Trello card
 *
 * Updates fields on a card identified by its ID. All fields are optional;
 * only provided values are sent to the API. Can also move a card to a
 * different list by providing a new listId.
 * Requires a Trello OAuth2 credential.
 */

import { defineAction } from '@flowlib/action-kit';
import { TRELLO_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const TRELLO_API = 'https://api.trello.com/1';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Trello credential is required'),
  cardId: z.string().min(1, 'Card ID is required'),
  name: z.string().optional().default(''),
  description: z.string().optional().default(''),
  listId: z.string().optional().default(''),
  due: z.string().optional().default(''),
  closed: z.boolean().optional(),
});

export const trelloUpdateCardAction = defineAction({
  id: 'trello.update_card',
  name: 'Update Card',
  description:
    "Update an existing Trello card (PUT /1/cards/{id}). Use when the user wants to modify a card's name, description, due date, or move it to a different list.\n\n" +
    'Example response:\n' +
    '```json\n' +
    '{"id": "card123", "name": "Updated card", "desc": "New description", "due": "2024-03-01T12:00:00.000Z", "url": "https://trello.com/c/abc123"}\n' +
    '```',
  provider: TRELLO_PROVIDER,
  actionCategory: 'write',

  credential: {
    required: true,
    type: 'oauth2',
    oauth2Provider: 'trello',
    requiredScopes: ['read', 'write'],
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
        name: 'cardId',
        label: 'Card ID',
        type: 'text',
        required: true,
        placeholder: 'e.g. 60d5ecb2c...',
        description: 'The ID of the card to update.',
        aiProvided: true,
      },
      {
        name: 'name',
        label: 'Name',
        type: 'text',
        placeholder: 'New card name',
        description: 'Updated card name. Leave empty to keep unchanged.',
        aiProvided: true,
      },
      {
        name: 'description',
        label: 'Description',
        type: 'textarea',
        placeholder: 'Updated description...',
        description: 'Updated card description.',
        aiProvided: true,
      },
      {
        name: 'listId',
        label: 'Move to List',
        type: 'text',
        placeholder: 'Target list ID',
        description: 'Move the card to a different list by providing the target list ID.',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'due',
        label: 'Due Date',
        type: 'text',
        placeholder: 'YYYY-MM-DD or ISO 8601',
        description: 'Updated due date for the card.',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'closed',
        label: 'Archived',
        type: 'boolean',
        description: 'Set to true to archive the card, false to unarchive.',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['trello', 'cards', 'update', 'project-management'],

  async execute(params, context) {
    const { credentialId, cardId, name, description, listId, due, closed } = params;

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

    context.logger.debug('Updating Trello card', { cardId });

    const cardData: Record<string, unknown> = {};
    if (name) {
      cardData.name = name;
    }
    if (description) {
      cardData.desc = description;
    }
    if (listId) {
      cardData.idList = listId;
    }
    if (due) {
      cardData.due = due;
    }
    if (closed !== undefined) {
      cardData.closed = closed;
    }

    try {
      const url = new URL(`${TRELLO_API}/cards/${encodeURIComponent(cardId)}`);

      const headers: Record<string, string> = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      };

      if (apiKey) {
        url.searchParams.set('key', apiKey);
        url.searchParams.set('token', accessToken);
      } else {
        headers.Authorization = `Bearer ${accessToken}`;
      }

      const response = await fetch(url.toString(), {
        method: 'PUT',
        headers,
        body: JSON.stringify(cardData),
      });

      if (!response.ok) {
        const errText = await response.text();
        return { success: false, error: `Trello API error (${response.status}): ${errText}` };
      }

      const card = await response.json();
      return { success: true, output: card };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Trello request failed: ${msg}` };
    }
  },
});
