/**
 * shopify.create_product — Create a new product in a Shopify store
 *
 * Creates a product via the Shopify Admin REST API.
 * Requires a Shopify OAuth2 credential and the store subdomain.
 */

import { defineAction } from '@flowlib/action-kit';
import { SHOPIFY_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Shopify credential is required'),
  shop: z.string().min(1, 'Shop subdomain is required'),
  title: z.string().min(1, 'Product title is required'),
  bodyHtml: z.string().optional().default(''),
  vendor: z.string().optional().default(''),
  productType: z.string().optional().default(''),
  tags: z.string().optional().default(''),
});

export const shopifyCreateProductAction = defineAction({
  id: 'shopify.create_product',
  name: 'Create Product',
  description:
    'Create a new product in a Shopify store (POST /admin/api/.../products.json). ' +
    'Call with `shop`, `title` (required), and optional `bodyHtml`, `vendor`, `productType`, `tags`. ' +
    'Products are created with status "draft" by default. Use when you need to add a new product to the catalog.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"id": 1072481062, "title": "Burton Custom Freestyle 151", "vendor": "Burton", "product_type": "Snowboard", "status": "draft", "variants": [{"id": 1070325053, "price": "0.00"}]}\n' +
    '```',
  provider: SHOPIFY_PROVIDER,
  actionCategory: 'write',
  tags: ['shopify', 'product', 'ecommerce', 'create', 'write', 'oauth2'],

  credential: {
    required: true,
    type: 'oauth2',
    oauth2Provider: 'shopify',
    requiredScopes: ['write_products'],
    description: 'Shopify OAuth2 credential with write_products scope',
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
        name: 'title',
        label: 'Title',
        type: 'text',
        required: true,
        description: 'The product title',
        aiProvided: true,
      },
      {
        name: 'bodyHtml',
        label: 'Description (HTML)',
        type: 'textarea',
        description: 'Product description in HTML format',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'vendor',
        label: 'Vendor',
        type: 'text',
        description: 'Product vendor / brand name',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'productType',
        label: 'Product Type',
        type: 'text',
        description: 'Product type (e.g. "Shoes", "T-Shirts")',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'tags',
        label: 'Tags',
        type: 'text',
        description: 'Comma-separated list of tags',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  async execute(params, context) {
    const { credentialId, shop, title, bodyHtml, vendor, productType, tags } = params;

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

    context.logger.debug('Executing Shopify create product', { shop, title });

    const product: Record<string, string> = { title };
    if (bodyHtml) {
      product.body_html = bodyHtml;
    }
    if (vendor) {
      product.vendor = vendor;
    }
    if (productType) {
      product.product_type = productType;
    }
    if (tags) {
      product.tags = tags;
    }

    try {
      const response = await fetch(`${baseUrl}/products.json`, {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ product }),
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
        error: `Failed to create Shopify product: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
});
