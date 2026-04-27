/**
 * intercom.get_contact — Get a contact by ID from Intercom
 *
 * Retrieves a single contact's full details by their Intercom contact ID.
 * Requires an Intercom OAuth2 credential.
 */

import { defineAction } from '@flowlib/action-kit';
import { INTERCOM_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const INTERCOM_API = 'https://api.intercom.io';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Intercom credential is required'),
  contactId: z.string().min(1, 'Contact ID is required'),
});

export const intercomGetContactAction = defineAction({
  id: 'intercom.get_contact',
  name: 'Get Contact',
  description:
    'Get a single contact by ID from Intercom (GET /contacts/{contactId}). Use when the user wants to retrieve full details of a specific Intercom contact.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"id": "abc123", "role": "user", "email": "jane@example.com", "name": "Jane Doe", "created_at": 1700000000}\n' +
    '```',
  provider: INTERCOM_PROVIDER,
  actionCategory: 'read',

  credential: {
    required: true,
    type: 'oauth2',
    oauth2Provider: 'intercom',
    description: 'Intercom OAuth2 credential',
  },

  params: {
    schema: paramsSchema,
    fields: [
      {
        name: 'credentialId',
        label: 'Intercom Credential',
        type: 'text',
        required: true,
        description: 'Intercom OAuth2 credential for authentication',
        aiProvided: false,
      },
      {
        name: 'contactId',
        label: 'Contact ID',
        type: 'text',
        required: true,
        placeholder: '6543210abc',
        description: 'The Intercom contact ID to retrieve',
        aiProvided: true,
      },
    ],
  },

  tags: ['intercom', 'contacts', 'get', 'crm', 'oauth2'],

  async execute(params, context) {
    const { credentialId, contactId } = params;

    let credential = context.credential;
    if (!credential && context.functions?.getCredential) {
      credential = await context.functions.getCredential(credentialId);
    }
    if (!credential) {
      return {
        success: false,
        error: `Credential not found: ${credentialId}. Please create an Intercom OAuth2 credential.`,
      };
    }

    const accessToken =
      (credential.config?.accessToken as string) ?? (credential.config?.token as string);
    if (!accessToken) {
      return {
        success: false,
        error: 'No valid access token in credential. Please re-authorize the Intercom credential.',
      };
    }

    context.logger.debug('Getting Intercom contact', { contactId });

    try {
      const response = await fetch(`${INTERCOM_API}/contacts/${encodeURIComponent(contactId)}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
          'Intercom-Version': '2.12',
        },
      });

      if (!response.ok) {
        const errorBody = await response.text();
        return {
          success: false,
          error: `Intercom API error (${response.status}): ${errorBody}`,
        };
      }

      const contact = (await response.json()) as {
        id: string;
        type: string;
        role: string;
        email: string | null;
        name: string | null;
        phone: string | null;
        external_id: string | null;
        created_at: number;
        updated_at: number;
        last_seen_at: number | null;
        signed_up_at: number | null;
        browser: string | null;
        os: string | null;
        location: Record<string, unknown> | null;
        tags: { data: Array<{ id: string; name: string }> } | null;
      };

      return {
        success: true,
        output: {
          id: contact.id,
          role: contact.role,
          email: contact.email,
          name: contact.name,
          phone: contact.phone,
          externalId: contact.external_id,
          createdAt: contact.created_at,
          updatedAt: contact.updated_at,
          lastSeenAt: contact.last_seen_at,
          signedUpAt: contact.signed_up_at,
          browser: contact.browser,
          os: contact.os,
          location: contact.location,
          tags: contact.tags?.data ?? [],
        },
        metadata: {
          contactId: contact.id,
          role: contact.role,
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Intercom get contact failed: ${msg}` };
    }
  },
});
