/**
 * Trello provider barrel export.
 */

export { trelloListBoardsAction } from './list-boards';
export { trelloListListsAction } from './list-lists';
export { trelloListCardsAction } from './list-cards';
export { trelloCreateCardAction } from './create-card';
export { trelloUpdateCardAction } from './update-card';

import type { ActionDefinition } from '@flowlib/action-kit';
import { trelloListBoardsAction } from './list-boards';
import { trelloListListsAction } from './list-lists';
import { trelloListCardsAction } from './list-cards';
import { trelloCreateCardAction } from './create-card';
import { trelloUpdateCardAction } from './update-card';

/** All Trello actions as an array (for bulk registration). */
export const trelloActions: ActionDefinition[] = [
  trelloListBoardsAction,
  trelloListListsAction,
  trelloListCardsAction,
  trelloCreateCardAction,
  trelloUpdateCardAction,
];
