/**
 * resend.send_batch — Send batch emails via Resend
 *
 * Sends up to 100 emails in a single API call. Each email in the batch
 * can have different recipients, subjects, and content.
 *
 * @see https://resend.com/docs/api-reference/emails/send-batch-emails
 */

import { defineAction } from '@flowlib/action-kit';
import { RESEND_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const RESEND_API_BASE = 'https://api.resend.com';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Resend credential is required'),
  emails: z.string().min(1, 'Emails JSON array is required'),
});

export const resendSendBatchAction = defineAction({
  id: 'resend.send_batch',
  name: 'Send Batch Emails',
  description:
    'Send up to 100 emails in a single API call (POST /emails/batch). Use when the user wants to send multiple emails efficiently in one request.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"data": [{"id": "ae2014de-c168-4c61-8267-70d2662a1ce1"}, {"id": "faccb7a5-8a28-4e9a-ac64-8da1cc3bc1cb"}]}\n' +
    '```',
  provider: RESEND_PROVIDER,
  actionCategory: 'write',
  tags: ['resend', 'email', 'batch', 'bulk', 'send', 'transactional'],

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
        name: 'emails',
        label: 'Emails (JSON)',
        type: 'code',
        required: true,
        placeholder:
          '[{"from":"you@domain.com","to":["a@example.com"],"subject":"Hi","html":"<p>Hello</p>"}]',
        description:
          'JSON array of email objects. Each must have: from, to (array), subject, and html or text.',
        aiProvided: true,
      },
    ],
  },

  async execute(params, context) {
    const { credentialId, emails: emailsJson } = params;

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

    let emailsArray: unknown[];
    try {
      const parsed = JSON.parse(emailsJson);
      if (!Array.isArray(parsed)) {
        return { success: false, error: 'Emails must be a JSON array' };
      }
      emailsArray = parsed;
    } catch {
      return { success: false, error: `Invalid JSON for emails: ${emailsJson}` };
    }

    if (emailsArray.length === 0) {
      return { success: false, error: 'Emails array is empty' };
    }
    if (emailsArray.length > 100) {
      return { success: false, error: 'Resend batch limit is 100 emails per request' };
    }

    context.logger.debug('Sending batch emails via Resend', { count: emailsArray.length });

    try {
      const response = await fetch(`${RESEND_API_BASE}/emails/batch`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'User-Agent': 'flowlib/1.0',
        },
        body: JSON.stringify(emailsArray),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        return { success: false, error: `Resend API error ${response.status}: ${errorBody}` };
      }

      const result = (await response.json()) as { data?: unknown[] };

      return {
        success: true,
        output: {
          data: result.data,
          count: Array.isArray(result.data) ? result.data.length : emailsArray.length,
        },
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Failed to send batch emails via Resend: ${message}` };
    }
  },
});
