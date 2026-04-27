/**
 * github.get_file_content — Get file content from a GitHub repository
 *
 * Retrieves the content of a file from a repository at a specific branch,
 * tag, or commit SHA. Returns decoded content for text files.
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
  ref: z.string().optional().default(''),
});

export const githubGetFileContentAction = defineAction({
  id: 'github.get_file_content',
  name: 'Get File Content',
  description:
    'Get the content of a file from a GitHub repository (GET /repos/{owner}/{repo}/contents/{path}). Use when you need to read source code, configs, or documentation files.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"name": "README.md", "path": "README.md", "content": "# Hello World", "sha": "abc123...", "size": 1024, "encoding": "utf-8"}\n' +
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
        name: 'path',
        label: 'File Path',
        type: 'text',
        required: true,
        placeholder: 'src/index.ts',
        description: 'Path to the file in the repository',
        aiProvided: true,
      },
      {
        name: 'ref',
        label: 'Branch / Tag / SHA',
        type: 'text',
        placeholder: 'main',
        description: 'Branch name, tag, or commit SHA (uses default branch if empty)',
        aiProvided: true,
      },
    ],
  },

  tags: ['github', 'file', 'content', 'read', 'development', 'oauth2'],

  async execute(params, context) {
    const { credentialId, owner, repo, path, ref } = params;

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

    context.logger.debug('Getting file content from GitHub', { owner, repo, path, ref });

    try {
      const url = new URL(
        `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}`,
      );
      if (ref) {
        url.searchParams.set('ref', ref);
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

      const file = (await response.json()) as {
        type: string;
        name: string;
        path: string;
        sha: string;
        size: number;
        encoding: string;
        content: string;
        html_url: string;
        download_url: string | null;
      };

      if (file.type !== 'file') {
        return {
          success: false,
          error: `Path '${path}' is a ${file.type}, not a file. Use a file path instead.`,
        };
      }

      // Decode base64 content
      let decodedContent: string;
      try {
        decodedContent = Buffer.from(file.content, 'base64').toString('utf-8');
      } catch {
        decodedContent = file.content;
      }

      return {
        success: true,
        output: {
          name: file.name,
          path: file.path,
          sha: file.sha,
          size: file.size,
          content: decodedContent,
          encoding: file.encoding,
          url: file.html_url,
          downloadUrl: file.download_url,
        },
        metadata: { path: file.path, sha: file.sha, owner, repo },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `GitHub get file content failed: ${msg}` };
    }
  },
});
