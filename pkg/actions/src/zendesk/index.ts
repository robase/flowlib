/**
 * Zendesk provider barrel export.
 */

export { zendeskListTicketsAction } from './list-tickets';
export { zendeskGetTicketAction } from './get-ticket';
export { zendeskCreateTicketAction } from './create-ticket';
export { zendeskUpdateTicketAction } from './update-ticket';
export { zendeskSearchAction } from './search';

import type { ActionDefinition } from '@flowlib/action-kit';
import { zendeskListTicketsAction } from './list-tickets';
import { zendeskGetTicketAction } from './get-ticket';
import { zendeskCreateTicketAction } from './create-ticket';
import { zendeskUpdateTicketAction } from './update-ticket';
import { zendeskSearchAction } from './search';

/** All Zendesk actions as an array (for bulk registration). */
export const zendeskActions: ActionDefinition[] = [
  zendeskListTicketsAction,
  zendeskGetTicketAction,
  zendeskCreateTicketAction,
  zendeskUpdateTicketAction,
  zendeskSearchAction,
];
