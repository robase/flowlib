/**
 * stripe.list_charges — List Stripe charges / payments
 *
 * Retrieves a paginated list of charges from the Stripe account.
 * Supports filtering by customer ID and limiting the number of results.
 * Requires a Stripe credential with a secret key or access token.
 */

import { defineAction } from '@flowlib/action-kit';
import { STRIPE_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const STRIPE_API = 'https://api.stripe.com';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Stripe credential is required'),
  limit: z.number().int().min(1).max(100).optional().default(10),
  customer: z.string().optional().default(''),
});

export const stripeListChargesAction = defineAction({
  id: 'stripe.list_charges',
  name: 'List Charges',
  description:
    'List charges/payments from a Stripe account (GET /v1/charges). Use when you need to review payment history or look up charges for a customer.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"data": [{"id": "ch_abc123", "amount": 2000, "currency": "usd", "status": "succeeded", "customer": "cus_xyz"}], "has_more": false}\n' +
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
        description: 'Maximum number of charges to return (1–100)',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'customer',
        label: 'Customer ID',
        type: 'text',
        placeholder: 'cus_abc123',
        description: 'Filter charges by Stripe customer ID',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['stripe', 'charges', 'payments', 'list'],

  async execute(params, context) {
    const { credentialId, limit, customer } = params;

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

    context.logger.debug('Listing Stripe charges', { limit, customer: customer || '(all)' });

    try {
      const url = new URL(`${STRIPE_API}/v1/charges`);
      url.searchParams.set('limit', String(Math.min(Math.max(1, limit), 100)));
      if (customer) {
        url.searchParams.set('customer', customer);
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
          charges: data.data,
          count: data.data.length,
          hasMore: data.has_more,
        },
        metadata: { count: data.data.length, hasMore: data.has_more },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Stripe list charges failed: ${msg}` };
    }
  },
});
