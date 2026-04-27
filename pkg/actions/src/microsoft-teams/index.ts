/**
 * Microsoft Teams provider barrel export.
 */

export { teamsSendMessageAction } from './send-message';
export { teamsListTeamsAction } from './list-teams';
export { teamsListChannelsAction } from './list-channels';
export { teamsListChannelMessagesAction } from './list-channel-messages';

import type { ActionDefinition } from '@flowlib/action-kit';
import { teamsSendMessageAction } from './send-message';
import { teamsListTeamsAction } from './list-teams';
import { teamsListChannelsAction } from './list-channels';
import { teamsListChannelMessagesAction } from './list-channel-messages';

/** All Microsoft Teams actions as an array (for bulk registration). */
export const microsoftTeamsActions: ActionDefinition[] = [
  teamsSendMessageAction,
  teamsListTeamsAction,
  teamsListChannelsAction,
  teamsListChannelMessagesAction,
];
