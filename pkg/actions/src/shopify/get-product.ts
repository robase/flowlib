/**
 * shopify.get_product — Get a single product by ID from a Shopify store
 *
 * Retrieves a specific product's full details from the Shopify Admin REST API.
 * Requires a Shopify OAuth2 credential and the store subdomain.
 */

import { defineAction } from '@flowlib/action-kit';
import { SHOPIFY_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Shopify credential is required'),
  shop: z.string().min(1, 'Shop subdomain is required'),
  productId: z.string().min(1, 'Product ID is required'),
});

export const shopifyGetProductAction = defineAction({
  id: 'shopify.get_product',
  name: 'Get Product',
  description:
    'Get a single product by ID from a Shopify store (GET /admin/api/.../products/{id}.json). ' +
    'Call with `shop` (store subdomain) and `productId` (numeric product ID). ' +
    'Use when you need full details for a specific product including variants, images, and options.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"id": 632910392, "title": "IPod Nano", "body_html": "<p>Description</p>", "vendor": "Apple", "status": "active", "variants": [{"id": 808950810, "price": "199.00", "sku": "IPOD2008PINK"}]}\n' +
    '```',
  provider: SHOPIFY_PROVIDER,
  actionCategory: 'read',
  tags: ['shopify', 'product', 'ecommerce', 'get', 'oauth2'],

  credential: {
    required: true,
    type: 'oauth2',
    oauth2Provider: 'shopify',
    requiredScopes: ['read_products'],
    description: 'Shopify OAuth2 credential with read_products scope',
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
    const { credentialId, shop, productId } = params;

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

    context.logger.debug('Executing Shopify get product', { shop, productId });

    try {
      const response = await fetch(`${baseUrl}/products/${encodeURIComponent(productId)}.json`, {
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

      const data = (await response.json()) as { product: unknown };

      return {
        success: true,
        output: data.product,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to get Shopify product: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
});
