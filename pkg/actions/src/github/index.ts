/**
 * GitHub provider barrel export.
 *
 * 20 actions covering the most-used GitHub API operations:
 * Repos, Issues, Pull Requests, Branches, Commits, Releases, Files, and Search.
 */

// ── Repositories ────────────────────────────────────────────────────────
export { githubListReposAction } from './list-repos';
export { githubGetRepoAction } from './get-repo';

// ── Issues ──────────────────────────────────────────────────────────────
export { githubCreateIssueAction } from './create-issue';
export { githubGetIssueAction } from './get-issue';
export { githubListIssuesAction } from './list-issues';
export { githubUpdateIssueAction } from './update-issue';
export { githubAddIssueCommentAction } from './add-issue-comment';
export { githubListIssueCommentsAction } from './list-issue-comments';

// ── Pull Requests ───────────────────────────────────────────────────────
export { githubCreatePullRequestAction } from './create-pull-request';
export { githubListPullRequestsAction } from './list-pull-requests';
export { githubGetPullRequestAction } from './get-pull-request';
export { githubMergePullRequestAction } from './merge-pull-request';

// ── Branches ────────────────────────────────────────────────────────────
export { githubListBranchesAction } from './list-branches';
export { githubCreateBranchAction } from './create-branch';

// ── Files / Content ─────────────────────────────────────────────────────
export { githubGetFileContentAction } from './get-file-content';
export { githubCreateOrUpdateFileAction } from './create-or-update-file';

// ── Commits ─────────────────────────────────────────────────────────────
export { githubListCommitsAction } from './list-commits';

// ── Releases ────────────────────────────────────────────────────────────
export { githubCreateReleaseAction } from './create-release';
export { githubListReleasesAction } from './list-releases';

// ── Search ──────────────────────────────────────────────────────────────
export { githubSearchIssuesAction } from './search-issues';

// ── Lazy descriptors ────────────────────────────────────────────────────
// Edge-runtime bundle size — see ../LAZY_ACTIONS_MIGRATION.md
export { lazyGithubActions } from './lazy';

// ── Bulk array ──────────────────────────────────────────────────────────

import type { ActionDefinition } from '@flowlib/action-kit';

import { githubListReposAction } from './list-repos';
import { githubGetRepoAction } from './get-repo';
import { githubCreateIssueAction } from './create-issue';
import { githubGetIssueAction } from './get-issue';
import { githubListIssuesAction } from './list-issues';
import { githubUpdateIssueAction } from './update-issue';
import { githubAddIssueCommentAction } from './add-issue-comment';
import { githubListIssueCommentsAction } from './list-issue-comments';
import { githubCreatePullRequestAction } from './create-pull-request';
import { githubListPullRequestsAction } from './list-pull-requests';
import { githubGetPullRequestAction } from './get-pull-request';
import { githubMergePullRequestAction } from './merge-pull-request';
import { githubListBranchesAction } from './list-branches';
import { githubCreateBranchAction } from './create-branch';
import { githubGetFileContentAction } from './get-file-content';
import { githubCreateOrUpdateFileAction } from './create-or-update-file';
import { githubListCommitsAction } from './list-commits';
import { githubCreateReleaseAction } from './create-release';
import { githubListReleasesAction } from './list-releases';
import { githubSearchIssuesAction } from './search-issues';

/** All GitHub actions as an array (for bulk registration). */
export const githubActions: ActionDefinition[] = [
  // Repos
  githubListReposAction,
  githubGetRepoAction,
  // Issues
  githubCreateIssueAction,
  githubGetIssueAction,
  githubListIssuesAction,
  githubUpdateIssueAction,
  githubAddIssueCommentAction,
  githubListIssueCommentsAction,
  // Pull Requests
  githubCreatePullRequestAction,
  githubListPullRequestsAction,
  githubGetPullRequestAction,
  githubMergePullRequestAction,
  // Branches
  githubListBranchesAction,
  githubCreateBranchAction,
  // Files / Content
  githubGetFileContentAction,
  githubCreateOrUpdateFileAction,
  // Commits
  githubListCommitsAction,
  // Releases
  githubCreateReleaseAction,
  githubListReleasesAction,
  // Search
  githubSearchIssuesAction,
];
