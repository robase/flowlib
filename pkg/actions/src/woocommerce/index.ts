/**
 * WooCommerce provider barrel export.
 */

export { woocommerceListProductsAction } from './list-products';
export { woocommerceGetProductAction } from './get-product';
export { woocommerceListOrdersAction } from './list-orders';
export { woocommerceListCustomersAction } from './list-customers';
export { woocommerceCreateProductAction } from './create-product';

import type { ActionDefinition } from '@flowlib/action-kit';
import { woocommerceListProductsAction } from './list-products';
import { woocommerceGetProductAction } from './get-product';
import { woocommerceListOrdersAction } from './list-orders';
import { woocommerceListCustomersAction } from './list-customers';
import { woocommerceCreateProductAction } from './create-product';

/** All WooCommerce actions as an array (for bulk registration). */
export const woocommerceActions: ActionDefinition[] = [
  woocommerceListProductsAction,
  woocommerceGetProductAction,
  woocommerceListOrdersAction,
  woocommerceListCustomersAction,
  woocommerceCreateProductAction,
];
