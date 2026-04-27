/**
 * CloudWatch Logs Insights provider barrel export.
 *
 * 2 actions for running Logs Insights queries:
 * start_query (submit a query) and get_query_results (poll for results).
 */

// ── Queries ─────────────────────────────────────────────────────────────
export { cloudwatchStartQueryAction } from './start-query';
export { cloudwatchGetQueryResultsAction } from './get-query-results';

// ── Bulk array ──────────────────────────────────────────────────────────

import type { ActionDefinition } from '@flowlib/action-kit';

import { cloudwatchStartQueryAction } from './start-query';
import { cloudwatchGetQueryResultsAction } from './get-query-results';

/** All CloudWatch actions as an array (for bulk registration). */
export const cloudwatchActions: ActionDefinition[] = [
  cloudwatchStartQueryAction,
  cloudwatchGetQueryResultsAction,
];
