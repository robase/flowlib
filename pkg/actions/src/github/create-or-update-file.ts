/**
 * github.create_or_update_file — Create or update a file in a GitHub repository
 *
 * Creates a new file or updates an existing file in a repository.
 * When updating, the SHA of the existing file is required.
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
  path: z.string().min(1, 'File path is required'),
  content: z.string().min(1, 'File content is required'),
  message: z.string().min(1, 'Commit message is required'),
  branch: z.string().optional().default(''),
  sha: z.string().optional().default(''),
  committerName: z.string().optional().default(''),
  committerEmail: z.string().optional().default(''),
});

export const githubCreateOrUpdateFileAction = defineAction({
  id: 'github.create_or_update_file',
  name: 'Create or Update File',
  description:
    'Create or update a file in a GitHub repository (PUT /repos/{owner}/{repo}/contents/{path}). Use when you need to commit a file change directly via the API.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"content": {"name": "README.md", "path": "README.md", "sha": "abc123..."}, "commit": {"sha": "def456...", "message": "Update README"}}\n' +
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
        name: 'path',
        label: 'File Path',
        type: 'text',
        required: true,
        placeholder: 'docs/README.md',
        description: 'Path for the file in the repository',
        aiProvided: true,
      },
      {
        name: 'content',
        label: 'Content',
        type: 'textarea',
        required: true,
        placeholder: '# Hello World',
        description: 'File content (plain text). Supports template expressions.',
        aiProvided: true,
      },
      {
        name: 'message',
        label: 'Commit Message',
        type: 'text',
        required: true,
        placeholder: 'Add README.md',
        description: 'Commit message for this change',
        aiProvided: true,
      },
      {
        name: 'branch',
        label: 'Branch',
        type: 'text',
        placeholder: 'main',
        description: 'Target branch (uses default branch if empty)',
        aiProvided: true,
      },
      {
        name: 'sha',
        label: 'File SHA (for updates)',
        type: 'text',
        placeholder: 'abc123...',
        description: 'SHA of the existing file (required when updating, omit when creating new)',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'committerName',
        label: 'Committer Name',
        type: 'text',
        placeholder: 'Bot',
        description: 'Custom committer name (uses authenticated user if empty)',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'committerEmail',
        label: 'Committer Email',
        type: 'text',
        placeholder: 'bot@example.com',
        description: 'Custom committer email (uses authenticated user if empty)',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['github', 'file', 'create', 'update', 'commit', 'development', 'oauth2'],

  async execute(params, context) {
    const {
      credentialId,
      owner,
      repo,
      path,
      content,
      message,
      branch,
      sha,
      committerName,
      committerEmail,
    } = params;

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

    context.logger.debug('Creating/updating file on GitHub', { owner, repo, path });

    try {
      // Base64 encode the content
      const encodedContent = Buffer.from(content, 'utf-8').toString('base64');

      const requestBody: Record<string, unknown> = {
        message,
        content: encodedContent,
      };
      if (branch) {
        requestBody.branch = branch;
      }
      if (sha) {
        requestBody.sha = sha;
      }
      if (committerName && committerEmail) {
        requestBody.committer = { name: committerName, email: committerEmail };
      }

      const response = await fetch(
        `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/vnd.github+json',
            'Content-Type': 'application/json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
          body: JSON.stringify(requestBody),
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
        content: {
          name: string;
          path: string;
          sha: string;
          size: number;
          html_url: string;
        };
        commit: {
          sha: string;
          message: string;
          html_url: string;
          author: { name: string; email: string; date: string };
        };
      };

      return {
        success: true,
        output: {
          path: result.content.path,
          sha: result.content.sha,
          size: result.content.size,
          url: result.content.html_url,
          commitSha: result.commit.sha,
          commitUrl: result.commit.html_url,
          commitMessage: result.commit.message,
          committedAt: result.commit.author.date,
        },
        metadata: {
          path: result.content.path,
          sha: result.content.sha,
          commitSha: result.commit.sha,
          owner,
          repo,
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `GitHub create/update file failed: ${msg}` };
    }
  },
});
