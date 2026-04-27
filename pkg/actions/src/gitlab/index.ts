/**
 * GitLab provider barrel export.
 *
 * 5 actions covering core GitLab API operations:
 * Projects, Issues, and Merge Requests.
 */

// ── Projects ────────────────────────────────────────────────────────────
export { gitlabListProjectsAction } from './list-projects';

// ── Issues ──────────────────────────────────────────────────────────────
export { gitlabListIssuesAction } from './list-issues';
export { gitlabCreateIssueAction } from './create-issue';

// ── Merge Requests ──────────────────────────────────────────────────────
export { gitlabListMergeRequestsAction } from './list-merge-requests';
export { gitlabCreateMergeRequestAction } from './create-merge-request';

// ── Bulk array ──────────────────────────────────────────────────────────

import type { ActionDefinition } from '@flowlib/action-kit';

import { gitlabListProjectsAction } from './list-projects';
import { gitlabListIssuesAction } from './list-issues';
import { gitlabCreateIssueAction } from './create-issue';
import { gitlabListMergeRequestsAction } from './list-merge-requests';
import { gitlabCreateMergeRequestAction } from './create-merge-request';

/** All GitLab actions as an array (for bulk registration). */
export const gitlabActions: ActionDefinition[] = [
  gitlabListProjectsAction,
  gitlabListIssuesAction,
  gitlabCreateIssueAction,
  gitlabListMergeRequestsAction,
  gitlabCreateMergeRequestAction,
];
