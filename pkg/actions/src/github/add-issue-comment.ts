/**
 * github.add_issue_comment — Add a comment to a GitHub issue or PR
 *
 * Creates a new comment on an issue or pull request.
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
  body: z.string().min(1, 'Comment body is required'),
});

export const githubAddIssueCommentAction = defineAction({
  id: 'github.add_issue_comment',
  name: 'Add Issue Comment',
  description:
    'Add a comment to a GitHub issue or pull request (POST /repos/{owner}/{repo}/issues/{issue_number}/comments). Use when the user wants to post feedback, updates, or questions on an issue.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"id": 1, "body": "Great work!", "user": "octocat", "created_at": "2024-01-01T00:00:00Z", "html_url": "https://github.com/octocat/hello-world/issues/1#issuecomment-1"}\n' +
    '```',
  provider: GITHUB_PROVIDER,
  actionCategory: 'write',

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
        description: 'The issue or pull request number to comment on',
        aiProvided: true,
      },
      {
        name: 'body',
        label: 'Comment',
        type: 'textarea',
        required: true,
        placeholder: 'Great work on this! 🎉',
        description: 'Comment body (Markdown supported). Supports template expressions.',
        aiProvided: true,
      },
    ],
  },

  tags: ['github', 'issue', 'comment', 'development', 'oauth2'],

  async execute(params, context) {
    const { credentialId, owner, repo, issueNumber, body } = params;

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

    context.logger.debug('Adding comment to GitHub issue', { owner, repo, issueNumber });

    try {
      const response = await fetch(
        `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${issueNumber}/comments`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/vnd.github+json',
            'Content-Type': 'application/json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
          body: JSON.stringify({ body }),
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `GitHub API error: ${response.status} ${response.statusText} - ${errorText}`,
        };
      }

      const comment = (await response.json()) as {
        id: number;
        html_url: string;
        body: string;
        user: { login: string };
        created_at: string;
      };

      return {
        success: true,
        output: {
          commentId: comment.id,
          url: comment.html_url,
          body: comment.body,
          author: comment.user.login,
          createdAt: comment.created_at,
        },
        metadata: { commentId: comment.id, url: comment.html_url, issueNumber, owner, repo },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `GitHub add comment failed: ${msg}` };
    }
  },
});
