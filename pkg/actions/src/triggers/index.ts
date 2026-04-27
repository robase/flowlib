/**
 * Trigger actions barrel export.
 *
 * Import this module to register all trigger actions in the ActionRegistry.
 */

export { manualTriggerAction } from './manual';
export { cronTriggerAction } from './cron';

import type { ActionDefinition } from '@flowlib/action-kit';
import { manualTriggerAction } from './manual';
import { cronTriggerAction } from './cron';

/** All trigger actions as an array (for bulk registration). */
export const triggerActions: ActionDefinition[] = [manualTriggerAction, cronTriggerAction];
