/**
 * sendgrid.list_verified_senders — List verified sender identities
 *
 * Retrieves all verified single sender identities from the SendGrid account.
 * Useful for discovering which "from" addresses are available for sending.
 *
 * @see https://www.twilio.com/docs/sendgrid/api-reference/sender-verification/get-all-verified-senders
 */

import { defineAction } from '@flowlib/action-kit';
import { SENDGRID_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'SendGrid credential is required'),
  baseUrl: z.string().optional().default('https://api.sendgrid.com'),
  limit: z.number().int().min(1).max(100).optional().default(50),
  offset: z.number().int().min(0).optional().default(0),
});

export const sendgridListVerifiedSendersAction = defineAction({
  id: 'sendgrid.list_verified_senders',
  name: 'List Verified Senders',
  description:
    'List all verified single sender identities (GET /v3/verified_senders). Call with optional `limit` and `offset` for pagination. Use when the user wants to discover which "from" email addresses are available for sending, or to verify a sender exists before calling `sendgrid.send_email`.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"results": [{"id": 1234, "from_email": "sender@example.com", "from_name": "My Company", "reply_to": "reply@example.com", "address": "123 Main St", "verified": true}]}\n' +
    '```',
  provider: SENDGRID_PROVIDER,
  actionCategory: 'read',
  tags: ['sendgrid', 'senders', 'verified', 'list', 'email', 'configuration'],

  credential: {
    required: true,
    description: 'SendGrid API key credential',
  },

  params: {
    schema: paramsSchema,
    fields: [
      {
        name: 'credentialId',
        label: 'SendGrid Credential',
        type: 'text',
        required: true,
        description: 'SendGrid API key credential for authentication',
        aiProvided: false,
      },
      {
        name: 'baseUrl',
        label: 'API Base URL',
        type: 'text',
        required: false,
        defaultValue: 'https://api.sendgrid.com',
        description: 'SendGrid API base URL',
        extended: true,
        aiProvided: false,
      },
      {
        name: 'limit',
        label: 'Limit',
        type: 'number',
        required: false,
        defaultValue: 50,
        description: 'Maximum number of senders to return',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'offset',
        label: 'Offset',
        type: 'number',
        required: false,
        defaultValue: 0,
        description: 'Pagination offset',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  async execute(params, context) {
    const { credentialId, baseUrl, limit, offset } = params;

    let credential = context.credential;
    if (!credential && context.functions?.getCredential) {
      credential = await context.functions.getCredential(credentialId);
    }
    if (!credential) {
      return {
        success: false,
        error: `Credential not found: ${credentialId}. Please create a SendGrid API key credential.`,
      };
    }

    const apiKey = (credential.config?.apiKey as string) ?? (credential.config?.token as string);
    if (!apiKey) {
      return {
        success: false,
        error: 'No API key found in credential. Please add a SendGrid API key.',
      };
    }

    const apiBase = baseUrl || 'https://api.sendgrid.com';
    const queryParams = new URLSearchParams();
    if (limit) {
      queryParams.set('limit', String(limit));
    }
    if (offset) {
      queryParams.set('offset', String(offset));
    }

    const qs = queryParams.toString();
    const url = `${apiBase}/v3/verified_senders${qs ? `?${qs}` : ''}`;

    context.logger.debug('Listing SendGrid verified senders', { limit, offset });

    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'User-Agent': 'flowlib/1.0',
        },
      });

      if (!response.ok) {
        const errorBody = await response.text();
        return { success: false, error: `SendGrid API error ${response.status}: ${errorBody}` };
      }

      const result = (await response.json()) as { results?: unknown[] };

      return {
        success: true,
        output: {
          senders: result.results ?? [],
          count: Array.isArray(result.results) ? result.results.length : 0,
        },
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Failed to list SendGrid verified senders: ${message}` };
    }
  },
});
