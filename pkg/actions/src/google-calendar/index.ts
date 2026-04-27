/**
 * Google Calendar provider barrel export.
 */

export { googleCalendarListEventsAction } from './list-events';
export { googleCalendarCreateEventAction } from './create-event';
export { googleCalendarUpdateEventAction } from './update-event';
export { googleCalendarDeleteEventAction } from './delete-event';
export { googleCalendarGetEventAction } from './get-event';
export { googleCalendarQueryFreebusyAction } from './query-freebusy';

import type { ActionDefinition } from '@flowlib/action-kit';
import { googleCalendarListEventsAction } from './list-events';
import { googleCalendarCreateEventAction } from './create-event';
import { googleCalendarUpdateEventAction } from './update-event';
import { googleCalendarDeleteEventAction } from './delete-event';
import { googleCalendarGetEventAction } from './get-event';
import { googleCalendarQueryFreebusyAction } from './query-freebusy';

/** All Google Calendar actions as an array (for bulk registration). */
export const googleCalendarActions: ActionDefinition[] = [
  googleCalendarListEventsAction,
  googleCalendarCreateEventAction,
  googleCalendarUpdateEventAction,
  googleCalendarDeleteEventAction,
  googleCalendarGetEventAction,
  googleCalendarQueryFreebusyAction,
];
