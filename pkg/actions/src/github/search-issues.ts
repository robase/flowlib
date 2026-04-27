/**
 * github.search_issues — Search GitHub issues and pull requests
 *
 * Searches issues and PRs across GitHub using the powerful search query syntax.
 * Supports filtering by repo, state, labels, author, and more.
 * Requires a GitHub OAuth2 credential.
 */

import { defineAction } from '@flowlib/action-kit';
import { GITHUB_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const GITHUB_API_BASE = 'https://api.github.com';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'GitHub credential is required'),
  query: z.string().min(1, 'Search query is required'),
  sort: z
    .enum(['created', 'updated', 'comments', 'reactions', 'best-match'])
    .optional()
    .default('best-match'),
  order: z.enum(['asc', 'desc']).optional().default('desc'),
  perPage: z.number().int().min(1).max(100).optional().default(30),
});

export const githubSearchIssuesAction = defineAction({
  id: 'github.search_issues',
  name: 'Search Issues & PRs',
  description:
    'Search GitHub issues and pull requests across repositories (GET /search/issues). Use when you need to find issues matching complex criteria like labels, state, or keywords.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"totalCount": 42, "items": [{"number": 1347, "title": "Found a bug", "state": "open", "repository": "octocat/hello-world", "score": 1.0}]}\n' +
    '```',
  provider: GITHUB_PROVIDER,
  actionCategory: 'read',

  credential: {
    required: true,
    type: 'oauth2',
    oauth2Provider: 'github',
    requiredScopes: ['repo'],
    description: 'GitHub OAuth2 credential',
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
        name: 'query',
        label: 'Search Query',
        type: 'textarea',
        required: true,
        placeholder: 'repo:octocat/hello-world is:issue is:open label:bug',
        description:
          'GitHub search query. Qualifiers: repo:, is:issue/pr, is:open/closed, label:, author:, assignee:, mentions:, in:title/body',
        aiProvided: true,
      },
      {
        name: 'sort',
        label: 'Sort By',
        type: 'select',
        defaultValue: 'best-match',
        options: [
          { label: 'Best Match', value: 'best-match' },
          { label: 'Created', value: 'created' },
          { label: 'Updated', value: 'updated' },
          { label: 'Comments', value: 'comments' },
          { label: 'Reactions', value: 'reactions' },
        ],
        description: 'How to sort results',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'order',
        label: 'Order',
        type: 'select',
        defaultValue: 'desc',
        options: [
          { label: 'Descending', value: 'desc' },
          { label: 'Ascending', value: 'asc' },
        ],
        description: 'Sort order',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'perPage',
        label: 'Per Page',
        type: 'number',
        defaultValue: 30,
        description: 'Number of results to return (1–100)',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['github', 'search', 'issue', 'pull-request', 'development', 'oauth2'],

  async execute(params, context) {
    const { credentialId, query, sort, order, perPage } = params;

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

    context.logger.debug('Searching GitHub issues/PRs', { query, sort });

    try {
      const url = new URL(`${GITHUB_API_BASE}/search/issues`);
      url.searchParams.set('q', query);
      if (sort !== 'best-match') {
        url.searchParams.set('sort', sort);
      }
      url.searchParams.set('order', order);
      url.searchParams.set('per_page', String(Math.min(Math.max(1, perPage), 100)));

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

      const data = (await response.json()) as {
        total_count: number;
        incomplete_results: boolean;
        items: Array<{
          number: number;
          html_url: string;
          title: string;
          state: string;
          body: string | null;
          labels: Array<{ name: string }>;
          user: { login: string };
          comments: number;
          created_at: string;
          updated_at: string;
          closed_at: string | null;
          pull_request?: { html_url: string };
          repository_url: string;
          score: number;
        }>;
      };

      return {
        success: true,
        output: {
          totalCount: data.total_count,
          incompleteResults: data.incomplete_results,
          items: data.items.map((item) => {
            // Extract owner/repo from repository_url
            const repoUrlParts = item.repository_url.split('/');
            const repoName = repoUrlParts.slice(-2).join('/');

            return {
              number: item.number,
              url: item.html_url,
              title: item.title,
              state: item.state,
              repository: repoName,
              type: item.pull_request ? 'pull_request' : 'issue',
              labels: item.labels.map((l) => l.name),
              author: item.user.login,
              commentsCount: item.comments,
              createdAt: item.created_at,
              updatedAt: item.updated_at,
              closedAt: item.closed_at,
              score: item.score,
            };
          }),
        },
        metadata: { query, totalCount: data.total_count },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `GitHub search issues failed: ${msg}` };
    }
  },
});
