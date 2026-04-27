/**
 * hubspot.list_contacts — List contacts from HubSpot CRM
 *
 * Retrieves a paginated list of contacts from the HubSpot CRM API.
 * Supports selecting specific properties to return.
 * Requires a HubSpot OAuth2 credential with crm.objects.contacts.read scope.
 */

import { defineAction } from '@flowlib/action-kit';
import { HUBSPOT_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const HUBSPOT_API = 'https://api.hubapi.com';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'HubSpot credential is required'),
  limit: z.number().int().min(1).max(100).optional().default(10),
  properties: z.string().optional().default('firstname,lastname,email'),
});

export const hubspotListContactsAction = defineAction({
  id: 'hubspot.list_contacts',
  name: 'List Contacts',
  description:
    'List contacts from HubSpot CRM (GET /crm/v3/objects/contacts). Use when the user wants to retrieve a paginated list of contacts. Pass `limit` (1–100) and optionally `properties` as a comma-separated list of fields to include. To paginate, use the `paging.next.after` value from the previous response as a query param in subsequent calls.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"results": [{"id": "501", "properties": {"email": "jane@example.com", "firstname": "Jane", "lastname": "Doe"}, "createdAt": "2022-06-01T14:31:48.469Z", "updatedAt": "2025-07-07T20:27:17.947Z", "archived": false}], "paging": {"next": {"after": "502"}}}\n' +
    '```',
  provider: HUBSPOT_PROVIDER,
  actionCategory: 'read',

  credential: {
    required: true,
    type: 'oauth2',
    oauth2Provider: 'hubspot',
    requiredScopes: ['crm.objects.contacts.read'],
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
        name: 'limit',
        label: 'Limit',
        type: 'number',
        defaultValue: 10,
        description: 'Maximum number of contacts to return (1–100)',
        aiProvided: true,
        extended: true,
      },
      {
        name: 'properties',
        label: 'Properties',
        type: 'text',
        defaultValue: 'firstname,lastname,email',
        placeholder: 'firstname,lastname,email',
        description: 'Comma-separated list of contact properties to include',
        aiProvided: true,
        extended: true,
      },
    ],
  },

  tags: ['hubspot', 'crm', 'contacts', 'list', 'oauth2'],

  async execute(params, context) {
    const { credentialId, limit, properties } = params;

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

    context.logger.debug('Listing HubSpot contacts', { limit, properties });

    try {
      const url = new URL(`${HUBSPOT_API}/crm/v3/objects/contacts`);
      url.searchParams.set('limit', String(limit));
      if (properties) {
        url.searchParams.set('properties', properties);
      }

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errText = await response.text();
        return {
          success: false,
          error: `HubSpot API error (${response.status}): ${errText}`,
        };
      }

      const data = (await response.json()) as { results?: unknown[] };
      return {
        success: true,
        output: data,
        metadata: {
          count: data.results?.length ?? 0,
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `HubSpot list contacts failed: ${msg}` };
    }
  },
});
