/**
 * Shopify provider barrel export.
 */

export { shopifyListProductsAction } from './list-products';
export { shopifyGetProductAction } from './get-product';
export { shopifyListOrdersAction } from './list-orders';
export { shopifyListCustomersAction } from './list-customers';
export { shopifyCreateProductAction } from './create-product';

import type { ActionDefinition } from '@flowlib/action-kit';
import { shopifyListProductsAction } from './list-products';
import { shopifyGetProductAction } from './get-product';
import { shopifyListOrdersAction } from './list-orders';
import { shopifyListCustomersAction } from './list-customers';
import { shopifyCreateProductAction } from './create-product';

/** All Shopify actions as an array (for bulk registration). */
export const shopifyActions: ActionDefinition[] = [
  shopifyListProductsAction,
  shopifyGetProductAction,
  shopifyListOrdersAction,
  shopifyListCustomersAction,
  shopifyCreateProductAction,
];
