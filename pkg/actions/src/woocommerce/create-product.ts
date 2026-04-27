/**
 * woocommerce.create_product — Create a new product in a WooCommerce store
 *
 * Creates a product via the WooCommerce REST API.
 * Requires a WooCommerce API key credential (consumer key + consumer secret + site URL).
 */

import { defineAction } from '@flowlib/action-kit';
import { WOOCOMMERCE_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'WooCommerce credential is required'),
  name: z.string().min(1, 'Product name is required'),
  regularPrice: z.string().min(1, 'Regular price is required'),
  type: z.enum(['simple', 'grouped', 'external', 'variable']).optional().default('simple'),
  status: z.enum(['draft', 'pending', 'private', 'publish']).optional().default('publish'),
  description: z.string().optional().default(''),
  shortDescription: z.string().optional().default(''),
  sku: z.string().optional().default(''),
  salePrice: z.string().optional().default(''),
  stockQuantity: z.number().int().optional(),
});

export const woocommerceCreateProductAction = defineAction({
  id: 'woocommerce.create_product',
  name: 'Create Product',
  description:
    'Create a new product in a WooCommerce store (POST /wp-json/wc/v3/products). Use when you need to add a new product to the catalog. ' +
    'Call with `name` and `regularPrice` (required); optional `type`, `status`, `sku`, `salePrice`, `stockQuantity`, `description`, and `shortDescription`.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"id": 794, "name": "Premium Quality T-Shirt", "type": "simple", "status": "publish", "sku": "WOO-TSHIRT-001", "regular_price": "21.99", "permalink": "https://example.com/product/premium-quality-t-shirt"}\n' +
    '```',
  provider: WOOCOMMERCE_PROVIDER,
  actionCategory: 'write',
  tags: ['woocommerce', 'product', 'ecommerce', 'create', 'write'],

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
        name: 'name',
        label: 'Product Name',
        type: 'text',
        required: true,
        description: 'The product name',
        aiProvided: true,
      },
      {
        name: 'regularPrice',
        label: 'Regular Price',
        type: 'text',
        required: true,
        placeholder: '29.99',
        description: 'Product regular price as a string (e.g. "29.99")',
        aiProvided: true,
      },
      {
        name: 'type',
        label: 'Product Type',
        type: 'select',
        defaultValue: 'simple',
        description: 'The type of product',
        extended: true,
        aiProvided: true,
        options: [
          { label: 'Simple', value: 'simple' },
          { label: 'Grouped', value: 'grouped' },
          { label: 'External', value: 'external' },
          { label: 'Variable', value: 'variable' },
        ],
      },
      {
        name: 'description',
        label: 'Description',
        type: 'textarea',
        description: 'Full product description (HTML supported)',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'shortDescription',
        label: 'Short Description',
        type: 'textarea',
        description: 'Brief product summary (HTML supported)',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'status',
        label: 'Status',
        type: 'select',
        defaultValue: 'publish',
        description: 'Product publication status',
        extended: true,
        aiProvided: true,
        options: [
          { label: 'Published', value: 'publish' },
          { label: 'Draft', value: 'draft' },
          { label: 'Pending Review', value: 'pending' },
          { label: 'Private', value: 'private' },
        ],
      },
      {
        name: 'sku',
        label: 'SKU',
        type: 'text',
        description: 'Stock keeping unit (unique product identifier)',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'salePrice',
        label: 'Sale Price',
        type: 'text',
        placeholder: '19.99',
        description: 'Product sale price as a string (e.g. "19.99")',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'stockQuantity',
        label: 'Stock Quantity',
        type: 'number',
        description: 'Number of items in stock (enables stock management)',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  async execute(params, context) {
    const {
      credentialId,
      name,
      regularPrice,
      type,
      status,
      description,
      shortDescription,
      sku,
      salePrice,
      stockQuantity,
    } = params;

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

    context.logger.debug('Executing WooCommerce create product', { name, type });

    const product: Record<string, unknown> = {
      name,
      type,
      status,
      regular_price: regularPrice,
    };
    if (description) {
      product.description = description;
    }
    if (shortDescription) {
      product.short_description = shortDescription;
    }
    if (sku) {
      product.sku = sku;
    }
    if (salePrice) {
      product.sale_price = salePrice;
    }
    if (stockQuantity !== undefined) {
      product.manage_stock = true;
      product.stock_quantity = stockQuantity;
    }

    try {
      const response = await fetch(`${siteUrl}/wp-json/wc/v3/products`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basicAuth}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(product),
      });

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
        error: `Failed to create WooCommerce product: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
});
