/**
 * Segment provider barrel export.
 */

export { segmentTrackAction } from './track';
export { segmentIdentifyAction } from './identify';
export { segmentGroupAction } from './group';
export { segmentPageAction } from './page';

import type { ActionDefinition } from '@flowlib/action-kit';
import { segmentTrackAction } from './track';
import { segmentIdentifyAction } from './identify';
import { segmentGroupAction } from './group';
import { segmentPageAction } from './page';

/** All Segment actions as an array (for bulk registration). */
export const segmentActions: ActionDefinition[] = [
  segmentTrackAction,
  segmentIdentifyAction,
  segmentGroupAction,
  segmentPageAction,
];
