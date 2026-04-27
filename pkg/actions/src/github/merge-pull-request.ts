/**
 * github.merge_pull_request — Merge a GitHub pull request
 *
 * Merges a pull request using the specified merge method (merge, squash, or rebase).
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
  commitTitle: z.string().optional(),
  commitMessage: z.string().optional(),
  mergeMethod: z.enum(['merge', 'squash', 'rebase']).optional().default('merge'),
  sha: z.string().optional(),
});

export const githubMergePullRequestAction = defineAction({
  id: 'github.merge_pull_request',
  name: 'Merge Pull Request',
  description:
    'Merge a pull request into its base branch (PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge). Use when the user wants to complete a PR merge via merge commit, squash, or rebase.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"sha": "6dcb09b5b57875f334f61aebed695e2e4193db5e", "merged": true, "message": "Pull Request successfully merged"}\n' +
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
        name: 'pullNumber',
        label: 'Pull Request Number',
        type: 'number',
        required: true,
        description: 'The pull request number to merge',
        aiProvided: true,
      },
      {
        name: 'mergeMethod',
        label: 'Merge Method',
        type: 'select',
        defaultValue: 'merge',
        options: [
          { label: 'Merge Commit', value: 'merge' },
          { label: 'Squash', value: 'squash' },
          { label: 'Rebase', value: 'rebase' },
        ],
        description: 'The merge strategy to use',
        aiProvided: true,
      },
      {
        name: 'commitTitle',
        label: 'Commit Title',
        type: 'text',
        placeholder: 'Merge PR #123: Feature name',
        description: 'Custom title for the merge commit (squash/merge only)',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'commitMessage',
        label: 'Commit Message',
        type: 'textarea',
        placeholder: 'Additional merge details...',
        description: 'Custom message for the merge commit (squash/merge only)',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'sha',
        label: 'Expected HEAD SHA',
        type: 'text',
        placeholder: 'abc123...',
        description: 'SHA that the head must match to merge (safety check)',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['github', 'pull-request', 'pr', 'merge', 'development', 'oauth2'],

  async execute(params, context) {
    const { credentialId, owner, repo, pullNumber, commitTitle, commitMessage, mergeMethod, sha } =
      params;

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

    context.logger.debug('Merging GitHub pull request', { owner, repo, pullNumber, mergeMethod });

    try {
      const mergeBody: Record<string, unknown> = {
        merge_method: mergeMethod,
      };
      if (commitTitle) {
        mergeBody.commit_title = commitTitle;
      }
      if (commitMessage) {
        mergeBody.commit_message = commitMessage;
      }
      if (sha) {
        mergeBody.sha = sha;
      }

      const response = await fetch(
        `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pullNumber}/merge`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/vnd.github+json',
            'Content-Type': 'application/json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
          body: JSON.stringify(mergeBody),
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `GitHub API error: ${response.status} ${response.statusText} - ${errorText}`,
        };
      }

      const result = (await response.json()) as {
        sha: string;
        merged: boolean;
        message: string;
      };

      return {
        success: true,
        output: {
          merged: result.merged,
          sha: result.sha,
          message: result.message,
          pullNumber,
          mergeMethod,
        },
        metadata: { pullNumber, sha: result.sha, owner, repo },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `GitHub merge pull request failed: ${msg}` };
    }
  },
});
