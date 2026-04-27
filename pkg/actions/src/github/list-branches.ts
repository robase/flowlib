/**
 * github.list_branches — List branches in a GitHub repository
 *
 * Lists branches in a repository with protection status.
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
  protected: z.boolean().optional(),
  perPage: z.number().int().min(1).max(100).optional().default(30),
});

export const githubListBranchesAction = defineAction({
  id: 'github.list_branches',
  name: 'List Branches',
  description:
    'List branches in a GitHub repository (GET /repos/{owner}/{repo}/branches). Use when you need to discover branch names or check protection status.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"branches": [{"name": "main", "protected": true, "sha": "6dcb09b5..."}, {"name": "feature", "protected": false, "sha": "abc123..."}], "totalReturned": 2}\n' +
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
        name: 'protected',
        label: 'Protected Only',
        type: 'boolean',
        description: 'If true, only return protected branches',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'perPage',
        label: 'Per Page',
        type: 'number',
        defaultValue: 30,
        description: 'Number of branches to return (1–100)',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['github', 'branch', 'list', 'development', 'oauth2'],

  async execute(params, context) {
    const { credentialId, owner, repo, perPage } = params;
    const protectedOnly = params.protected;

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

    context.logger.debug('Listing GitHub branches', { owner, repo });

    try {
      const url = new URL(
        `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches`,
      );
      url.searchParams.set('per_page', String(Math.min(Math.max(1, perPage), 100)));
      if (protectedOnly !== undefined) {
        url.searchParams.set('protected', String(protectedOnly));
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

      const branches = (await response.json()) as Array<{
        name: string;
        commit: { sha: string; url: string };
        protected: boolean;
      }>;

      return {
        success: true,
        output: {
          branches: branches.map((b) => ({
            name: b.name,
            sha: b.commit.sha,
            protected: b.protected,
          })),
          totalReturned: branches.length,
        },
        metadata: { owner, repo, totalReturned: branches.length },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `GitHub list branches failed: ${msg}` };
    }
  },
});
