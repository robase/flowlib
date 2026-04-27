/**
 * Lazy descriptors for Gmail actions.
 *
 * Each `load()` thunk lazily imports the corresponding action module so the
 * Gmail SDK / API helpers are not pulled into edge-runtime bundles unless
 * the action is actually used.
 */

import type { LazyActionDefinition } from '@flowlib/action-kit';

const gmailProvider = { id: 'gmail' };

export const lazyGmailActions: LazyActionDefinition[] = [
  {
    id: 'gmail.list_messages',
    provider: gmailProvider,
    load: async () => (await import('./list-messages')).gmailListMessagesAction,
  },
  {
    id: 'gmail.send_message',
    provider: gmailProvider,
    load: async () => (await import('./send-message')).gmailSendMessageAction,
  },
  {
    id: 'gmail.get_message',
    provider: gmailProvider,
    load: async () => (await import('./get-message')).gmailGetMessageAction,
  },
  {
    id: 'gmail.create_draft',
    provider: gmailProvider,
    load: async () => (await import('./create-draft')).gmailCreateDraftAction,
  },
  {
    id: 'gmail.modify_labels',
    provider: gmailProvider,
    load: async () => (await import('./modify-labels')).gmailModifyLabelsAction,
  },
];
