/**
 * shopify.list_customers — List customers from a Shopify store
 *
 * Retrieves customers from the Shopify Admin REST API.
 * Requires a Shopify OAuth2 credential and the store subdomain.
 */

import { defineAction } from '@flowlib/action-kit';
import { SHOPIFY_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Shopify credential is required'),
  shop: z.string().min(1, 'Shop subdomain is required'),
  limit: z.number().int().min(1).max(250).optional().default(50),
});

export const shopifyListCustomersAction = defineAction({
  id: 'shopify.list_customers',
  name: 'List Customers',
  description:
    'List customers from a Shopify store (GET /admin/api/.../customers.json). ' +
    'Call with `shop` and optional `limit` (1–250, default 50). ' +
    'Use when you need to look up customer accounts, contact details, or order history.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"customers": [{"id": 207119551, "first_name": "Bob", "last_name": "Norman", "email": "bob@example.com", "orders_count": 1, "total_spent": "199.65"}], "count": 1}\n' +
    '```',
  provider: SHOPIFY_PROVIDER,
  actionCategory: 'read',
  tags: ['shopify', 'customers', 'ecommerce', 'list', 'oauth2'],

  credential: {
    required: true,
    type: 'oauth2',
    oauth2Provider: 'shopify',
    requiredScopes: ['read_customers'],
    description: 'Shopify OAuth2 credential with read_customers scope',
  },

  params: {
    schema: paramsSchema,
    fields: [
      {
        name: 'credentialId',
        label: 'Shopify Credential',
        type: 'text',
        required: true,
        description: 'Shopify OAuth2 credential for authentication',
        aiProvided: false,
      },
      {
        name: 'shop',
        label: 'Shop Subdomain',
        type: 'text',
        required: true,
        placeholder: 'mystore',
        description: 'Shopify store subdomain (e.g. "mystore" for mystore.myshopify.com)',
        aiProvided: false,
      },
      {
        name: 'limit',
        label: 'Limit',
        type: 'number',
        defaultValue: 50,
        description: 'Maximum number of customers to return (1–250)',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  async execute(params, context) {
    const { credentialId, shop, limit } = params;

    let credential = context.credential;
    if (!credential && context.functions?.getCredential) {
      credential = await context.functions.getCredential(credentialId);
    }
    if (!credential) {
      return { success: false, error: `Credential not found: ${credentialId}` };
    }

    const accessToken =
      (credential.config?.accessToken as string) ?? (credential.config?.token as string);
    if (!accessToken) {
      return { success: false, error: 'No valid access token.' };
    }

    const baseUrl = `https://${encodeURIComponent(shop)}.myshopify.com/admin/api/2025-01`;

    context.logger.debug('Executing Shopify list customers', { shop, limit });

    try {
      const response = await fetch(`${baseUrl}/customers.json?limit=${limit}`, {
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Shopify API error: ${response.status} ${response.statusText} - ${errorText}`,
        };
      }

      const data = (await response.json()) as { customers: unknown[] };

      return {
        success: true,
        output: {
          customers: data.customers,
          count: data.customers.length,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to list Shopify customers: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
});
