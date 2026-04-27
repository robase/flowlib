/**
 * github.update_issue — Update a GitHub issue
 *
 * Updates an existing issue's title, body, state, labels, assignees,
 * or milestone. Requires a GitHub OAuth2 credential with repo scope.
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
  title: z.string().optional(),
  body: z.string().optional(),
  state: z.enum(['open', 'closed']).optional(),
  stateReason: z.enum(['completed', 'not_planned', 'reopened']).optional(),
  labels: z.array(z.string()).optional(),
  assignees: z.array(z.string()).optional(),
  milestone: z.number().int().positive().nullable().optional(),
});

export const githubUpdateIssueAction = defineAction({
  id: 'github.update_issue',
  name: 'Update Issue',
  description:
    'Update an existing GitHub issue (PATCH /repos/{owner}/{repo}/issues/{issue_number}). Use when you need to change the title, body, state, labels, assignees, or milestone.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"number": 1347, "title": "Updated title", "state": "closed", "html_url": "https://github.com/octocat/hello-world/issues/1347"}\n' +
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
        label: 'Issue Number',
        type: 'number',
        required: true,
        description: 'The issue number to update',
        aiProvided: true,
      },
      {
        name: 'title',
        label: 'Title',
        type: 'text',
        placeholder: 'Updated title',
        description: 'New issue title (leave empty to keep current)',
        aiProvided: true,
      },
      {
        name: 'body',
        label: 'Body',
        type: 'textarea',
        placeholder: 'Updated description...',
        description: 'New issue body (leave empty to keep current)',
        aiProvided: true,
      },
      {
        name: 'state',
        label: 'State',
        type: 'select',
        options: [
          { label: 'Open', value: 'open' },
          { label: 'Closed', value: 'closed' },
        ],
        description: 'Issue state',
        aiProvided: true,
      },
      {
        name: 'stateReason',
        label: 'State Reason',
        type: 'select',
        options: [
          { label: 'Completed', value: 'completed' },
          { label: 'Not Planned', value: 'not_planned' },
          { label: 'Reopened', value: 'reopened' },
        ],
        description: 'Reason for closing/reopening (only when changing state)',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'labels',
        label: 'Labels',
        type: 'json',
        description: 'Replace labels with this list, e.g. ["bug", "urgent"]',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'assignees',
        label: 'Assignees',
        type: 'json',
        description: 'Replace assignees with this list, e.g. ["octocat"]',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'milestone',
        label: 'Milestone',
        type: 'number',
        description: 'Milestone number (set to null to remove)',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['github', 'issue', 'update', 'edit', 'development', 'oauth2'],

  async execute(params, context) {
    const { credentialId, owner, repo, issueNumber, ...updates } = params;

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

    // Build update body, omitting undefined fields
    const updateBody: Record<string, unknown> = {};
    if (updates.title !== undefined) {
      updateBody.title = updates.title;
    }
    if (updates.body !== undefined) {
      updateBody.body = updates.body;
    }
    if (updates.state !== undefined) {
      updateBody.state = updates.state;
    }
    if (updates.stateReason !== undefined) {
      updateBody.state_reason = updates.stateReason;
    }
    if (updates.labels !== undefined) {
      updateBody.labels = updates.labels;
    }
    if (updates.assignees !== undefined) {
      updateBody.assignees = updates.assignees;
    }
    if (updates.milestone !== undefined) {
      updateBody.milestone = updates.milestone;
    }

    if (Object.keys(updateBody).length === 0) {
      return {
        success: false,
        error: 'No update fields provided. Specify at least one field to update.',
      };
    }

    context.logger.debug('Updating GitHub issue', { owner, repo, issueNumber });

    try {
      const response = await fetch(
        `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${issueNumber}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/vnd.github+json',
            'Content-Type': 'application/json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
          body: JSON.stringify(updateBody),
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
        number: number;
        html_url: string;
        title: string;
        state: string;
        labels: Array<{ name: string }>;
        assignees: Array<{ login: string }>;
        updated_at: string;
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
          updatedAt: issue.updated_at,
        },
        metadata: { issueNumber: issue.number, url: issue.html_url, owner, repo },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `GitHub update issue failed: ${msg}` };
    }
  },
});
