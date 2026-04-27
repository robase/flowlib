/**
 * stripe.create_payment_intent — Create a Stripe PaymentIntent
 *
 * Creates a new PaymentIntent for collecting a payment.
 * Amount is specified in the smallest currency unit (e.g. cents for USD).
 * Uses form-urlencoded body as required by the Stripe API.
 * Requires a Stripe credential with a secret key or access token.
 */

import { defineAction } from '@flowlib/action-kit';
import { STRIPE_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const STRIPE_API = 'https://api.stripe.com';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Stripe credential is required'),
  amount: z.number().int().min(1, 'Amount must be at least 1 (smallest currency unit)'),
  currency: z.string().optional().default('usd'),
  customerId: z.string().optional().default(''),
  description: z.string().optional().default(''),
});

export const stripeCreatePaymentIntentAction = defineAction({
  id: 'stripe.create_payment_intent',
  name: 'Create Payment Intent',
  description:
    'Create a Stripe PaymentIntent to collect a payment (POST /v1/payment_intents). Use when you need to initiate a new payment or checkout session. Amount is in the smallest currency unit (e.g. 2000 = $20.00 USD).\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"id": "pi_abc123", "amount": 2000, "currency": "usd", "status": "requires_payment_method", "client_secret": "pi_abc123_secret_xyz"}\n' +
    '```',
  provider: STRIPE_PROVIDER,
  actionCategory: 'write',

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
        name: 'amount',
        label: 'Amount',
        type: 'number',
        required: true,
        placeholder: '2000',
        description: 'Amount in smallest currency unit (e.g. 2000 = $20.00 USD)',
        aiProvided: true,
      },
      {
        name: 'currency',
        label: 'Currency',
        type: 'text',
        defaultValue: 'usd',
        placeholder: 'usd',
        description: 'Three-letter ISO currency code (e.g. usd, eur, gbp)',
        aiProvided: true,
      },
      {
        name: 'customerId',
        label: 'Customer ID',
        type: 'text',
        placeholder: 'cus_abc123',
        description: 'Stripe customer ID to associate with this payment',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'description',
        label: 'Description',
        type: 'text',
        placeholder: 'Order #1234',
        description: 'Description of the payment',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['stripe', 'payment', 'intent', 'create', 'charge'],

  async execute(params, context) {
    const { credentialId, amount, currency, customerId, description } = params;

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

    context.logger.debug('Creating Stripe PaymentIntent', { amount, currency });

    try {
      const body = new URLSearchParams();
      body.append('amount', String(amount));
      body.append('currency', currency.toLowerCase());
      if (customerId) {
        body.append('customer', customerId);
      }
      if (description) {
        body.append('description', description);
      }

      const response = await fetch(`${STRIPE_API}/v1/payment_intents`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Stripe API error: ${response.status} ${response.statusText} - ${errorText}`,
        };
      }

      const paymentIntent = (await response.json()) as Record<string, unknown>;

      return {
        success: true,
        output: { paymentIntent },
        metadata: {
          paymentIntentId: paymentIntent.id,
          status: paymentIntent.status,
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Stripe create payment intent failed: ${msg}` };
    }
  },
});
