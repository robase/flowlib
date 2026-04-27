/**
 * stripe.create_customer — Create a Stripe customer
 *
 * Creates a new customer in the Stripe account using form-urlencoded data.
 * Requires a Stripe credential with a secret key or access token.
 */

import { defineAction } from '@flowlib/action-kit';
import { STRIPE_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const STRIPE_API = 'https://api.stripe.com';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Stripe credential is required'),
  email: z.string().min(1, 'Customer email is required'),
  name: z.string().optional().default(''),
  description: z.string().optional().default(''),
  phone: z.string().optional().default(''),
});

export const stripeCreateCustomerAction = defineAction({
  id: 'stripe.create_customer',
  name: 'Create Customer',
  description:
    'Create a new customer in Stripe (POST /v1/customers). Use when you need to register a new customer for billing or subscriptions.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"id": "cus_NffrFeUfNV2Hib", "object": "customer", "email": "jenny@example.com", "name": "Jenny Rosen", "created": 1680893993}\n' +
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
        name: 'email',
        label: 'Email',
        type: 'text',
        required: true,
        placeholder: 'customer@example.com',
        description: 'Customer email address',
        aiProvided: true,
      },
      {
        name: 'name',
        label: 'Name',
        type: 'text',
        placeholder: 'Jane Doe',
        description: 'Customer full name',
        aiProvided: true,
      },
      {
        name: 'description',
        label: 'Description',
        type: 'text',
        placeholder: 'VIP customer',
        description: 'Internal description for this customer',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'phone',
        label: 'Phone',
        type: 'text',
        placeholder: '+15551234567',
        description: 'Customer phone number',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['stripe', 'customer', 'create', 'payments'],

  async execute(params, context) {
    const { credentialId, email, name, description, phone } = params;

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

    context.logger.debug('Creating Stripe customer', { email });

    try {
      const body = new URLSearchParams();
      body.append('email', email);
      if (name) {
        body.append('name', name);
      }
      if (description) {
        body.append('description', description);
      }
      if (phone) {
        body.append('phone', phone);
      }

      const response = await fetch(`${STRIPE_API}/v1/customers`, {
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

      const customer = (await response.json()) as Record<string, unknown>;

      return {
        success: true,
        output: { customer },
        metadata: { customerId: customer.id },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Stripe create customer failed: ${msg}` };
    }
  },
});
