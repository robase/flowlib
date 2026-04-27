/**
 * Twitter / X provider barrel export.
 */

export { twitterCreateTweetAction } from './create-tweet';
export { twitterGetUserAction } from './get-user';
export { twitterGetUserTweetsAction } from './get-user-tweets';
export { twitterSearchTweetsAction } from './search-tweets';
export { twitterGetMeAction } from './get-me';

import type { ActionDefinition } from '@flowlib/action-kit';
import { twitterCreateTweetAction } from './create-tweet';
import { twitterGetUserAction } from './get-user';
import { twitterGetUserTweetsAction } from './get-user-tweets';
import { twitterSearchTweetsAction } from './search-tweets';
import { twitterGetMeAction } from './get-me';

/** All Twitter actions as an array (for bulk registration). */
export const twitterActions: ActionDefinition[] = [
  twitterCreateTweetAction,
  twitterGetUserAction,
  twitterGetUserTweetsAction,
  twitterSearchTweetsAction,
  twitterGetMeAction,
];
