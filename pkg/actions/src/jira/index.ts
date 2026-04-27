/**
 * Jira provider barrel export.
 */

export { jiraListProjectsAction } from './list-projects';
export { jiraSearchIssuesAction } from './search-issues';
export { jiraGetIssueAction } from './get-issue';
export { jiraCreateIssueAction } from './create-issue';
export { jiraUpdateIssueAction } from './update-issue';
export { jiraAddCommentAction } from './add-comment';

import type { ActionDefinition } from '@flowlib/action-kit';
import { jiraListProjectsAction } from './list-projects';
import { jiraSearchIssuesAction } from './search-issues';
import { jiraGetIssueAction } from './get-issue';
import { jiraCreateIssueAction } from './create-issue';
import { jiraUpdateIssueAction } from './update-issue';
import { jiraAddCommentAction } from './add-comment';

/** All Jira actions as an array (for bulk registration). */
export const jiraActions: ActionDefinition[] = [
  jiraListProjectsAction,
  jiraSearchIssuesAction,
  jiraGetIssueAction,
  jiraCreateIssueAction,
  jiraUpdateIssueAction,
  jiraAddCommentAction,
];
