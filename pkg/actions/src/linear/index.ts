/**
 * Linear provider barrel export.
 */

export { linearListIssuesAction } from './list-issues';
export { linearCreateIssueAction } from './create-issue';
export { linearUpdateIssueAction } from './update-issue';
export { linearListTeamsAction } from './list-teams';

import type { ActionDefinition } from '@flowlib/action-kit';
import { linearListIssuesAction } from './list-issues';
import { linearCreateIssueAction } from './create-issue';
import { linearUpdateIssueAction } from './update-issue';
import { linearListTeamsAction } from './list-teams';

/** All Linear actions as an array (for bulk registration). */
export const linearActions: ActionDefinition[] = [
  linearListIssuesAction,
  linearCreateIssueAction,
  linearUpdateIssueAction,
  linearListTeamsAction,
];
