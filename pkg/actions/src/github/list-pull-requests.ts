/**
 * github.list_pull_requests — List pull requests in a GitHub repository
 *
 * Lists pull requests with filtering by state, head/base branch, and
 * sorting options. Requires a GitHub OAuth2 credential.
 */

import { defineAction } from '@flowlib/action-kit';
import { GITHUB_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const GITHUB_API_BASE = 'https://api.github.com';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'GitHub credential is required'),
  owner: z.string().min(1, 'Repository owner is required'),
  repo: z.string().min(1, 'Repository name is required'),
  state: z.enum(['open', 'closed', 'all']).optional().default('open'),
  head: z.string().optional().default(''),
  base: z.string().optional().default(''),
  sort: z.enum(['created', 'updated', 'popularity', 'long-running']).optional().default('created'),
  direction: z.enum(['asc', 'desc']).optional().default('desc'),
  perPage: z.number().int().min(1).max(100).optional().default(30),
});

export const githubListPullRequestsAction = defineAction({
  id: 'github.list_pull_requests',
  name: 'List Pull Requests',
  description:
    'List pull requests in a GitHub repository (GET /repos/{owner}/{repo}/pulls). Use when you need to browse, filter, or review open/closed pull requests.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"pullRequests": [{"number": 1347, "title": "Amazing new feature", "state": "open", "author": "octocat", "headBranch": "feature-branch", "baseBranch": "main"}], "totalReturned": 1}\n' +
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
        name: 'state',
        label: 'State',
        type: 'select',
        defaultValue: 'open',
        options: [
          { label: 'Open', value: 'open' },
          { label: 'Closed', value: 'closed' },
          { label: 'All', value: 'all' },
        ],
        description: 'Filter by PR state',
        aiProvided: true,
      },
      {
        name: 'head',
        label: 'Head Branch',
        type: 'text',
        placeholder: 'user:feature-branch',
        description: 'Filter by head user or org and branch (e.g. user:branch-name)',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'base',
        label: 'Base Branch',
        type: 'text',
        placeholder: 'main',
        description: 'Filter by base branch name',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'sort',
        label: 'Sort By',
        type: 'select',
        defaultValue: 'created',
        options: [
          { label: 'Created', value: 'created' },
          { label: 'Updated', value: 'updated' },
          { label: 'Popularity', value: 'popularity' },
          { label: 'Long-running', value: 'long-running' },
        ],
        description: 'How to sort the pull requests',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'direction',
        label: 'Direction',
        type: 'select',
        defaultValue: 'desc',
        options: [
          { label: 'Descending', value: 'desc' },
          { label: 'Ascending', value: 'asc' },
        ],
        description: 'Sort direction',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'perPage',
        label: 'Per Page',
        type: 'number',
        defaultValue: 30,
        description: 'Number of pull requests to return (1–100)',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['github', 'pull-request', 'pr', 'list', 'development', 'oauth2'],

  async execute(params, context) {
    const { credentialId, owner, repo, state, head, base, sort, direction, perPage } = params;

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

    context.logger.debug('Listing GitHub pull requests', { owner, repo, state, sort });

    try {
      const url = new URL(
        `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`,
      );
      url.searchParams.set('state', state);
      url.searchParams.set('sort', sort);
      url.searchParams.set('direction', direction);
      url.searchParams.set('per_page', String(Math.min(Math.max(1, perPage), 100)));
      if (head) {
        url.searchParams.set('head', head);
      }
      if (base) {
        url.searchParams.set('base', base);
      }

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `GitHub API error: ${response.status} ${response.statusText} - ${errorText}`,
        };
      }

      const prs = (await response.json()) as Array<{
        number: number;
        html_url: string;
        title: string;
        state: string;
        draft: boolean;
        head: { ref: string; sha: string };
        base: { ref: string };
        user: { login: string };
        labels: Array<{ name: string }>;
        created_at: string;
        updated_at: string;
        merged_at: string | null;
      }>;

      return {
        success: true,
        output: {
          pullRequests: prs.map((pr) => ({
            number: pr.number,
            url: pr.html_url,
            title: pr.title,
            state: pr.state,
            draft: pr.draft,
            headBranch: pr.head.ref,
            baseBranch: pr.base.ref,
            author: pr.user.login,
            labels: pr.labels.map((l) => l.name),
            createdAt: pr.created_at,
            updatedAt: pr.updated_at,
            mergedAt: pr.merged_at,
          })),
          totalReturned: prs.length,
        },
        metadata: { owner, repo, state, totalReturned: prs.length },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `GitHub list pull requests failed: ${msg}` };
    }
  },
});
