/**
 * Grafana provider barrel export.
 *
 * 5 actions covering the most-used Grafana HTTP API operations:
 * Dashboards (list, get), Datasources (list), Alert Rules (list),
 * and Annotations (create).
 */

// ── Dashboards ──────────────────────────────────────────────────────────
export { grafanaListDashboardsAction } from './list-dashboards';
export { grafanaGetDashboardAction } from './get-dashboard';

// ── Datasources ─────────────────────────────────────────────────────────
export { grafanaListDatasourcesAction } from './list-datasources';

// ── Alert Rules ─────────────────────────────────────────────────────────
export { grafanaListAlertRulesAction } from './list-alert-rules';

// ── Annotations ─────────────────────────────────────────────────────────
export { grafanaCreateAnnotationAction } from './create-annotation';

// ── Bulk array ──────────────────────────────────────────────────────────

import type { ActionDefinition } from '@flowlib/action-kit';

import { grafanaListDashboardsAction } from './list-dashboards';
import { grafanaGetDashboardAction } from './get-dashboard';
import { grafanaListDatasourcesAction } from './list-datasources';
import { grafanaListAlertRulesAction } from './list-alert-rules';
import { grafanaCreateAnnotationAction } from './create-annotation';

/** All Grafana actions as an array (for bulk registration). */
export const grafanaActions: ActionDefinition[] = [
  grafanaListDashboardsAction,
  grafanaGetDashboardAction,
  grafanaListDatasourcesAction,
  grafanaListAlertRulesAction,
  grafanaCreateAnnotationAction,
];
