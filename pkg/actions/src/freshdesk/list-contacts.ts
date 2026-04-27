/**
 * freshdesk.list_contacts — List contacts from Freshdesk
 *
 * Retrieves a paginated list of contacts from a Freshdesk domain.
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
  email: z.string().optional(),
  phone: z.string().optional(),
  companyId: z.number().int().optional(),
  state: z.enum(['blocked', 'deleted', 'unverified', 'verified']).optional(),
  updatedSince: z.string().optional(),
});

export const freshdeskListContactsAction = defineAction({
  id: 'freshdesk.list_contacts',
  name: 'List Contacts',
  description:
    'List contacts from a Freshdesk helpdesk (GET /api/v2/contacts). Use when the user wants to retrieve customer contact records. ' +
    'Supports filters: `email`, `phone`, `company_id`, `state` (blocked, deleted, unverified, verified), `updated_since` (ISO 8601). ' +
    'Results are paginated; use `page` and `per_page` (max 100). All unblocked and undeleted contacts are returned by default.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '[{"id": 101, "name": "Jane Doe", "email": "jane@example.com", "phone": "+1-555-0100", "company_id": 23, "active": true, "job_title": "Manager", "created_at": "2025-01-10T09:00:00Z"}]\n' +
    '```',
  provider: FRESHDESK_PROVIDER,
  actionCategory: 'read',
  tags: ['freshdesk', 'support', 'contacts', 'helpdesk', 'list', 'oauth2'],

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
        description: 'Number of contacts to return per page (1–100)',
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
        name: 'email',
        label: 'Email Filter',
        type: 'text',
        placeholder: 'customer@example.com',
        description: 'Filter contacts by exact email address',
        aiProvided: true,
        extended: true,
      },
      {
        name: 'phone',
        label: 'Phone Filter',
        type: 'text',
        placeholder: '+15550100',
        description: 'Filter contacts by phone number',
        aiProvided: true,
        extended: true,
      },
      {
        name: 'companyId',
        label: 'Company ID',
        type: 'number',
        description: 'Filter contacts by company ID',
        aiProvided: true,
        extended: true,
      },
      {
        name: 'state',
        label: 'State',
        type: 'select',
        description: 'Filter contacts by verification/deletion state',
        aiProvided: true,
        extended: true,
        options: [
          { label: 'Verified', value: 'verified' },
          { label: 'Unverified', value: 'unverified' },
          { label: 'Blocked', value: 'blocked' },
          { label: 'Deleted', value: 'deleted' },
        ],
      },
      {
        name: 'updatedSince',
        label: 'Updated Since',
        type: 'text',
        placeholder: '2025-01-01T00:00:00Z',
        description: 'Return contacts updated after this ISO 8601 timestamp',
        aiProvided: true,
        extended: true,
      },
    ],
  },

  async execute(params, context) {
    const { credentialId, domain, perPage, page, email, phone, companyId, state, updatedSince } =
      params;

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

    context.logger.debug('Listing Freshdesk contacts', { domain, perPage });

    try {
      const queryParams = new URLSearchParams();
      queryParams.set('per_page', String(perPage));
      if (page !== undefined) {
        queryParams.set('page', String(page));
      }
      if (email) {
        queryParams.set('email', email);
      }
      if (phone) {
        queryParams.set('phone', phone);
      }
      if (companyId !== undefined) {
        queryParams.set('company_id', String(companyId));
      }
      if (state) {
        queryParams.set('state', state);
      }
      if (updatedSince) {
        queryParams.set('updated_since', updatedSince);
      }

      const response = await fetch(`${baseUrl}/api/v2/contacts?${queryParams.toString()}`, {
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

      const contacts = await response.json();

      return {
        success: true,
        output: { contacts, count: Array.isArray(contacts) ? contacts.length : 0 },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to list Freshdesk contacts: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
});
