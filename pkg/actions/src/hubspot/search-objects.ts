/**
 * hubspot.search_objects — Search CRM objects in HubSpot
 *
 * Performs a text search across HubSpot CRM object types (contacts, companies,
 * deals, or tickets). Uses the HubSpot CRM search API.
 * Requires a HubSpot OAuth2 credential with the appropriate crm.objects.*.read scope.
 */

import { defineAction } from '@flowlib/action-kit';
import { HUBSPOT_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const HUBSPOT_API = 'https://api.hubapi.com';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'HubSpot credential is required'),
  objectType: z.enum(['contacts', 'companies', 'deals', 'tickets']),
  query: z.string().min(1, 'Search query is required'),
  limit: z.number().int().min(1).max(100).optional().default(10),
});

export const hubspotSearchObjectsAction = defineAction({
  id: 'hubspot.search_objects',
  name: 'Search Objects',
  description:
    'Search HubSpot CRM objects by text query (POST /crm/v3/objects/{objectType}/search). Use when the user wants to find contacts, companies, deals, or tickets matching a keyword. Pass `objectType` and a `query` string; the API searches default text properties for that object type. Results are paginated — use the `paging.next.after` value from the response to fetch subsequent pages.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"total": 2, "results": [{"id": "501", "properties": {"email": "jane@example.com", "firstname": "Jane"}, "createdAt": "2024-01-17T19:55:04.281Z", "updatedAt": "2024-09-11T13:27:39.356Z", "archived": false}], "paging": {"next": {"after": "10"}}}\n' +
    '```',
  provider: HUBSPOT_PROVIDER,
  actionCategory: 'read',

  credential: {
    required: true,
    type: 'oauth2',
    oauth2Provider: 'hubspot',
    requiredScopes: [
      'crm.objects.contacts.read',
      'crm.objects.companies.read',
      'crm.objects.deals.read',
      'crm.objects.tickets.read',
    ],
    description: 'HubSpot OAuth2 credential',
  },

  params: {
    schema: paramsSchema,
    fields: [
      {
        name: 'credentialId',
        label: 'HubSpot Credential',
        type: 'text',
        required: true,
        description: 'HubSpot OAuth2 credential for authentication',
        aiProvided: false,
      },
      {
        name: 'objectType',
        label: 'Object Type',
        type: 'select',
        required: true,
        options: [
          { label: 'Contacts', value: 'contacts' },
          { label: 'Companies', value: 'companies' },
          { label: 'Deals', value: 'deals' },
          { label: 'Tickets', value: 'tickets' },
        ],
        description: 'The CRM object type to search',
        aiProvided: true,
      },
      {
        name: 'query',
        label: 'Search Query',
        type: 'text',
        required: true,
        placeholder: 'Jane Doe',
        description: 'Text to search for across default searchable properties',
        aiProvided: true,
      },
      {
        name: 'limit',
        label: 'Limit',
        type: 'number',
        defaultValue: 10,
        description: 'Maximum number of results to return (1–100)',
        aiProvided: true,
        extended: true,
      },
    ],
  },

  tags: ['hubspot', 'crm', 'search', 'contacts', 'companies', 'deals', 'tickets', 'oauth2'],

  async execute(params, context) {
    const { credentialId, objectType, query, limit } = params;

    let credential = context.credential;
    if (!credential && context.functions?.getCredential) {
      credential = await context.functions.getCredential(credentialId);
    }
    if (!credential) {
      return {
        success: false,
        error: `Credential not found: ${credentialId}. Please create a HubSpot OAuth2 credential.`,
      };
    }

    const accessToken =
      (credential.config?.accessToken as string) ?? (credential.config?.token as string);
    if (!accessToken) {
      return {
        success: false,
        error: 'No valid access token in credential. Please re-authorize the HubSpot credential.',
      };
    }

    context.logger.debug('Searching HubSpot objects', { objectType, query, limit });

    try {
      const response = await fetch(`${HUBSPOT_API}/crm/v3/objects/${objectType}/search`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query, limit }),
      });

      if (!response.ok) {
        const errText = await response.text();
        return {
          success: false,
          error: `HubSpot API error (${response.status}): ${errText}`,
        };
      }

      const data = (await response.json()) as { results?: unknown[]; total?: number };
      return {
        success: true,
        output: data,
        metadata: {
          objectType,
          count: data.results?.length ?? 0,
          total: data.total ?? 0,
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `HubSpot search failed: ${msg}` };
    }
  },
});
