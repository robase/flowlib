/**
 * shopify.list_orders — List orders from a Shopify store
 *
 * Retrieves orders from the Shopify Admin REST API with optional status filtering.
 * Requires a Shopify OAuth2 credential and the store subdomain.
 */

import { defineAction } from '@flowlib/action-kit';
import { SHOPIFY_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Shopify credential is required'),
  shop: z.string().min(1, 'Shop subdomain is required'),
  limit: z.number().int().min(1).max(250).optional().default(50),
  status: z.enum(['any', 'open', 'closed', 'cancelled']).optional().default('any'),
});

export const shopifyListOrdersAction = defineAction({
  id: 'shopify.list_orders',
  name: 'List Orders',
  description:
    'List orders from a Shopify store (GET /admin/api/.../orders.json). ' +
    'Call with `shop` and optional `limit` (1–250, default 50) and `status` (any/open/closed/cancelled, default any). ' +
    'Use when you need to review recent orders, check fulfillment status, or look up order history.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"orders": [{"id": 450789469, "name": "#1001", "total_price": "598.94", "financial_status": "paid", "fulfillment_status": null, "created_at": "2024-01-09T17:28:06-05:00"}], "count": 1}\n' +
    '```',
  provider: SHOPIFY_PROVIDER,
  actionCategory: 'read',
  tags: ['shopify', 'orders', 'ecommerce', 'list', 'oauth2'],

  credential: {
    required: true,
    type: 'oauth2',
    oauth2Provider: 'shopify',
    requiredScopes: ['read_orders'],
    description: 'Shopify OAuth2 credential with read_orders scope',
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
        description: 'Maximum number of orders to return (1–250)',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'status',
        label: 'Order Status',
        type: 'select',
        defaultValue: 'any',
        description: 'Filter orders by status',
        extended: true,
        aiProvided: true,
        options: [
          { label: 'Any', value: 'any' },
          { label: 'Open', value: 'open' },
          { label: 'Closed', value: 'closed' },
          { label: 'Cancelled', value: 'cancelled' },
        ],
      },
    ],
  },

  async execute(params, context) {
    const { credentialId, shop, limit, status } = params;

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

    context.logger.debug('Executing Shopify list orders', { shop, limit, status });

    try {
      const url = new URL(`${baseUrl}/orders.json`);
      url.searchParams.set('limit', String(limit));
      url.searchParams.set('status', status);

      const response = await fetch(url.toString(), {
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

      const data = (await response.json()) as { orders: unknown[] };

      return {
        success: true,
        output: {
          orders: data.orders,
          count: data.orders.length,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to list Shopify orders: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
});
