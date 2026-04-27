/**
 * github.list_issue_comments — List comments on a GitHub issue or PR
 *
 * Retrieves all comments on a specific issue or pull request.
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
  issueNumber: z.number().int().positive('Issue number must be positive'),
  perPage: z.number().int().min(1).max(100).optional().default(30),
});

export const githubListIssueCommentsAction = defineAction({
  id: 'github.list_issue_comments',
  name: 'List Issue Comments',
  description:
    'List comments on a GitHub issue or pull request (GET /repos/{owner}/{repo}/issues/{issue_number}/comments). Use when you need to read the discussion thread on an issue.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"comments": [{"commentId": 1, "body": "Great work!", "author": "octocat", "createdAt": "2024-01-01T00:00:00Z"}], "totalReturned": 1}\n' +
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
        name: 'issueNumber',
        label: 'Issue / PR Number',
        type: 'number',
        required: true,
        description: 'The issue or pull request number',
        aiProvided: true,
      },
      {
        name: 'perPage',
        label: 'Per Page',
        type: 'number',
        defaultValue: 30,
        description: 'Number of comments to return (1–100)',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['github', 'issue', 'comment', 'list', 'development', 'oauth2'],

  async execute(params, context) {
    const { credentialId, owner, repo, issueNumber, perPage } = params;

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

    context.logger.debug('Listing comments on GitHub issue', { owner, repo, issueNumber });

    try {
      const url = new URL(
        `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${issueNumber}/comments`,
      );
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

      const comments = (await response.json()) as Array<{
        id: number;
        html_url: string;
        body: string;
        user: { login: string };
        created_at: string;
        updated_at: string;
      }>;

      return {
        success: true,
        output: {
          comments: comments.map((c) => ({
            commentId: c.id,
            url: c.html_url,
            body: c.body,
            author: c.user.login,
            createdAt: c.created_at,
            updatedAt: c.updated_at,
          })),
          totalReturned: comments.length,
        },
        metadata: { issueNumber, owner, repo, totalReturned: comments.length },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `GitHub list issue comments failed: ${msg}` };
    }
  },
});
