/**
 * intercom.create_contact — Create a contact in Intercom
 *
 * Creates a new lead or user contact in Intercom.
 * Requires an Intercom OAuth2 credential.
 */

import { defineAction } from '@flowlib/action-kit';
import { INTERCOM_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const INTERCOM_API = 'https://api.intercom.io';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Intercom credential is required'),
  role: z.enum(['user', 'lead']).optional().default('lead'),
  email: z.string().min(1, 'Email is required'),
  name: z.string().optional().default(''),
  phone: z.string().optional().default(''),
  externalId: z.string().optional().default(''),
});

export const intercomCreateContactAction = defineAction({
  id: 'intercom.create_contact',
  name: 'Create Contact',
  description:
    'Create a new contact (lead or user) in Intercom (POST /contacts). Use when the user wants to add a person to Intercom with email, name, and role.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"id": "abc123", "role": "lead", "email": "jane@example.com", "name": "Jane Doe", "created_at": 1700000000}\n' +
    '```',
  provider: INTERCOM_PROVIDER,
  actionCategory: 'write',

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
        name: 'role',
        label: 'Role',
        type: 'select',
        defaultValue: 'lead',
        options: [
          { label: 'Lead', value: 'lead' },
          { label: 'User', value: 'user' },
        ],
        description: 'Contact role — lead (default) or user',
        aiProvided: true,
      },
      {
        name: 'email',
        label: 'Email',
        type: 'text',
        required: true,
        placeholder: 'jane@example.com',
        description: 'Email address for the contact',
        aiProvided: true,
      },
      {
        name: 'name',
        label: 'Name',
        type: 'text',
        placeholder: 'Jane Doe',
        description: 'Full name of the contact',
        aiProvided: true,
      },
      {
        name: 'phone',
        label: 'Phone',
        type: 'text',
        placeholder: '+1-555-0100',
        description: 'Phone number of the contact',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'externalId',
        label: 'External ID',
        type: 'text',
        placeholder: 'usr_12345',
        description: 'External ID from your system to link to this contact',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['intercom', 'contacts', 'create', 'crm', 'oauth2'],

  async execute(params, context) {
    const { credentialId, role, email, name, phone, externalId } = params;

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

    context.logger.debug('Creating Intercom contact', { role, email });

    try {
      const body: Record<string, unknown> = { role, email };
      if (name) {
        body.name = name;
      }
      if (phone) {
        body.phone = phone;
      }
      if (externalId) {
        body.external_id = externalId;
      }

      const response = await fetch(`${INTERCOM_API}/contacts`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Intercom-Version': '2.12',
        },
        body: JSON.stringify(body),
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
        },
        metadata: {
          contactId: contact.id,
          role: contact.role,
          createdAt: contact.created_at,
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Intercom create contact failed: ${msg}` };
    }
  },
});
