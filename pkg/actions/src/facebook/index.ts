/**
 * Facebook provider barrel export.
 */

export { facebookGetMeAction } from './get-me';
export { facebookListPagesAction } from './list-pages';
export { facebookCreatePagePostAction } from './create-page-post';
export { facebookGetPagePostsAction } from './get-page-posts';

import type { ActionDefinition } from '@flowlib/action-kit';
import { facebookGetMeAction } from './get-me';
import { facebookListPagesAction } from './list-pages';
import { facebookCreatePagePostAction } from './create-page-post';
import { facebookGetPagePostsAction } from './get-page-posts';

/** All Facebook actions as an array (for bulk registration). */
export const facebookActions: ActionDefinition[] = [
  facebookGetMeAction,
  facebookListPagesAction,
  facebookCreatePagePostAction,
  facebookGetPagePostsAction,
];
