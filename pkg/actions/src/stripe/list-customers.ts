/**
 * stripe.list_customers — List Stripe customers
 *
 * Retrieves a paginated list of customers from the Stripe account.
 * Supports filtering by email and limiting the number of results.
 * Requires a Stripe credential with a secret key or access token.
 */

import { defineAction } from '@flowlib/action-kit';
import { STRIPE_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const STRIPE_API = 'https://api.stripe.com';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Stripe credential is required'),
  limit: z.number().int().min(1).max(100).optional().default(10),
  email: z.string().optional().default(''),
});

export const stripeListCustomersAction = defineAction({
  id: 'stripe.list_customers',
  name: 'List Customers',
  description:
    'List customers from a Stripe account (GET /v1/customers). Use when you need to retrieve or search customer records.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"data": [{"id": "cus_NffrFeUfNV2Hib", "name": "Jenny Rosen", "email": "jenny@example.com", "created": 1680893993}], "has_more": false}\n' +
    '```',
  provider: STRIPE_PROVIDER,
  actionCategory: 'read',

  credential: {
    required: true,
    type: 'api_key',
    description: 'Stripe secret API key (starts with sk_live_ or sk_test_)',
  },

  params: {
    schema: paramsSchema,
    fields: [
      {
        name: 'credentialId',
        label: 'Stripe Credential',
        type: 'text',
        required: true,
        description: 'Stripe credential for authentication',
        aiProvided: false,
      },
      {
        name: 'limit',
        label: 'Limit',
        type: 'number',
        defaultValue: 10,
        description: 'Maximum number of customers to return (1–100)',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'email',
        label: 'Email Filter',
        type: 'text',
        placeholder: 'user@example.com',
        description: 'Filter customers by exact email address',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['stripe', 'customers', 'list', 'payments'],

  async execute(params, context) {
    const { credentialId, limit, email } = params;

    let credential = context.credential;
    if (!credential && context.functions?.getCredential) {
      credential = await context.functions.getCredential(credentialId);
    }
    if (!credential) {
      return {
        success: false,
        error: `Credential not found: ${credentialId}. Please create a Stripe credential.`,
      };
    }

    const apiKey =
      (credential.config?.secretKey as string) ??
      (credential.config?.apiKey as string) ??
      (credential.config?.accessToken as string) ??
      (credential.config?.token as string);
    if (!apiKey) {
      return { success: false, error: 'No API key or access token found in credential.' };
    }

    context.logger.debug('Listing Stripe customers', { limit, email: email || '(none)' });

    try {
      const url = new URL(`${STRIPE_API}/v1/customers`);
      url.searchParams.set('limit', String(Math.min(Math.max(1, limit), 100)));
      if (email) {
        url.searchParams.set('email', email);
      }

      const response = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${apiKey}` },
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Stripe API error: ${response.status} ${response.statusText} - ${errorText}`,
        };
      }

      const data = (await response.json()) as {
        data: Array<Record<string, unknown>>;
        has_more: boolean;
      };

      return {
        success: true,
        output: {
          customers: data.data,
          count: data.data.length,
          hasMore: data.has_more,
        },
        metadata: { count: data.data.length, hasMore: data.has_more },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Stripe list customers failed: ${msg}` };
    }
  },
});
