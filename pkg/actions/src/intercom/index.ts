/**
 * Intercom provider barrel export.
 */

export { intercomListContactsAction } from './list-contacts';
export { intercomGetContactAction } from './get-contact';
export { intercomCreateContactAction } from './create-contact';
export { intercomListConversationsAction } from './list-conversations';
export { intercomReplyToConversationAction } from './reply-to-conversation';

import type { ActionDefinition } from '@flowlib/action-kit';
import { intercomListContactsAction } from './list-contacts';
import { intercomGetContactAction } from './get-contact';
import { intercomCreateContactAction } from './create-contact';
import { intercomListConversationsAction } from './list-conversations';
import { intercomReplyToConversationAction } from './reply-to-conversation';

/** All Intercom actions as an array (for bulk registration). */
export const intercomActions: ActionDefinition[] = [
  intercomListContactsAction,
  intercomGetContactAction,
  intercomCreateContactAction,
  intercomListConversationsAction,
  intercomReplyToConversationAction,
];
