/**
 * github.list_commits — List commits in a GitHub repository
 *
 * Lists commits for a repository with optional filtering by branch,
 * path, author, and date range.
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
  sha: z.string().optional().default(''),
  path: z.string().optional().default(''),
  author: z.string().optional().default(''),
  since: z.string().optional().default(''),
  until: z.string().optional().default(''),
  perPage: z.number().int().min(1).max(100).optional().default(30),
});

export const githubListCommitsAction = defineAction({
  id: 'github.list_commits',
  name: 'List Commits',
  description:
    'List commits in a GitHub repository (GET /repos/{owner}/{repo}/commits). Use when you need to view commit history, audit changes, or find specific commits.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"commits": [{"sha": "6dcb09b5...", "shortSha": "6dcb09b", "message": "Fix bug", "author": "octocat", "date": "2024-01-01T00:00:00Z"}], "totalReturned": 1}\n' +
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
        name: 'sha',
        label: 'Branch / SHA',
        type: 'text',
        placeholder: 'main',
        description: 'Branch name or commit SHA to list from (uses default branch if empty)',
        aiProvided: true,
      },
      {
        name: 'path',
        label: 'File Path',
        type: 'text',
        placeholder: 'src/index.ts',
        description: 'Only commits affecting this file path',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'author',
        label: 'Author',
        type: 'text',
        placeholder: 'octocat',
        description: 'GitHub username or email to filter by author',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'since',
        label: 'Since',
        type: 'text',
        placeholder: '2024-01-01T00:00:00Z',
        description: 'Only commits after this date (ISO 8601 format)',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'until',
        label: 'Until',
        type: 'text',
        placeholder: '2024-12-31T23:59:59Z',
        description: 'Only commits before this date (ISO 8601 format)',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'perPage',
        label: 'Per Page',
        type: 'number',
        defaultValue: 30,
        description: 'Number of commits to return (1–100)',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['github', 'commit', 'list', 'history', 'development', 'oauth2'],

  async execute(params, context) {
    const { credentialId, owner, repo, sha, path, author, since, until, perPage } = params;

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

    context.logger.debug('Listing GitHub commits', { owner, repo, sha: sha || '(default)' });

    try {
      const url = new URL(
        `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits`,
      );
      url.searchParams.set('per_page', String(Math.min(Math.max(1, perPage), 100)));
      if (sha) {
        url.searchParams.set('sha', sha);
      }
      if (path) {
        url.searchParams.set('path', path);
      }
      if (author) {
        url.searchParams.set('author', author);
      }
      if (since) {
        url.searchParams.set('since', since);
      }
      if (until) {
        url.searchParams.set('until', until);
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

      const commits = (await response.json()) as Array<{
        sha: string;
        html_url: string;
        commit: {
          message: string;
          author: { name: string; email: string; date: string };
          committer: { name: string; date: string };
        };
        author: { login: string } | null;
        committer: { login: string } | null;
      }>;

      return {
        success: true,
        output: {
          commits: commits.map((c) => ({
            sha: c.sha,
            shortSha: c.sha.substring(0, 7),
            url: c.html_url,
            message: c.commit.message,
            author: c.author?.login ?? c.commit.author.name,
            authorEmail: c.commit.author.email,
            date: c.commit.author.date,
            committer: c.committer?.login ?? c.commit.committer.name,
          })),
          totalReturned: commits.length,
        },
        metadata: { owner, repo, totalReturned: commits.length },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `GitHub list commits failed: ${msg}` };
    }
  },
});
