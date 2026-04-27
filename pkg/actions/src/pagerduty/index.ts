/**
 * PagerDuty provider barrel export.
 *
 * 4 actions covering the most-used PagerDuty API operations:
 * Incidents (list, create, manage) and Services (list).
 */

// ── Incidents ───────────────────────────────────────────────────────────
export { pagerdutyListIncidentsAction } from './list-incidents';
export { pagerdutyCreateIncidentAction } from './create-incident';
export { pagerdutyManageIncidentAction } from './manage-incident';

// ── Services ────────────────────────────────────────────────────────────
export { pagerdutyListServicesAction } from './list-services';

// ── Bulk array ──────────────────────────────────────────────────────────

import type { ActionDefinition } from '@flowlib/action-kit';

import { pagerdutyListIncidentsAction } from './list-incidents';
import { pagerdutyCreateIncidentAction } from './create-incident';
import { pagerdutyManageIncidentAction } from './manage-incident';
import { pagerdutyListServicesAction } from './list-services';

/** All PagerDuty actions as an array (for bulk registration). */
export const pagerdutyActions: ActionDefinition[] = [
  pagerdutyListIncidentsAction,
  pagerdutyCreateIncidentAction,
  pagerdutyManageIncidentAction,
  pagerdutyListServicesAction,
];
