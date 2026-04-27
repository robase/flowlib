/**
 * Resend provider barrel export.
 *
 * 4 actions covering core Resend API operations:
 * Send Email, Get Email, Send Batch, List Domains.
 */

// ── Sending ─────────────────────────────────────────────────────────────
export { resendSendEmailAction } from './send-email';
export { resendSendBatchAction } from './send-batch';

// ── Retrieval ───────────────────────────────────────────────────────────
export { resendGetEmailAction } from './get-email';

// ── Domains ─────────────────────────────────────────────────────────────
export { resendListDomainsAction } from './list-domains';

// ── Bulk array ──────────────────────────────────────────────────────────

import type { ActionDefinition } from '@flowlib/action-kit';

import { resendSendEmailAction } from './send-email';
import { resendSendBatchAction } from './send-batch';
import { resendGetEmailAction } from './get-email';
import { resendListDomainsAction } from './list-domains';

/** All Resend actions as an array (for bulk registration). */
export const resendActions: ActionDefinition[] = [
  resendSendEmailAction,
  resendSendBatchAction,
  resendGetEmailAction,
  resendListDomainsAction,
];
