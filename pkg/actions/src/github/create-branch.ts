/**
 * github.create_branch — Create a branch in a GitHub repository
 *
 * Creates a new branch by creating a Git reference. Can branch from
 * a specific SHA or from an existing branch.
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
  branch: z.string().min(1, 'Branch name is required'),
  fromBranch: z.string().optional().default(''),
  sha: z.string().optional().default(''),
});

export const githubCreateBranchAction = defineAction({
  id: 'github.create_branch',
  name: 'Create Branch',
  description:
    'Create a new branch in a GitHub repository (POST /repos/{owner}/{repo}/git/refs). Use when you need to create a feature branch or release branch from a specific point.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"ref": "refs/heads/feature-branch", "sha": "abc123...", "url": "https://api.github.com/repos/octocat/hello-world/git/refs/heads/feature-branch"}\n' +
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
        name: 'branch',
        label: 'New Branch Name',
        type: 'text',
        required: true,
        placeholder: 'feature/my-feature',
        description: 'Name for the new branch',
        aiProvided: true,
      },
      {
        name: 'fromBranch',
        label: 'Source Branch',
        type: 'text',
        placeholder: 'main',
        description: 'Branch to create from (uses default branch if empty). Ignored if SHA is set.',
        aiProvided: true,
      },
      {
        name: 'sha',
        label: 'Source SHA',
        type: 'text',
        placeholder: 'abc123...',
        description: 'Specific commit SHA to create the branch from (overrides Source Branch)',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['github', 'branch', 'create', 'git', 'development', 'oauth2'],

  async execute(params, context) {
    const { credentialId, owner, repo, branch, fromBranch, sha } = params;

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

    context.logger.debug('Creating GitHub branch', { owner, repo, branch, fromBranch, sha });

    try {
      // Resolve the SHA to branch from
      let sourceSha = sha;
      if (!sourceSha) {
        // Get SHA of source branch (or default branch)
        const sourceBranch = fromBranch || 'main';
        const branchResponse = await fetch(
          `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${encodeURIComponent(sourceBranch)}`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: 'application/vnd.github+json',
              'X-GitHub-Api-Version': '2022-11-28',
            },
          },
        );

        if (!branchResponse.ok) {
          // Try default branch if the specified one doesn't exist
          if (sourceBranch !== 'main' || !fromBranch) {
            const repoResponse = await fetch(
              `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
              {
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                  Accept: 'application/vnd.github+json',
                  'X-GitHub-Api-Version': '2022-11-28',
                },
              },
            );
            if (repoResponse.ok) {
              const repoData = (await repoResponse.json()) as { default_branch: string };
              const defaultBranchResponse = await fetch(
                `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${encodeURIComponent(repoData.default_branch)}`,
                {
                  headers: {
                    Authorization: `Bearer ${accessToken}`,
                    Accept: 'application/vnd.github+json',
                    'X-GitHub-Api-Version': '2022-11-28',
                  },
                },
              );
              if (defaultBranchResponse.ok) {
                const refData = (await defaultBranchResponse.json()) as {
                  object: { sha: string };
                };
                sourceSha = refData.object.sha;
              }
            }
          }

          if (!sourceSha) {
            const errorText = await branchResponse.text();
            return {
              success: false,
              error: `Could not find source branch '${fromBranch || 'main'}': ${branchResponse.status} - ${errorText}`,
            };
          }
        } else {
          const refData = (await branchResponse.json()) as { object: { sha: string } };
          sourceSha = refData.object.sha;
        }
      }

      // Create the new branch reference
      const response = await fetch(
        `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/vnd.github+json',
            'Content-Type': 'application/json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
          body: JSON.stringify({
            ref: `refs/heads/${branch}`,
            sha: sourceSha,
          }),
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `GitHub API error: ${response.status} ${response.statusText} - ${errorText}`,
        };
      }

      const ref = (await response.json()) as {
        ref: string;
        object: { sha: string };
      };

      return {
        success: true,
        output: {
          branch: branch,
          ref: ref.ref,
          sha: ref.object.sha,
          url: `https://github.com/${owner}/${repo}/tree/${branch}`,
        },
        metadata: { branch, sha: ref.object.sha, owner, repo },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `GitHub create branch failed: ${msg}` };
    }
  },
});
