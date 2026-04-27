/**
 * github.create_pull_request — Create a GitHub pull request
 *
 * Creates a new pull request in a repository. Supports title, body,
 * head/base branches, draft mode, and maintainer edits.
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
  title: z.string().min(1, 'PR title is required'),
  head: z.string().min(1, 'Head branch is required'),
  base: z.string().min(1, 'Base branch is required'),
  body: z.string().optional().default(''),
  draft: z.boolean().optional().default(false),
  maintainerCanModify: z.boolean().optional().default(true),
});

export const githubCreatePullRequestAction = defineAction({
  id: 'github.create_pull_request',
  name: 'Create Pull Request',
  description:
    'Create a new pull request in a GitHub repository (POST /repos/{owner}/{repo}/pulls). Use when the user wants to propose merging changes from one branch into another.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"number": 1347, "title": "Add new feature", "state": "open", "html_url": "https://github.com/octocat/hello-world/pull/1347", "head": "feature", "base": "main"}\n' +
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
        name: 'title',
        label: 'Title',
        type: 'text',
        required: true,
        placeholder: 'Add new feature',
        description: 'Pull request title',
        aiProvided: true,
      },
      {
        name: 'head',
        label: 'Head Branch',
        type: 'text',
        required: true,
        placeholder: 'feature-branch',
        description: 'The branch that contains your changes',
        aiProvided: true,
      },
      {
        name: 'base',
        label: 'Base Branch',
        type: 'text',
        required: true,
        placeholder: 'main',
        description: 'The branch you want to merge into',
        aiProvided: true,
      },
      {
        name: 'body',
        label: 'Body',
        type: 'textarea',
        placeholder: 'Describe the changes...',
        description: 'Pull request description (Markdown supported)',
        aiProvided: true,
      },
      {
        name: 'draft',
        label: 'Draft',
        type: 'boolean',
        defaultValue: false,
        description: 'Create as a draft pull request',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'maintainerCanModify',
        label: 'Allow Maintainer Edits',
        type: 'boolean',
        defaultValue: true,
        description: 'Allow maintainers to push to the head branch',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['github', 'pull-request', 'pr', 'create', 'development', 'oauth2'],

  async execute(params, context) {
    const { credentialId, owner, repo, title, head, base, body, draft, maintainerCanModify } =
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

    context.logger.debug('Creating GitHub pull request', { owner, repo, head, base });

    try {
      const prBody: Record<string, unknown> = {
        title,
        head,
        base,
        draft,
        maintainer_can_modify: maintainerCanModify,
      };
      if (body) {
        prBody.body = body;
      }

      const response = await fetch(
        `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/vnd.github+json',
            'Content-Type': 'application/json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
          body: JSON.stringify(prBody),
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `GitHub API error: ${response.status} ${response.statusText} - ${errorText}`,
        };
      }

      const pr = (await response.json()) as {
        number: number;
        html_url: string;
        title: string;
        state: string;
        draft: boolean;
        head: { ref: string; sha: string };
        base: { ref: string };
        user: { login: string };
        created_at: string;
        mergeable: boolean | null;
        additions: number;
        deletions: number;
        changed_files: number;
      };

      return {
        success: true,
        output: {
          prNumber: pr.number,
          url: pr.html_url,
          title: pr.title,
          state: pr.state,
          draft: pr.draft,
          headBranch: pr.head.ref,
          headSha: pr.head.sha,
          baseBranch: pr.base.ref,
          author: pr.user.login,
          createdAt: pr.created_at,
        },
        metadata: { prNumber: pr.number, url: pr.html_url, owner, repo },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `GitHub create pull request failed: ${msg}` };
    }
  },
});
