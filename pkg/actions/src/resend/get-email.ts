/**
 * resend.get_email — Retrieve a single email by ID
 *
 * Fetches details of a previously sent email including delivery status,
 * recipients, subject, and the last tracked event.
 *
 * @see https://resend.com/docs/api-reference/emails/retrieve-email
 */

import { defineAction } from '@flowlib/action-kit';
import { RESEND_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const RESEND_API_BASE = 'https://api.resend.com';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Resend credential is required'),
  emailId: z.string().min(1, 'Email ID is required'),
});

export const resendGetEmailAction = defineAction({
  id: 'resend.get_email',
  name: 'Get Email',
  description:
    'Retrieve details and delivery status of a previously sent email (GET /emails/:id). Use when the user wants to check if an email was delivered, opened, or bounced.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"id": "4ef9a417-02e9-4d39-ad75-9611e0fcc33c", "to": ["user@example.com"], "subject": "Hello", "last_event": "delivered", "created_at": "2023-04-03T22:13:42.674Z"}\n' +
    '```',
  provider: RESEND_PROVIDER,
  actionCategory: 'read',
  tags: ['resend', 'email', 'get', 'retrieve', 'status', 'delivery'],

  credential: {
    required: true,
    description: 'Resend API key credential',
  },

  params: {
    schema: paramsSchema,
    fields: [
      {
        name: 'credentialId',
        label: 'Resend Credential',
        type: 'text',
        required: true,
        description: 'Resend API key credential for authentication',
        aiProvided: false,
      },
      {
        name: 'emailId',
        label: 'Email ID',
        type: 'text',
        required: true,
        placeholder: '49a3999c-0ce1-4ea6-ab68-afcd6dc2e794',
        description: 'The ID of the email to retrieve',
        aiProvided: true,
      },
    ],
  },

  async execute(params, context) {
    const { credentialId, emailId } = params;

    let credential = context.credential;
    if (!credential && context.functions?.getCredential) {
      credential = await context.functions.getCredential(credentialId);
    }
    if (!credential) {
      return {
        success: false,
        error: `Credential not found: ${credentialId}. Please create a Resend API key credential.`,
      };
    }

    const apiKey = (credential.config?.apiKey as string) ?? (credential.config?.token as string);
    if (!apiKey) {
      return {
        success: false,
        error: 'No API key found in credential. Please add a Resend API key.',
      };
    }

    context.logger.debug('Retrieving email from Resend', { emailId });

    try {
      const response = await fetch(`${RESEND_API_BASE}/emails/${encodeURIComponent(emailId)}`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'User-Agent': 'flowlib/1.0',
        },
      });

      if (!response.ok) {
        const errorBody = await response.text();
        return { success: false, error: `Resend API error ${response.status}: ${errorBody}` };
      }

      const email = await response.json();

      return {
        success: true,
        output: email,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Failed to retrieve email from Resend: ${message}` };
    }
  },
});
