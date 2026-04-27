/**
 * github.get_pull_request — Get a GitHub pull request by number
 *
 * Retrieves detailed information about a specific pull request including
 * title, body, state, merge status, reviewers, and diff stats.
 * Requires a GitHub OAuth2 credential with repo scope.
 */

import { defineAction } from '@flowlib/action-kit';
import { GITHUB_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const GITHUB_API_BASE = 'https://api.github.com';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'GitHub credential is required'),
  owner: z.string().min(1, 'Repository owner is required'),
  repo: z.string().min(1, 'Repository name is required'),
  pullNumber: z.number().int().positive('Pull request number must be positive'),
});

export const githubGetPullRequestAction = defineAction({
  id: 'github.get_pull_request',
  name: 'Get Pull Request',
  description:
    'Get detailed information about a specific pull request (GET /repos/{owner}/{repo}/pulls/{pull_number}). Use when you need merge status, reviewers, diff stats, or full PR details.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"number": 1347, "title": "Amazing feature", "state": "open", "merged": false, "mergeable": true, "additions": 10, "deletions": 2, "changed_files": 3}\n' +
    '```',
  provider: GITHUB_PROVIDER,
  actionCategory: 'read',

  credential: {
    required: true,
    type: 'oauth2',
    oauth2Provider: 'github',
    requiredScopes: ['repo'],
    description: 'GitHub OAuth2 credential with repo scope',
  },

  params: {
    schema: paramsSchema,
    fields: [
      {
        name: 'credentialId',
        label: 'GitHub Credential',
        type: 'text',
        required: true,
        description: 'GitHub OAuth2 credential for authentication',
        aiProvided: false,
      },
      {
        name: 'owner',
        label: 'Owner',
        type: 'text',
        required: true,
        placeholder: 'octocat',
        description: 'Repository owner (user or organisation)',
        aiProvided: true,
      },
      {
        name: 'repo',
        label: 'Repository',
        type: 'text',
        required: true,
        placeholder: 'hello-world',
        description: 'Repository name',
        aiProvided: true,
      },
      {
        name: 'pullNumber',
        label: 'Pull Request Number',
        type: 'number',
        required: true,
        description: 'The pull request number to retrieve',
        aiProvided: true,
      },
    ],
  },

  tags: ['github', 'pull-request', 'pr', 'get', 'development', 'oauth2'],

  async execute(params, context) {
    const { credentialId, owner, repo, pullNumber } = params;

    let credential = context.credential;
    if (!credential && context.functions?.getCredential) {
      credential = await context.functions.getCredential(credentialId);
    }
    if (!credential) {
      return {
        success: false,
        error: `Credential not found: ${credentialId}. Please create a GitHub OAuth2 credential.`,
      };
    }

    const accessToken =
      (credential.config?.accessToken as string) ?? (credential.config?.token as string);
    if (!accessToken) {
      return {
        success: false,
        error: 'No valid access token in credential. Please re-authorize the GitHub credential.',
      };
    }

    context.logger.debug('Getting GitHub pull request', { owner, repo, pullNumber });

    try {
      const response = await fetch(
        `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pullNumber}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `GitHub API error: ${response.status} ${response.statusText} - ${errorText}`,
        };
      }

      const pr = (await response.json()) as {
        number: number;
        html_url: string;
        title: string;
        body: string | null;
        state: string;
        draft: boolean;
        merged: boolean;
        mergeable: boolean | null;
        mergeable_state: string;
        head: { ref: string; sha: string; repo: { full_name: string } | null };
        base: { ref: string; sha: string };
        user: { login: string };
        labels: Array<{ name: string }>;
        requested_reviewers: Array<{ login: string }>;
        additions: number;
        deletions: number;
        changed_files: number;
        commits: number;
        comments: number;
        review_comments: number;
        created_at: string;
        updated_at: string;
        merged_at: string | null;
        closed_at: string | null;
        merge_commit_sha: string | null;
      };

      return {
        success: true,
        output: {
          prNumber: pr.number,
          url: pr.html_url,
          title: pr.title,
          body: pr.body,
          state: pr.state,
          draft: pr.draft,
          merged: pr.merged,
          mergeable: pr.mergeable,
          mergeableState: pr.mergeable_state,
          headBranch: pr.head.ref,
          headSha: pr.head.sha,
          headRepo: pr.head.repo?.full_name ?? null,
          baseBranch: pr.base.ref,
          author: pr.user.login,
          labels: pr.labels.map((l) => l.name),
          requestedReviewers: pr.requested_reviewers.map((r) => r.login),
          additions: pr.additions,
          deletions: pr.deletions,
          changedFiles: pr.changed_files,
          commits: pr.commits,
          comments: pr.comments,
          reviewComments: pr.review_comments,
          createdAt: pr.created_at,
          updatedAt: pr.updated_at,
          mergedAt: pr.merged_at,
          closedAt: pr.closed_at,
          mergeCommitSha: pr.merge_commit_sha,
        },
        metadata: { prNumber: pr.number, url: pr.html_url, owner, repo },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `GitHub get pull request failed: ${msg}` };
    }
  },
});
