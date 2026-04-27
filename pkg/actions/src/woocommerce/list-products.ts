/**
 * woocommerce.list_products — List products from a WooCommerce store
 *
 * Retrieves products from the WooCommerce REST API.
 * Requires a WooCommerce API key credential (consumer key + consumer secret + site URL).
 */

import { defineAction } from '@flowlib/action-kit';
import { WOOCOMMERCE_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'WooCommerce credential is required'),
  perPage: z.number().int().min(1).max(100).optional().default(10),
  search: z.string().optional().default(''),
  category: z.string().optional().default(''),
  status: z.enum(['any', 'draft', 'pending', 'private', 'publish']).optional().default('any'),
});

export const woocommerceListProductsAction = defineAction({
  id: 'woocommerce.list_products',
  name: 'List Products',
  description:
    'List products from a WooCommerce store (GET /wp-json/wc/v3/products). Use when you need to browse the product catalog, check stock/pricing, or search for specific products. ' +
    'Call with optional `search` (keyword), `category` (category ID), and `status` (draft, pending, private, publish) filters; `perPage` controls page size (1–100).\n\n' +
    'Example response:\n' +
    '```json\n' +
    '[{"id": 794, "name": "Premium Quality T-Shirt", "type": "simple", "status": "publish", "regular_price": "21.99", "stock_status": "instock", "sku": "WOO-TSHIRT-001"}]\n' +
    '```',
  provider: WOOCOMMERCE_PROVIDER,
  actionCategory: 'read',
  tags: ['woocommerce', 'products', 'ecommerce', 'list'],

  credential: {
    required: true,
    type: 'api_key',
    description: 'WooCommerce API credential (consumer key + consumer secret + site URL)',
  },

  params: {
    schema: paramsSchema,
    fields: [
      {
        name: 'credentialId',
        label: 'WooCommerce Credential',
        type: 'text',
        required: true,
        description: 'WooCommerce API credential for authentication',
        aiProvided: false,
      },
      {
        name: 'perPage',
        label: 'Per Page',
        type: 'number',
        defaultValue: 10,
        description: 'Maximum number of products to return (1–100)',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'search',
        label: 'Search',
        type: 'text',
        description: 'Keyword to search products by name',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'category',
        label: 'Category ID',
        type: 'text',
        description: 'Filter by product category ID',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'status',
        label: 'Status',
        type: 'select',
        defaultValue: 'any',
        description: 'Filter by product status',
        extended: true,
        aiProvided: true,
        options: [
          { label: 'Any', value: 'any' },
          { label: 'Draft', value: 'draft' },
          { label: 'Pending', value: 'pending' },
          { label: 'Private', value: 'private' },
          { label: 'Published', value: 'publish' },
        ],
      },
    ],
  },

  async execute(params, context) {
    const { credentialId, perPage, search, category, status } = params;

    let credential = context.credential;
    if (!credential && context.functions?.getCredential) {
      credential = await context.functions.getCredential(credentialId);
    }
    if (!credential) {
      return { success: false, error: `Credential not found: ${credentialId}` };
    }

    const consumerKey = credential.config?.consumerKey as string;
    const consumerSecret = credential.config?.consumerSecret as string;
    const siteUrl = (credential.config?.siteUrl as string) ?? (credential.config?.url as string);

    if (!consumerKey || !consumerSecret) {
      return { success: false, error: 'WooCommerce consumer key and secret are required.' };
    }
    if (!siteUrl) {
      return { success: false, error: 'WooCommerce site URL is required in credential config.' };
    }

    const basicAuth = btoa(`${consumerKey}:${consumerSecret}`);

    context.logger.debug('Executing WooCommerce list products', {
      perPage,
      search,
      category,
      status,
    });

    try {
      const url = new URL(`${siteUrl}/wp-json/wc/v3/products`);
      url.searchParams.set('per_page', String(perPage));
      if (search) {
        url.searchParams.set('search', search);
      }
      if (category) {
        url.searchParams.set('category', category);
      }
      if (status && status !== 'any') {
        url.searchParams.set('status', status);
      }

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Basic ${basicAuth}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `WooCommerce API error: ${response.status} ${response.statusText} - ${errorText}`,
        };
      }

      const data = (await response.json()) as unknown[];

      return {
        success: true,
        output: data,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to list WooCommerce products: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
});
