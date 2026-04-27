/**
 * github.list_repos — List repositories for a user or organisation
 *
 * Lists repositories accessible to the authenticated user.
 * Can filter by owner type, visibility, and sort order.
 * Requires a GitHub OAuth2 credential with repo/read:user scope.
 */

import { defineAction } from '@flowlib/action-kit';
import { GITHUB_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const GITHUB_API_BASE = 'https://api.github.com';

interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  private: boolean;
  fork: boolean;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  default_branch: string;
  updated_at: string;
  created_at: string;
  owner: { login: string; avatar_url: string };
}

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'GitHub credential is required'),
  type: z.enum(['all', 'owner', 'member']).optional().default('owner'),
  sort: z.enum(['created', 'updated', 'pushed', 'full_name']).optional().default('updated'),
  direction: z.enum(['asc', 'desc']).optional().default('desc'),
  perPage: z.number().int().min(1).max(100).optional().default(30),
  org: z.string().optional().default(''),
});

export const githubListReposAction = defineAction({
  id: 'github.list_repos',
  name: 'List Repositories',
  description:
    'List repositories for the authenticated user or an organisation (GET /user/repos, GET /orgs/{org}/repos). Use when you need to discover or browse repositories.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"repositories": [{"name": "hello-world", "fullName": "octocat/hello-world", "private": false, "language": "JavaScript", "stars": 80, "forks": 9}], "count": 1}\n' +
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
        name: 'org',
        label: 'Organisation',
        type: 'text',
        placeholder: 'my-org',
        description: "Organisation name. Leave empty for the authenticated user's repos.",
        aiProvided: true,
      },
      {
        name: 'type',
        label: 'Type',
        type: 'select',
        defaultValue: 'owner',
        options: [
          { label: 'All', value: 'all' },
          { label: 'Owner', value: 'owner' },
          { label: 'Member', value: 'member' },
        ],
        description: 'Type of repositories to list (only for user repos, not orgs)',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'sort',
        label: 'Sort By',
        type: 'select',
        defaultValue: 'updated',
        options: [
          { label: 'Last Updated', value: 'updated' },
          { label: 'Created', value: 'created' },
          { label: 'Last Pushed', value: 'pushed' },
          { label: 'Name', value: 'full_name' },
        ],
        description: 'How to sort the repositories',
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
        description: 'Number of repos to return (1–100)',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['github', 'repository', 'list', 'development', 'oauth2'],

  async execute(params, context) {
    const { credentialId, type, sort, direction, perPage, org } = params;

    // Resolve credential
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

    context.logger.debug('Listing GitHub repositories', { org: org || '(user)', type, sort });

    try {
      let url: URL;
      if (org) {
        // Org repos endpoint
        url = new URL(`${GITHUB_API_BASE}/orgs/${encodeURIComponent(org)}/repos`);
        url.searchParams.set('sort', sort === 'full_name' ? 'full_name' : sort);
      } else {
        // Authenticated user repos endpoint
        url = new URL(`${GITHUB_API_BASE}/user/repos`);
        url.searchParams.set('type', type);
        url.searchParams.set('sort', sort);
      }
      url.searchParams.set('direction', direction);
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

      const repos = (await response.json()) as GitHubRepo[];

      const mapped = repos.map((r) => ({
        name: r.name,
        fullName: r.full_name,
        url: r.html_url,
        description: r.description,
        private: r.private,
        fork: r.fork,
        language: r.language,
        stars: r.stargazers_count,
        forks: r.forks_count,
        openIssues: r.open_issues_count,
        defaultBranch: r.default_branch,
        owner: r.owner.login,
        updatedAt: r.updated_at,
        createdAt: r.created_at,
      }));

      return {
        success: true,
        output: {
          repositories: mapped,
          count: mapped.length,
        },
        metadata: {
          count: mapped.length,
          org: org || null,
          type,
          sort,
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `GitHub list repos failed: ${msg}` };
    }
  },
});
