/**
 * Freshdesk provider barrel export.
 */

export { freshdeskListTicketsAction } from './list-tickets';
export { freshdeskGetTicketAction } from './get-ticket';
export { freshdeskCreateTicketAction } from './create-ticket';
export { freshdeskUpdateTicketAction } from './update-ticket';
export { freshdeskListContactsAction } from './list-contacts';

import type { ActionDefinition } from '@flowlib/action-kit';
import { freshdeskListTicketsAction } from './list-tickets';
import { freshdeskGetTicketAction } from './get-ticket';
import { freshdeskCreateTicketAction } from './create-ticket';
import { freshdeskUpdateTicketAction } from './update-ticket';
import { freshdeskListContactsAction } from './list-contacts';

/** All Freshdesk actions as an array (for bulk registration). */
export const freshdeskActions: ActionDefinition[] = [
  freshdeskListTicketsAction,
  freshdeskGetTicketAction,
  freshdeskCreateTicketAction,
  freshdeskUpdateTicketAction,
  freshdeskListContactsAction,
];
