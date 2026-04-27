/**
 * stripe.get_balance — Get Stripe account balance
 *
 * Retrieves the current balance of the Stripe account, including
 * available and pending amounts per currency.
 * Requires a Stripe credential with a secret key or access token.
 */

import { defineAction } from '@flowlib/action-kit';
import { STRIPE_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const STRIPE_API = 'https://api.stripe.com';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Stripe credential is required'),
});

export const stripeGetBalanceAction = defineAction({
  id: 'stripe.get_balance',
  name: 'Get Balance',
  description:
    'Retrieve the current account balance from Stripe (GET /v1/balance). Use when you need to check available funds or pending amounts across currencies.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"available": [{"amount": 666670, "currency": "usd"}], "pending": [{"amount": 61414, "currency": "usd"}]}\n' +
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
    ],
  },

  tags: ['stripe', 'balance', 'account', 'payments'],

  async execute(params, context) {
    const { credentialId } = params;

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

    context.logger.debug('Fetching Stripe account balance');

    try {
      const response = await fetch(`${STRIPE_API}/v1/balance`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Stripe API error: ${response.status} ${response.statusText} - ${errorText}`,
        };
      }

      const balance = (await response.json()) as Record<string, unknown>;

      return {
        success: true,
        output: { balance },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Stripe get balance failed: ${msg}` };
    }
  },
});
