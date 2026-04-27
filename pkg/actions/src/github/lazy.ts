/**
 * Lazy descriptors for GitHub actions.
 *
 * GitHub has 20 actions and is one of the larger providers; deferring the
 * `@octokit/*` import surface until actually-used delivers material savings
 * on edge bundles.
 */

import type { LazyActionDefinition } from '@flowlib/action-kit';

const githubProvider = { id: 'github' };

export const lazyGithubActions: LazyActionDefinition[] = [
  // Repos
  {
    id: 'github.list_repos',
    provider: githubProvider,
    load: async () => (await import('./list-repos')).githubListReposAction,
  },
  {
    id: 'github.get_repo',
    provider: githubProvider,
    load: async () => (await import('./get-repo')).githubGetRepoAction,
  },
  // Issues
  {
    id: 'github.create_issue',
    provider: githubProvider,
    load: async () => (await import('./create-issue')).githubCreateIssueAction,
  },
  {
    id: 'github.get_issue',
    provider: githubProvider,
    load: async () => (await import('./get-issue')).githubGetIssueAction,
  },
  {
    id: 'github.list_issues',
    provider: githubProvider,
    load: async () => (await import('./list-issues')).githubListIssuesAction,
  },
  {
    id: 'github.update_issue',
    provider: githubProvider,
    load: async () => (await import('./update-issue')).githubUpdateIssueAction,
  },
  {
    id: 'github.add_issue_comment',
    provider: githubProvider,
    load: async () => (await import('./add-issue-comment')).githubAddIssueCommentAction,
  },
  {
    id: 'github.list_issue_comments',
    provider: githubProvider,
    load: async () => (await import('./list-issue-comments')).githubListIssueCommentsAction,
  },
  // Pull Requests
  {
    id: 'github.create_pull_request',
    provider: githubProvider,
    load: async () => (await import('./create-pull-request')).githubCreatePullRequestAction,
  },
  {
    id: 'github.list_pull_requests',
    provider: githubProvider,
    load: async () => (await import('./list-pull-requests')).githubListPullRequestsAction,
  },
  {
    id: 'github.get_pull_request',
    provider: githubProvider,
    load: async () => (await import('./get-pull-request')).githubGetPullRequestAction,
  },
  {
    id: 'github.merge_pull_request',
    provider: githubProvider,
    load: async () => (await import('./merge-pull-request')).githubMergePullRequestAction,
  },
  // Branches
  {
    id: 'github.list_branches',
    provider: githubProvider,
    load: async () => (await import('./list-branches')).githubListBranchesAction,
  },
  {
    id: 'github.create_branch',
    provider: githubProvider,
    load: async () => (await import('./create-branch')).githubCreateBranchAction,
  },
  // Files / Content
  {
    id: 'github.get_file_content',
    provider: githubProvider,
    load: async () => (await import('./get-file-content')).githubGetFileContentAction,
  },
  {
    id: 'github.create_or_update_file',
    provider: githubProvider,
    load: async () => (await import('./create-or-update-file')).githubCreateOrUpdateFileAction,
  },
  // Commits
  {
    id: 'github.list_commits',
    provider: githubProvider,
    load: async () => (await import('./list-commits')).githubListCommitsAction,
  },
  // Releases
  {
    id: 'github.create_release',
    provider: githubProvider,
    load: async () => (await import('./create-release')).githubCreateReleaseAction,
  },
  {
    id: 'github.list_releases',
    provider: githubProvider,
    load: async () => (await import('./list-releases')).githubListReleasesAction,
  },
  // Search
  {
    id: 'github.search_issues',
    provider: githubProvider,
    load: async () => (await import('./search-issues')).githubSearchIssuesAction,
  },
];
