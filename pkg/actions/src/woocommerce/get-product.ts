/**
 * woocommerce.get_product — Get a single product by ID from a WooCommerce store
 *
 * Retrieves a specific product's full details from the WooCommerce REST API.
 * Requires a WooCommerce API key credential (consumer key + consumer secret + site URL).
 */

import { defineAction } from '@flowlib/action-kit';
import { WOOCOMMERCE_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'WooCommerce credential is required'),
  productId: z.string().min(1, 'Product ID is required'),
});

export const woocommerceGetProductAction = defineAction({
  id: 'woocommerce.get_product',
  name: 'Get Product',
  description:
    'Get a single product by ID from a WooCommerce store (GET /wp-json/wc/v3/products/{id}). Use when you need full details for a specific product including pricing, stock, categories, and attributes. ' +
    'Call with `productId` (numeric product ID).\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"id": 794, "name": "Premium Quality T-Shirt", "type": "simple", "status": "publish", "sku": "WOO-TSHIRT-001", "regular_price": "21.99", "sale_price": "", "stock_quantity": 15, "stock_status": "instock", "categories": [{"id": 9, "name": "Clothing"}]}\n' +
    '```',
  provider: WOOCOMMERCE_PROVIDER,
  actionCategory: 'read',
  tags: ['woocommerce', 'product', 'ecommerce', 'get'],

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
        name: 'productId',
        label: 'Product ID',
        type: 'text',
        required: true,
        description: 'The numeric ID of the product to retrieve',
        aiProvided: true,
      },
    ],
  },

  async execute(params, context) {
    const { credentialId, productId } = params;

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

    context.logger.debug('Executing WooCommerce get product', { productId });

    try {
      const response = await fetch(
        `${siteUrl}/wp-json/wc/v3/products/${encodeURIComponent(productId)}`,
        {
          headers: {
            Authorization: `Basic ${basicAuth}`,
            'Content-Type': 'application/json',
          },
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `WooCommerce API error: ${response.status} ${response.statusText} - ${errorText}`,
        };
      }

      const data = (await response.json()) as Record<string, unknown>;

      return {
        success: true,
        output: data,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to get WooCommerce product: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
});
