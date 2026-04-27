/**
 * github.create_issue — Create a GitHub issue
 *
 * Creates a new issue in a GitHub repository. Supports title, body,
 * labels, assignees, and milestone assignment.
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
  title: z.string().min(1, 'Issue title is required'),
  body: z.string().optional().default(''),
  labels: z.array(z.string()).optional().default([]),
  assignees: z.array(z.string()).optional().default([]),
  milestone: z.number().int().positive().optional(),
});

export const githubCreateIssueAction = defineAction({
  id: 'github.create_issue',
  name: 'Create Issue',
  description:
    'Create a new issue in a GitHub repository (POST /repos/{owner}/{repo}/issues). Use when the user wants to file a bug report, feature request, or task.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"number": 1347, "title": "Found a bug", "state": "open", "html_url": "https://github.com/octocat/hello-world/issues/1347"}\n' +
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
        placeholder: 'Bug: something is broken',
        description: 'Issue title',
        aiProvided: true,
      },
      {
        name: 'body',
        label: 'Body',
        type: 'textarea',
        placeholder: 'Describe the issue in detail...',
        description: 'Issue body (Markdown supported). Supports template expressions.',
        aiProvided: true,
      },
      {
        name: 'labels',
        label: 'Labels',
        type: 'json',
        defaultValue: [],
        description: 'Label names to apply, e.g. ["bug", "urgent"]',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'assignees',
        label: 'Assignees',
        type: 'json',
        defaultValue: [],
        description: 'GitHub usernames to assign, e.g. ["octocat"]',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'milestone',
        label: 'Milestone',
        type: 'number',
        description:
          'Milestone number (integer) to associate with the issue. ' +
          'Use the GitHub API to list milestones and get milestone numbers — do not guess.',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['github', 'issue', 'bug', 'development', 'project-management', 'oauth2'],

  async execute(params, context) {
    const { credentialId, owner, repo, title, body, labels, assignees, milestone } = params;

    // Resolve credential
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

    context.logger.debug('Creating GitHub issue', { owner, repo, title });

    try {
      const issueBody: Record<string, unknown> = { title };
      if (body) {
        issueBody.body = body;
      }
      if (labels.length > 0) {
        issueBody.labels = labels;
      }
      if (assignees.length > 0) {
        issueBody.assignees = assignees;
      }
      if (milestone) {
        issueBody.milestone = milestone;
      }

      const response = await fetch(
        `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/vnd.github+json',
            'Content-Type': 'application/json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
          body: JSON.stringify(issueBody),
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
        state: string;
        labels: Array<{ name: string }>;
        assignees: Array<{ login: string }>;
        user: { login: string };
        created_at: string;
      };

      return {
        success: true,
        output: {
          issueNumber: issue.number,
          url: issue.html_url,
          title: issue.title,
          state: issue.state,
          labels: issue.labels.map((l) => l.name),
          assignees: issue.assignees.map((a) => a.login),
          createdBy: issue.user.login,
          createdAt: issue.created_at,
        },
        metadata: {
          issueNumber: issue.number,
          url: issue.html_url,
          owner,
          repo,
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `GitHub create issue failed: ${msg}` };
    }
  },
});
