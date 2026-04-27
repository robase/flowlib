/**
 * trello.create_card — Create a new card in a Trello list
 *
 * Creates a card with the given name and optional description, due date,
 * and position. Requires a Trello OAuth2 credential.
 */

import { defineAction } from '@flowlib/action-kit';
import { TRELLO_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const TRELLO_API = 'https://api.trello.com/1';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Trello credential is required'),
  listId: z.string().min(1, 'List ID is required'),
  name: z.string().min(1, 'Card name is required'),
  description: z.string().optional().default(''),
  due: z.string().optional().default(''),
  position: z.string().optional().default(''),
});

export const trelloCreateCardAction = defineAction({
  id: 'trello.create_card',
  name: 'Create Card',
  description:
    'Create a new card in a Trello list (POST /1/cards). Use when the user wants to add a task or item to a Trello board.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"id": "card123", "name": "New feature", "desc": "", "due": null, "url": "https://trello.com/c/H0TZyzbK", "idList": "list123"}\n' +
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
        name: 'listId',
        label: 'List ID',
        type: 'text',
        required: true,
        placeholder: 'e.g. 60d5ecb2b...',
        description: 'The ID of the list to create the card in.',
        aiProvided: true,
      },
      {
        name: 'name',
        label: 'Card Name',
        type: 'text',
        required: true,
        placeholder: 'My new card',
        description: 'The name/title of the card.',
        aiProvided: true,
      },
      {
        name: 'description',
        label: 'Description',
        type: 'textarea',
        placeholder: 'Card description...',
        description: 'Optional description for the card.',
        aiProvided: true,
      },
      {
        name: 'due',
        label: 'Due Date',
        type: 'text',
        placeholder: 'YYYY-MM-DD or ISO 8601',
        description: 'Optional due date for the card.',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'position',
        label: 'Position',
        type: 'text',
        placeholder: 'top or bottom',
        description: "Optional position: 'top' or 'bottom' of the list.",
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['trello', 'cards', 'create', 'project-management'],

  async execute(params, context) {
    const { credentialId, listId, name, description, due, position } = params;

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

    context.logger.debug('Creating Trello card', { listId, name });

    try {
      const url = new URL(`${TRELLO_API}/cards`);

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

      const body: Record<string, unknown> = {
        idList: listId,
        name,
      };
      if (description) {
        body.desc = description;
      }
      if (due) {
        body.due = due;
      }
      if (position) {
        body.pos = position;
      }

      const response = await fetch(url.toString(), {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
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
