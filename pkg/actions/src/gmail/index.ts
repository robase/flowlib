/**
 * Gmail provider barrel export.
 */

export { gmailListMessagesAction } from './list-messages';
export { gmailSendMessageAction } from './send-message';
export { gmailGetMessageAction } from './get-message';
export { gmailCreateDraftAction } from './create-draft';
export { gmailModifyLabelsAction } from './modify-labels';

import type { ActionDefinition } from '@flowlib/action-kit';
import { gmailListMessagesAction } from './list-messages';
import { gmailSendMessageAction } from './send-message';
import { gmailGetMessageAction } from './get-message';
import { gmailCreateDraftAction } from './create-draft';
import { gmailModifyLabelsAction } from './modify-labels';

// Lazy descriptors (edge-runtime bundle size — see ../LAZY_ACTIONS_MIGRATION.md)
export { lazyGmailActions } from './lazy';

/** All Gmail actions as an array (for bulk registration). */
export const gmailActions: ActionDefinition[] = [
  gmailListMessagesAction,
  gmailSendMessageAction,
  gmailGetMessageAction,
  gmailCreateDraftAction,
  gmailModifyLabelsAction,
];
