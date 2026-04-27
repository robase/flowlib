/**
 * github.create_release — Create a GitHub release
 *
 * Creates a new release in a repository with a tag, title, body,
 * and optional pre-release / draft flags.
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
  tagName: z.string().min(1, 'Tag name is required'),
  name: z.string().optional().default(''),
  body: z.string().optional().default(''),
  targetCommitish: z.string().optional().default(''),
  draft: z.boolean().optional().default(false),
  prerelease: z.boolean().optional().default(false),
  generateReleaseNotes: z.boolean().optional().default(false),
});

export const githubCreateReleaseAction = defineAction({
  id: 'github.create_release',
  name: 'Create Release',
  description:
    'Create a new release in a GitHub repository (POST /repos/{owner}/{repo}/releases). Use when you need to publish a tagged release with release notes.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"id": 1, "tag_name": "v1.0.0", "name": "Version 1.0", "html_url": "https://github.com/octocat/hello-world/releases/tag/v1.0.0", "draft": false}\n' +
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
        name: 'tagName',
        label: 'Tag Name',
        type: 'text',
        required: true,
        placeholder: 'v1.0.0',
        description: 'The name of the tag for the release',
        aiProvided: true,
      },
      {
        name: 'name',
        label: 'Release Title',
        type: 'text',
        placeholder: 'Version 1.0.0',
        description: 'Title of the release (defaults to tag name)',
        aiProvided: true,
      },
      {
        name: 'body',
        label: 'Release Notes',
        type: 'textarea',
        placeholder: "## What's Changed\n- Feature A\n- Bug fix B",
        description: 'Release notes body (Markdown supported)',
        aiProvided: true,
      },
      {
        name: 'targetCommitish',
        label: 'Target Branch / SHA',
        type: 'text',
        placeholder: 'main',
        description: 'Branch or commit SHA to tag (uses default branch if empty)',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'draft',
        label: 'Draft',
        type: 'boolean',
        defaultValue: false,
        description: 'Create as a draft release',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'prerelease',
        label: 'Pre-release',
        type: 'boolean',
        defaultValue: false,
        description: 'Mark as a pre-release',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'generateReleaseNotes',
        label: 'Auto-generate Release Notes',
        type: 'boolean',
        defaultValue: false,
        description: 'Auto-generate release notes from commits',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['github', 'release', 'create', 'tag', 'development', 'oauth2'],

  async execute(params, context) {
    const {
      credentialId,
      owner,
      repo,
      tagName,
      name,
      body,
      targetCommitish,
      draft,
      prerelease,
      generateReleaseNotes,
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

    context.logger.debug('Creating GitHub release', { owner, repo, tagName });

    try {
      const releaseBody: Record<string, unknown> = {
        tag_name: tagName,
        draft,
        prerelease,
        generate_release_notes: generateReleaseNotes,
      };
      if (name) {
        releaseBody.name = name;
      }
      if (body) {
        releaseBody.body = body;
      }
      if (targetCommitish) {
        releaseBody.target_commitish = targetCommitish;
      }

      const response = await fetch(
        `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/vnd.github+json',
            'Content-Type': 'application/json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
          body: JSON.stringify(releaseBody),
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `GitHub API error: ${response.status} ${response.statusText} - ${errorText}`,
        };
      }

      const release = (await response.json()) as {
        id: number;
        html_url: string;
        tag_name: string;
        name: string | null;
        body: string | null;
        draft: boolean;
        prerelease: boolean;
        author: { login: string };
        created_at: string;
        published_at: string | null;
        target_commitish: string;
      };

      return {
        success: true,
        output: {
          releaseId: release.id,
          url: release.html_url,
          tagName: release.tag_name,
          name: release.name,
          body: release.body,
          draft: release.draft,
          prerelease: release.prerelease,
          author: release.author.login,
          targetBranch: release.target_commitish,
          createdAt: release.created_at,
          publishedAt: release.published_at,
        },
        metadata: {
          releaseId: release.id,
          url: release.html_url,
          tagName: release.tag_name,
          owner,
          repo,
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `GitHub create release failed: ${msg}` };
    }
  },
});
