/**
 * Mixpanel provider barrel export.
 */

export { mixpanelTrackEventAction } from './track-event';
export { mixpanelCreateProfileAction } from './create-profile';
export { mixpanelExportEventsAction } from './export-events';

import type { ActionDefinition } from '@flowlib/action-kit';
import { mixpanelTrackEventAction } from './track-event';
import { mixpanelCreateProfileAction } from './create-profile';
import { mixpanelExportEventsAction } from './export-events';

/** All Mixpanel actions as an array (for bulk registration). */
export const mixpanelActions: ActionDefinition[] = [
  mixpanelTrackEventAction,
  mixpanelCreateProfileAction,
  mixpanelExportEventsAction,
];
