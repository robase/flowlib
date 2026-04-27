/**
 * Slack provider barrel export.
 */

export { slackSendMessageAction } from './send-message';
export { slackListChannelsAction } from './list-channels';

import type { ActionDefinition } from '@flowlib/action-kit';
import { slackSendMessageAction } from './send-message';
import { slackListChannelsAction } from './list-channels';

// Lazy descriptors (edge-runtime bundle size — see ../LAZY_ACTIONS_MIGRATION.md)
export { lazySlackActions } from './lazy';

/** All Slack actions as an array (for bulk registration). */
export const slackActions: ActionDefinition[] = [slackSendMessageAction, slackListChannelsAction];
