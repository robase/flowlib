/**
 * Microsoft 365 (Graph API) provider barrel export.
 */

export { microsoftListCalendarsAction } from './list-calendars';
export { microsoftListCalendarEventsAction } from './list-calendar-events';
export { microsoftGetCalendarEventAction } from './get-calendar-event';
export { microsoftListMessagesAction } from './list-messages';
export { microsoftGetMessageAction } from './get-message';
export { microsoftListOnlineMeetingsAction } from './list-online-meetings';
export { microsoftGetMeetingTranscriptAction } from './get-meeting-transcript';

import type { ActionDefinition } from '@flowlib/action-kit';
import { microsoftListCalendarsAction } from './list-calendars';
import { microsoftListCalendarEventsAction } from './list-calendar-events';
import { microsoftGetCalendarEventAction } from './get-calendar-event';
import { microsoftListMessagesAction } from './list-messages';
import { microsoftGetMessageAction } from './get-message';
import { microsoftListOnlineMeetingsAction } from './list-online-meetings';
import { microsoftGetMeetingTranscriptAction } from './get-meeting-transcript';

/** All Microsoft 365 actions as an array (for bulk registration). */
export const microsoftActions: ActionDefinition[] = [
  microsoftListCalendarsAction,
  microsoftListCalendarEventsAction,
  microsoftGetCalendarEventAction,
  microsoftListMessagesAction,
  microsoftGetMessageAction,
  microsoftListOnlineMeetingsAction,
  microsoftGetMeetingTranscriptAction,
];
