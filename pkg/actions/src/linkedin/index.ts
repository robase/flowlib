/**
 * LinkedIn provider barrel export.
 *
 * 3 actions covering core LinkedIn API operations:
 * Profile, Posts, and Company/Organization pages.
 */

// ── Profile ─────────────────────────────────────────────────────────────
export { linkedinGetProfileAction } from './get-profile';

// ── Posts ────────────────────────────────────────────────────────────────
export { linkedinCreatePostAction } from './create-post';

// ── Companies ───────────────────────────────────────────────────────────
export { linkedinGetCompanyAction } from './get-company';

// ── Bulk array ──────────────────────────────────────────────────────────

import type { ActionDefinition } from '@flowlib/action-kit';

import { linkedinGetProfileAction } from './get-profile';
import { linkedinCreatePostAction } from './create-post';
import { linkedinGetCompanyAction } from './get-company';

/** All LinkedIn actions as an array (for bulk registration). */
export const linkedinActions: ActionDefinition[] = [
  linkedinGetProfileAction,
  linkedinCreatePostAction,
  linkedinGetCompanyAction,
];
