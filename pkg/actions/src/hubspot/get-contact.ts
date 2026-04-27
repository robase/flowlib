/**
 * hubspot.get_contact — Get a single contact from HubSpot CRM
 *
 * Retrieves a contact by its HubSpot contact ID, with optional property selection.
 * Requires a HubSpot OAuth2 credential with crm.objects.contacts.read scope.
 */

import { defineAction } from '@flowlib/action-kit';
import { HUBSPOT_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const HUBSPOT_API = 'https://api.hubapi.com';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'HubSpot credential is required'),
  contactId: z.string().min(1, 'Contact ID is required'),
  properties: z.string().optional().default(''),
});

export const hubspotGetContactAction = defineAction({
  id: 'hubspot.get_contact',
  name: 'Get Contact',
  description:
    'Get a single contact by ID from HubSpot CRM (GET /crm/v3/objects/contacts/{contactId}). Use when the user wants to look up a specific contact by their HubSpot record ID. Pass the `contactId` and optionally a comma-separated `properties` list to select which fields are returned. To look up a contact by email instead, use `hubspot.search_objects` with objectType=contacts.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"id": "501", "properties": {"email": "jane@example.com", "firstname": "Jane", "lastname": "Doe"}, "createdAt": "2024-01-01T00:00:00.000Z", "updatedAt": "2024-06-01T00:00:00.000Z", "archived": false}\n' +
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
        name: 'contactId',
        label: 'Contact ID',
        type: 'text',
        required: true,
        placeholder: '12345',
        description: 'The HubSpot contact ID to retrieve',
        aiProvided: true,
      },
      {
        name: 'properties',
        label: 'Properties',
        type: 'text',
        placeholder: 'firstname,lastname,email',
        description: 'Comma-separated list of contact properties to include (optional)',
        aiProvided: true,
        extended: true,
      },
    ],
  },

  tags: ['hubspot', 'crm', 'contacts', 'get', 'oauth2'],

  async execute(params, context) {
    const { credentialId, contactId, properties } = params;

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

    context.logger.debug('Getting HubSpot contact', { contactId, properties });

    try {
      const url = new URL(`${HUBSPOT_API}/crm/v3/objects/contacts/${contactId}`);
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

      const data = await response.json();
      return { success: true, output: data };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `HubSpot get contact failed: ${msg}` };
    }
  },
});
