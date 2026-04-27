/**
 * zendesk.list_tickets — List tickets from Zendesk
 *
 * Fetches a paginated list of tickets from a Zendesk instance,
 * sorted by creation date (newest first).
 * Requires a Zendesk OAuth2 credential with ticket read scopes.
 */

import { defineAction } from '@flowlib/action-kit';
import { ZENDESK_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Zendesk credential is required'),
  subdomain: z.string().min(1, 'Zendesk subdomain is required'),
  perPage: z.number().int().min(1).max(100).optional().default(25),
});

export const zendeskListTicketsAction = defineAction({
  id: 'zendesk.list_tickets',
  name: 'List Tickets',
  description:
    'List tickets from a Zendesk instance (GET /api/v2/tickets). Use when the user wants to retrieve a paginated list of support tickets sorted by newest first. Call with optional `perPage` (1–100, default 25). Note: does not support query filtering — use `zendesk.search` instead.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"tickets": [{"id": 35436, "subject": "Help!", "status": "open", "priority": "normal", "requester_id": 123}], "count": 1, "meta": {"has_more": true}}\n' +
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
        name: 'perPage',
        label: 'Results Per Page',
        type: 'number',
        defaultValue: 25,
        description: 'Number of tickets to return (1–100).',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['zendesk', 'tickets', 'list', 'support', 'oauth2'],

  async execute(params, context) {
    const { credentialId, subdomain, perPage } = params;

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
    const url = `${baseUrl}/api/v2/tickets?page[size]=${perPage}&sort=-created_at`;

    context.logger.debug('Listing Zendesk tickets', { subdomain, perPage });

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
      const tickets = (data.tickets as unknown[]) ?? [];

      return {
        success: true,
        output: {
          tickets,
          count: tickets.length,
          meta: data.meta ?? null,
          links: data.links ?? null,
        },
      };
    } catch (err) {
      return {
        success: false,
        error: `Failed to list Zendesk tickets: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});
