/**
 * Sentry provider barrel export.
 *
 * 4 actions covering the most-used Sentry API operations:
 * Projects and Issues (list, get, update).
 */

// ── Projects ────────────────────────────────────────────────────────────
export { sentryListProjectsAction } from './list-projects';

// ── Issues ──────────────────────────────────────────────────────────────
export { sentryListIssuesAction } from './list-issues';
export { sentryGetIssueAction } from './get-issue';
export { sentryUpdateIssueAction } from './update-issue';

// ── Bulk array ──────────────────────────────────────────────────────────

import type { ActionDefinition } from '@flowlib/action-kit';

import { sentryListProjectsAction } from './list-projects';
import { sentryListIssuesAction } from './list-issues';
import { sentryGetIssueAction } from './get-issue';
import { sentryUpdateIssueAction } from './update-issue';

/** All Sentry actions as an array (for bulk registration). */
export const sentryActions: ActionDefinition[] = [
  sentryListProjectsAction,
  sentryListIssuesAction,
  sentryGetIssueAction,
  sentryUpdateIssueAction,
];
