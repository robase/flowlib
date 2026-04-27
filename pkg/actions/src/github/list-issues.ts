/**
 * github.list_issues — List issues in a GitHub repository
 *
 * Lists issues for a repository with filtering by state, labels, assignee,
 * and sorting options. Requires a GitHub OAuth2 credential.
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
  labels: z.string().optional().default(''),
  assignee: z.string().optional().default(''),
  sort: z.enum(['created', 'updated', 'comments']).optional().default('created'),
  direction: z.enum(['asc', 'desc']).optional().default('desc'),
  perPage: z.number().int().min(1).max(100).optional().default(30),
});

export const githubListIssuesAction = defineAction({
  id: 'github.list_issues',
  name: 'List Issues',
  description:
    'List issues in a GitHub repository (GET /repos/{owner}/{repo}/issues). Use when you need to browse, filter, or audit open/closed issues.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"issues": [{"number": 1347, "title": "Found a bug", "state": "open", "author": "octocat", "labels": ["bug"], "createdAt": "2024-01-01T00:00:00Z"}], "totalReturned": 1}\n' +
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
        description: 'Filter by issue state',
        aiProvided: true,
      },
      {
        name: 'labels',
        label: 'Labels',
        type: 'text',
        placeholder: 'bug,enhancement',
        description: 'Comma-separated list of label names to filter by',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'assignee',
        label: 'Assignee',
        type: 'text',
        placeholder: 'octocat',
        description: 'Filter by assignee username. Use * for any, none for unassigned.',
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
          { label: 'Comments', value: 'comments' },
        ],
        description: 'How to sort the issues',
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
        description: 'Number of issues to return (1–100)',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['github', 'issue', 'list', 'development', 'oauth2'],

  async execute(params, context) {
    const { credentialId, owner, repo, state, labels, assignee, sort, direction, perPage } = params;

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

    context.logger.debug('Listing GitHub issues', { owner, repo, state, sort });

    try {
      const url = new URL(
        `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`,
      );
      url.searchParams.set('state', state);
      url.searchParams.set('sort', sort);
      url.searchParams.set('direction', direction);
      url.searchParams.set('per_page', String(Math.min(Math.max(1, perPage), 100)));
      if (labels) {
        url.searchParams.set('labels', labels);
      }
      if (assignee) {
        url.searchParams.set('assignee', assignee);
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

      const issues = (await response.json()) as Array<{
        number: number;
        html_url: string;
        title: string;
        state: string;
        labels: Array<{ name: string }>;
        assignees: Array<{ login: string }>;
        user: { login: string };
        comments: number;
        created_at: string;
        updated_at: string;
        pull_request?: { url: string };
      }>;

      // Filter out pull requests (GitHub API returns PRs in issues endpoint)
      const filtered = issues.filter((i) => !i.pull_request);

      return {
        success: true,
        output: {
          issues: filtered.map((i) => ({
            number: i.number,
            url: i.html_url,
            title: i.title,
            state: i.state,
            labels: i.labels.map((l) => l.name),
            assignees: i.assignees.map((a) => a.login),
            author: i.user.login,
            commentsCount: i.comments,
            createdAt: i.created_at,
            updatedAt: i.updated_at,
          })),
          totalReturned: filtered.length,
        },
        metadata: { owner, repo, state, totalReturned: filtered.length },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `GitHub list issues failed: ${msg}` };
    }
  },
});
