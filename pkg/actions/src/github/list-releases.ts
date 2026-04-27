/**
 * github.list_releases — List releases in a GitHub repository
 *
 * Lists releases for a repository, including tag names, release notes,
 * and asset information. Requires a GitHub OAuth2 credential.
 */

import { defineAction } from '@flowlib/action-kit';
import { GITHUB_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const GITHUB_API_BASE = 'https://api.github.com';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'GitHub credential is required'),
  owner: z.string().min(1, 'Repository owner is required'),
  repo: z.string().min(1, 'Repository name is required'),
  perPage: z.number().int().min(1).max(100).optional().default(30),
});

export const githubListReleasesAction = defineAction({
  id: 'github.list_releases',
  name: 'List Releases',
  description:
    'List releases in a GitHub repository (GET /repos/{owner}/{repo}/releases). Use when you need to browse release history, download assets, or check version tags.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"releases": [{"releaseId": 1, "tagName": "v1.0.0", "name": "Version 1.0", "draft": false, "prerelease": false, "publishedAt": "2024-01-01T00:00:00Z"}], "totalReturned": 1}\n' +
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
        name: 'perPage',
        label: 'Per Page',
        type: 'number',
        defaultValue: 30,
        description: 'Number of releases to return (1–100)',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['github', 'release', 'list', 'tag', 'development', 'oauth2'],

  async execute(params, context) {
    const { credentialId, owner, repo, perPage } = params;

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

    context.logger.debug('Listing GitHub releases', { owner, repo });

    try {
      const url = new URL(
        `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases`,
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

      const releases = (await response.json()) as Array<{
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
        assets: Array<{
          name: string;
          size: number;
          download_count: number;
          browser_download_url: string;
        }>;
      }>;

      return {
        success: true,
        output: {
          releases: releases.map((r) => ({
            releaseId: r.id,
            url: r.html_url,
            tagName: r.tag_name,
            name: r.name,
            body: r.body,
            draft: r.draft,
            prerelease: r.prerelease,
            author: r.author.login,
            createdAt: r.created_at,
            publishedAt: r.published_at,
            assets: r.assets.map((a) => ({
              name: a.name,
              size: a.size,
              downloadCount: a.download_count,
              downloadUrl: a.browser_download_url,
            })),
          })),
          totalReturned: releases.length,
        },
        metadata: { owner, repo, totalReturned: releases.length },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `GitHub list releases failed: ${msg}` };
    }
  },
});
