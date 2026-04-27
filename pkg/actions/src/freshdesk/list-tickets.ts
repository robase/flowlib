/**
 * freshdesk.list_tickets — List tickets from Freshdesk
 *
 * Retrieves a paginated list of tickets from a Freshdesk domain.
 * Supports OAuth2 Bearer token or API key (Basic) authentication.
 */

import { defineAction } from '@flowlib/action-kit';
import { FRESHDESK_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Freshdesk credential is required'),
  domain: z.string().min(1, 'Freshdesk domain is required'),
  perPage: z.number().int().min(1).max(100).optional().default(30),
  page: z.number().int().min(1).optional().default(1),
  orderBy: z.enum(['created_at', 'due_by', 'updated_at', 'status']).optional(),
  orderType: z.enum(['asc', 'desc']).optional(),
  updatedSince: z.string().optional(),
  filter: z.enum(['new_and_my_open', 'watching', 'spam', 'deleted']).optional(),
  email: z.string().optional(),
  requesterId: z.number().int().optional(),
});

export const freshdeskListTicketsAction = defineAction({
  id: 'freshdesk.list_tickets',
  name: 'List Tickets',
  description:
    'List tickets from a Freshdesk helpdesk (GET /api/v2/tickets). Use when the user wants to retrieve a paginated list of support tickets. ' +
    'Supports filters: `filter` (new_and_my_open, watching, spam, deleted), `email`, `requester_id`, `updated_since` (ISO 8601). ' +
    'Sort with `order_by` (created_at, due_by, updated_at, status) and `order_type` (asc, desc). Default sort is `created_at desc`. ' +
    'Only tickets from the last 30 days are returned by default; use `updated_since` for older tickets. Max 300 pages (30,000 tickets).\n\n' +
    'Example response:\n' +
    '```json\n' +
    '[{"id": 1, "subject": "Issue with billing", "status": 2, "priority": 1, "requester_id": 123, "group_id": 5, "type": "Problem", "created_at": "2025-01-15T10:00:00Z", "updated_at": "2025-01-16T08:30:00Z"}]\n' +
    '```',
  provider: FRESHDESK_PROVIDER,
  actionCategory: 'read',
  tags: ['freshdesk', 'support', 'tickets', 'helpdesk', 'list', 'oauth2'],

  credential: {
    required: true,
    type: 'oauth2',
    oauth2Provider: 'freshdesk',
    description: 'Freshdesk OAuth2 credential or API key credential',
  },

  params: {
    schema: paramsSchema,
    fields: [
      {
        name: 'credentialId',
        label: 'Freshdesk Credential',
        type: 'text',
        required: true,
        description: 'Freshdesk OAuth2 or API key credential',
        aiProvided: false,
      },
      {
        name: 'domain',
        label: 'Domain',
        type: 'text',
        required: true,
        placeholder: 'mycompany',
        description: 'Your Freshdesk subdomain (e.g. "mycompany" for mycompany.freshdesk.com)',
        aiProvided: false,
      },
      {
        name: 'perPage',
        label: 'Per Page',
        type: 'number',
        defaultValue: 30,
        description: 'Number of tickets to return per page (1–100)',
        aiProvided: true,
        extended: true,
      },
      {
        name: 'page',
        label: 'Page',
        type: 'number',
        defaultValue: 1,
        description: 'Page number for pagination (starts at 1)',
        aiProvided: true,
        extended: true,
      },
      {
        name: 'orderBy',
        label: 'Order By',
        type: 'select',
        description: 'Field to sort tickets by',
        aiProvided: true,
        extended: true,
        options: [
          { label: 'Created At', value: 'created_at' },
          { label: 'Due By', value: 'due_by' },
          { label: 'Updated At', value: 'updated_at' },
          { label: 'Status', value: 'status' },
        ],
      },
      {
        name: 'orderType',
        label: 'Order Type',
        type: 'select',
        description: 'Sort direction (ascending or descending)',
        aiProvided: true,
        extended: true,
        options: [
          { label: 'Ascending', value: 'asc' },
          { label: 'Descending', value: 'desc' },
        ],
      },
      {
        name: 'updatedSince',
        label: 'Updated Since',
        type: 'text',
        placeholder: '2025-01-01T00:00:00Z',
        description: 'Return tickets updated after this ISO 8601 timestamp',
        aiProvided: true,
        extended: true,
      },
      {
        name: 'filter',
        label: 'Filter',
        type: 'select',
        description: 'Predefined ticket filter',
        aiProvided: true,
        extended: true,
        options: [
          { label: 'New & My Open', value: 'new_and_my_open' },
          { label: 'Watching', value: 'watching' },
          { label: 'Spam', value: 'spam' },
          { label: 'Deleted', value: 'deleted' },
        ],
      },
      {
        name: 'email',
        label: 'Requester Email',
        type: 'text',
        placeholder: 'customer@example.com',
        description: 'Filter tickets by requester email address',
        aiProvided: true,
        extended: true,
      },
      {
        name: 'requesterId',
        label: 'Requester ID',
        type: 'number',
        description: 'Filter tickets by requester user ID',
        aiProvided: true,
        extended: true,
      },
    ],
  },

  async execute(params, context) {
    const {
      credentialId,
      domain,
      perPage,
      page,
      orderBy,
      orderType,
      updatedSince,
      filter,
      email,
      requesterId,
    } = params;

    let credential = context.credential;
    if (!credential && context.functions?.getCredential) {
      credential = await context.functions.getCredential(credentialId);
    }
    if (!credential) {
      return {
        success: false,
        error: `Credential not found: ${credentialId}. Please create a Freshdesk credential.`,
      };
    }

    const accessToken =
      (credential.config?.accessToken as string) ?? (credential.config?.token as string);
    const apiKey = credential.config?.apiKey as string;

    let authHeader: string;
    if (accessToken) {
      authHeader = `Bearer ${accessToken}`;
    } else if (apiKey) {
      authHeader = `Basic ${btoa(`${apiKey}:X`)}`;
    } else {
      return { success: false, error: 'No access token or API key found in credential.' };
    }

    const baseUrl = `https://${encodeURIComponent(domain)}.freshdesk.com`;

    context.logger.debug('Listing Freshdesk tickets', { domain, perPage });

    try {
      const queryParams = new URLSearchParams();
      queryParams.set('per_page', String(perPage));
      if (page !== undefined) {
        queryParams.set('page', String(page));
      }
      if (orderBy) {
        queryParams.set('order_by', orderBy);
      }
      if (orderType) {
        queryParams.set('order_type', orderType);
      }
      if (updatedSince) {
        queryParams.set('updated_since', updatedSince);
      }
      if (filter) {
        queryParams.set('filter', filter);
      }
      if (email) {
        queryParams.set('email', email);
      }
      if (requesterId !== undefined) {
        queryParams.set('requester_id', String(requesterId));
      }

      const response = await fetch(`${baseUrl}/api/v2/tickets?${queryParams.toString()}`, {
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Freshdesk API error (${response.status}): ${errorText}`,
        };
      }

      const tickets = await response.json();

      return {
        success: true,
        output: { tickets, count: Array.isArray(tickets) ? tickets.length : 0 },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to list Freshdesk tickets: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
});
