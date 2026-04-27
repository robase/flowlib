/**
 * github.get_issue — Get a GitHub issue by number
 *
 * Retrieves detailed information about a specific issue including
 * title, body, state, labels, assignees, comments count, and more.
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
});

export const githubGetIssueAction = defineAction({
  id: 'github.get_issue',
  name: 'Get Issue',
  description:
    'Get detailed information about a specific GitHub issue (GET /repos/{owner}/{repo}/issues/{issue_number}). Use when you need the full body, labels, assignees, and timeline of a single issue.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"number": 1347, "title": "Found a bug", "state": "open", "body": "...", "user": "octocat", "labels": ["bug"], "assignees": ["octocat"]}\n' +
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
        label: 'Issue Number',
        type: 'number',
        required: true,
        placeholder: '42',
        description: 'The issue number to retrieve',
        aiProvided: true,
      },
    ],
  },

  tags: ['github', 'issue', 'get', 'development', 'oauth2'],

  async execute(params, context) {
    const { credentialId, owner, repo, issueNumber } = params;

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

    context.logger.debug('Getting GitHub issue', { owner, repo, issueNumber });

    try {
      const response = await fetch(
        `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${issueNumber}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `GitHub API error: ${response.status} ${response.statusText} - ${errorText}`,
        };
      }

      const issue = (await response.json()) as {
        id: number;
        number: number;
        html_url: string;
        title: string;
        body: string | null;
        state: string;
        state_reason: string | null;
        labels: Array<{ name: string; color: string }>;
        assignees: Array<{ login: string }>;
        user: { login: string; avatar_url: string };
        comments: number;
        created_at: string;
        updated_at: string;
        closed_at: string | null;
        milestone: { title: string; number: number } | null;
        locked: boolean;
        pull_request?: { url: string };
      };

      return {
        success: true,
        output: {
          issueNumber: issue.number,
          url: issue.html_url,
          title: issue.title,
          body: issue.body,
          state: issue.state,
          stateReason: issue.state_reason,
          labels: issue.labels.map((l) => l.name),
          assignees: issue.assignees.map((a) => a.login),
          author: issue.user.login,
          commentsCount: issue.comments,
          createdAt: issue.created_at,
          updatedAt: issue.updated_at,
          closedAt: issue.closed_at,
          milestone: issue.milestone ? issue.milestone.title : null,
          locked: issue.locked,
          isPullRequest: !!issue.pull_request,
        },
        metadata: { issueNumber: issue.number, url: issue.html_url, owner, repo },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `GitHub get issue failed: ${msg}` };
    }
  },
});
