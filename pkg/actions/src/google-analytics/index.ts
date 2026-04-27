/**
 * Google Analytics provider barrel export.
 */

export { googleAnalyticsRunReportAction } from './run-report';
export { googleAnalyticsRunRealtimeReportAction } from './run-realtime-report';
export { googleAnalyticsListPropertiesAction } from './list-properties';

import type { ActionDefinition } from '@flowlib/action-kit';
import { googleAnalyticsRunReportAction } from './run-report';
import { googleAnalyticsRunRealtimeReportAction } from './run-realtime-report';
import { googleAnalyticsListPropertiesAction } from './list-properties';

/** All Google Analytics actions as an array (for bulk registration). */
export const googleAnalyticsActions: ActionDefinition[] = [
  googleAnalyticsRunReportAction,
  googleAnalyticsRunRealtimeReportAction,
  googleAnalyticsListPropertiesAction,
];
