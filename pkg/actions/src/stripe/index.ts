/**
 * Stripe provider barrel export.
 *
 * 6 actions covering core Stripe API operations:
 * Customers, Charges, Payment Intents, Subscriptions, and Balance.
 */

// ── Customers ───────────────────────────────────────────────────────────
export { stripeListCustomersAction } from './list-customers';
export { stripeCreateCustomerAction } from './create-customer';

// ── Charges ─────────────────────────────────────────────────────────────
export { stripeListChargesAction } from './list-charges';

// ── Payment Intents ─────────────────────────────────────────────────────
export { stripeCreatePaymentIntentAction } from './create-payment-intent';

// ── Subscriptions ───────────────────────────────────────────────────────
export { stripeListSubscriptionsAction } from './list-subscriptions';

// ── Balance ─────────────────────────────────────────────────────────────
export { stripeGetBalanceAction } from './get-balance';

// ── Bulk array ──────────────────────────────────────────────────────────

import type { ActionDefinition } from '@flowlib/action-kit';

import { stripeListCustomersAction } from './list-customers';
import { stripeCreateCustomerAction } from './create-customer';
import { stripeListChargesAction } from './list-charges';
import { stripeCreatePaymentIntentAction } from './create-payment-intent';
import { stripeListSubscriptionsAction } from './list-subscriptions';
import { stripeGetBalanceAction } from './get-balance';

/** All Stripe actions as an array (for bulk registration). */
export const stripeActions: ActionDefinition[] = [
  stripeListCustomersAction,
  stripeCreateCustomerAction,
  stripeListChargesAction,
  stripeCreatePaymentIntentAction,
  stripeListSubscriptionsAction,
  stripeGetBalanceAction,
];
