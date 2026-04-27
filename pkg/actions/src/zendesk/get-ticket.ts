/**
 * zendesk.get_ticket — Get a single ticket from Zendesk
 *
 * Fetches a ticket by its ID from a Zendesk instance.
 * Returns full ticket details including requester, assignee, and comments.
 * Requires a Zendesk OAuth2 credential with ticket read scopes.
 */

import { defineAction } from '@flowlib/action-kit';
import { ZENDESK_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Zendesk credential is required'),
  subdomain: z.string().min(1, 'Zendesk subdomain is required'),
  ticketId: z.string().min(1, 'Ticket ID is required'),
});

export const zendeskGetTicketAction = defineAction({
  id: 'zendesk.get_ticket',
  name: 'Get Ticket',
  description:
    'Get a single Zendesk ticket by ID (GET /api/v2/tickets/{ticketId}). Use when the user wants to retrieve full details of a specific support ticket including its status, priority, requester, assignee, tags, and description. Call with `ticketId`.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"id": 35436, "subject": "Help!", "status": "open", "priority": "normal", "requester_id": 123, "assignee_id": 235323, "tags": ["billing"], "created_at": "2024-01-15T10:00:00Z"}\n' +
    '```',
  provider: ZENDESK_PROVIDER,
  actionCategory: 'read',

  credential: {
    required: true,
    type: 'oauth2',
    oauth2Provider: 'zendesk',
    requiredScopes: ['read'],
    description: 'Zendesk OAuth2 credential with ticket read access',
  },

  params: {
    schema: paramsSchema,
    fields: [
      {
        name: 'credentialId',
        label: 'Zendesk Credential',
        type: 'text',
        required: true,
        description: 'Zendesk OAuth2 credential for authentication',
        aiProvided: false,
      },
      {
        name: 'subdomain',
        label: 'Subdomain',
        type: 'text',
        required: true,
        placeholder: 'e.g. mycompany',
        description: 'Your Zendesk subdomain (the part before .zendesk.com)',
        aiProvided: false,
      },
      {
        name: 'ticketId',
        label: 'Ticket ID',
        type: 'text',
        required: true,
        placeholder: 'e.g. 12345',
        description: 'The numeric ID of the ticket to retrieve',
        aiProvided: true,
      },
    ],
  },

  tags: ['zendesk', 'tickets', 'get', 'support', 'oauth2'],

  async execute(params, context) {
    const { credentialId, subdomain, ticketId } = params;

    // Resolve credential
    let credential = context.credential;
    if (!credential && context.functions?.getCredential) {
      credential = await context.functions.getCredential(credentialId);
    }
    if (!credential) {
      return {
        success: false,
        error: `Credential not found: ${credentialId}. Please create a Zendesk OAuth2 credential.`,
      };
    }

    const accessToken =
      (credential.config?.accessToken as string) ?? (credential.config?.token as string);
    if (!accessToken) {
      return {
        success: false,
        error: 'No valid access token in credential. Please re-authorize the Zendesk credential.',
      };
    }

    const baseUrl = `https://${encodeURIComponent(subdomain)}.zendesk.com`;
    const url = `${baseUrl}/api/v2/tickets/${encodeURIComponent(ticketId)}`;

    context.logger.debug('Getting Zendesk ticket', { subdomain, ticketId });

    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Zendesk API error (${response.status}): ${errorText}`,
        };
      }

      const data = (await response.json()) as Record<string, unknown>;

      return {
        success: true,
        output: data.ticket ?? data,
      };
    } catch (err) {
      return {
        success: false,
        error: `Failed to get Zendesk ticket: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});
