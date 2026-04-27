/**
 * github.get_repo — Get GitHub repository details
 *
 * Retrieves detailed information about a specific repository including
 * description, language, stats, default branch, and visibility.
 * Requires a GitHub OAuth2 credential.
 */

import { defineAction } from '@flowlib/action-kit';
import { GITHUB_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const GITHUB_API_BASE = 'https://api.github.com';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'GitHub credential is required'),
  owner: z.string().min(1, 'Repository owner is required'),
  repo: z.string().min(1, 'Repository name is required'),
});

export const githubGetRepoAction = defineAction({
  id: 'github.get_repo',
  name: 'Get Repository',
  description:
    'Get detailed information about a GitHub repository (GET /repos/{owner}/{repo}). Use when you need repo metadata like description, language, stars, forks, visibility, or default branch.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"name": "hello-world", "fullName": "octocat/hello-world", "description": "My first repo", "language": "JavaScript", "stars": 80, "forks": 9, "private": false, "defaultBranch": "main"}\n' +
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
    ],
  },

  tags: ['github', 'repository', 'get', 'development', 'oauth2'],

  async execute(params, context) {
    const { credentialId, owner, repo } = params;

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

    context.logger.debug('Getting GitHub repository', { owner, repo });

    try {
      const response = await fetch(
        `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
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

      const r = (await response.json()) as {
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
        watchers_count: number;
        open_issues_count: number;
        default_branch: string;
        topics: string[];
        license: { spdx_id: string; name: string } | null;
        has_issues: boolean;
        has_wiki: boolean;
        has_pages: boolean;
        archived: boolean;
        disabled: boolean;
        visibility: string;
        pushed_at: string;
        created_at: string;
        updated_at: string;
        owner: { login: string; avatar_url: string; type: string };
        size: number;
      };

      return {
        success: true,
        output: {
          name: r.name,
          fullName: r.full_name,
          url: r.html_url,
          description: r.description,
          private: r.private,
          fork: r.fork,
          language: r.language,
          stars: r.stargazers_count,
          forks: r.forks_count,
          watchers: r.watchers_count,
          openIssues: r.open_issues_count,
          defaultBranch: r.default_branch,
          topics: r.topics,
          license: r.license?.spdx_id ?? null,
          archived: r.archived,
          visibility: r.visibility,
          size: r.size,
          owner: r.owner.login,
          ownerType: r.owner.type,
          pushedAt: r.pushed_at,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        },
        metadata: { fullName: r.full_name, url: r.html_url, owner, repo },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `GitHub get repo failed: ${msg}` };
    }
  },
});
