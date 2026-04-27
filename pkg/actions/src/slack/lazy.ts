/**
 * Lazy descriptors for Slack actions. See `core/lazy.ts` for rationale.
 */

import type { LazyActionDefinition } from '@flowlib/action-kit';

const slackProvider = { id: 'slack' };

export const lazySlackActions: LazyActionDefinition[] = [
  {
    id: 'slack.send_message',
    provider: slackProvider,
    load: async () => (await import('./send-message')).slackSendMessageAction,
  },
  {
    id: 'slack.list_channels',
    provider: slackProvider,
    load: async () => (await import('./list-channels')).slackListChannelsAction,
  },
];
