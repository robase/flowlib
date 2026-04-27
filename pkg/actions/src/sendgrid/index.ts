/**
 * SendGrid provider barrel export.
 *
 * 4 actions covering core SendGrid v3 API operations:
 * Send Email, Get Email Activity, List Verified Senders, Get Stats.
 */

// ── Sending ─────────────────────────────────────────────────────────────
export { sendgridSendEmailAction } from './send-email';

// ── Activity & Tracking ─────────────────────────────────────────────────
export { sendgridGetEmailActivityAction } from './get-email-activity';

// ── Configuration ───────────────────────────────────────────────────────
export { sendgridListVerifiedSendersAction } from './list-verified-senders';

// ── Analytics ───────────────────────────────────────────────────────────
export { sendgridGetStatsAction } from './get-stats';

// ── Bulk array ──────────────────────────────────────────────────────────

import type { ActionDefinition } from '@flowlib/action-kit';

import { sendgridSendEmailAction } from './send-email';
import { sendgridGetEmailActivityAction } from './get-email-activity';
import { sendgridListVerifiedSendersAction } from './list-verified-senders';
import { sendgridGetStatsAction } from './get-stats';

/** All SendGrid actions as an array (for bulk registration). */
export const sendgridActions: ActionDefinition[] = [
  sendgridSendEmailAction,
  sendgridGetEmailActivityAction,
  sendgridListVerifiedSendersAction,
  sendgridGetStatsAction,
];
