/**
 * gitlab.list_issues — List issues in a GitLab project
 *
 * Lists issues for a given project. Supports filtering by state.
 * Supports both gitlab.com and self-hosted instances via the baseUrl param.
 * Requires a GitLab OAuth2 credential or personal access token.
 */

import { defineAction } from '@flowlib/action-kit';
import { GITLAB_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'GitLab credential is required'),
  baseUrl: z.string().optional().default('https://gitlab.com'),
  projectId: z.string().min(1, 'Project ID is required'),
  perPage: z.number().int().min(1).max(100).optional().default(20),
  state: z.enum(['opened', 'closed', 'all']).optional().default('opened'),
});

export const gitlabListIssuesAction = defineAction({
  id: 'gitlab.list_issues',
  name: 'List Issues',
  description:
    'List issues in a GitLab project (GET /api/v4/projects/:id/issues). Use when the user wants to review open bugs, triage tasks, or check issue status. ' +
    'Call with `projectId`; optionally filter by `state` (opened/closed/all) and set `perPage` (default 20).\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"issues": [{"iid": 42, "title": "Bug report", "state": "opened", "url": "https://gitlab.com/g/p/-/issues/42", "labels": ["bug"], "author": "jane"}], "totalCount": 15}\n' +
    '```',
  provider: GITLAB_PROVIDER,
  actionCategory: 'read',

  credential: {
    required: true,
    type: 'oauth2',
    oauth2Provider: 'gitlab',
    description: 'GitLab OAuth2 credential or personal access token',
  },

  params: {
    schema: paramsSchema,
    fields: [
      {
        name: 'credentialId',
        label: 'GitLab Credential',
        type: 'text',
        required: true,
        description: 'GitLab credential for authentication',
        aiProvided: false,
      },
      {
        name: 'baseUrl',
        label: 'GitLab URL',
        type: 'text',
        required: false,
        defaultValue: 'https://gitlab.com',
        placeholder: 'https://gitlab.com',
        description: 'Base URL of the GitLab instance. Defaults to https://gitlab.com.',
        extended: true,
        aiProvided: false,
      },
      {
        name: 'projectId',
        label: 'Project ID',
        type: 'text',
        required: true,
        placeholder: 'my-group/my-project',
        description: 'Project ID (numeric) or URL-encoded path (e.g. "my-group/my-project")',
        aiProvided: true,
      },
      {
        name: 'state',
        label: 'State',
        type: 'select',
        defaultValue: 'opened',
        options: [
          { label: 'Opened', value: 'opened' },
          { label: 'Closed', value: 'closed' },
          { label: 'All', value: 'all' },
        ],
        description: 'Filter issues by state',
        aiProvided: true,
      },
      {
        name: 'perPage',
        label: 'Per Page',
        type: 'number',
        defaultValue: 20,
        description: 'Number of issues to return per page (1–100)',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['gitlab', 'issues', 'development', 'project-management', 'oauth2'],

  async execute(params, context) {
    const { credentialId, baseUrl, projectId, perPage, state } = params;

    let credential = context.credential;
    if (!credential && context.functions?.getCredential) {
      credential = await context.functions.getCredential(credentialId);
    }
    if (!credential) {
      return {
        success: false,
        error: `Credential not found: ${credentialId}. Please create a GitLab credential.`,
      };
    }

    const accessToken =
      (credential.config?.accessToken as string) ?? (credential.config?.token as string);
    if (!accessToken) {
      return {
        success: false,
        error: 'No valid access token in credential. Please re-authorize the GitLab credential.',
      };
    }

    const apiBase = baseUrl || 'https://gitlab.com';
    const encodedProjectId = encodeURIComponent(projectId);

    context.logger.debug('Listing GitLab issues', { apiBase, projectId, state, perPage });

    try {
      const response = await fetch(
        `${apiBase}/api/v4/projects/${encodedProjectId}/issues?per_page=${perPage}&state=${state}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `GitLab API error: ${response.status} ${response.statusText} - ${errorText}`,
        };
      }

      const issues = (await response.json()) as Array<{
        id: number;
        iid: number;
        title: string;
        description: string | null;
        state: string;
        web_url: string;
        labels: string[];
        author: { username: string };
        assignees: Array<{ username: string }>;
        created_at: string;
        updated_at: string;
        closed_at: string | null;
      }>;

      const totalFromHeader = response.headers.get('x-total');

      return {
        success: true,
        output: {
          issues: issues.map((i) => ({
            id: i.id,
            iid: i.iid,
            title: i.title,
            description: i.description,
            state: i.state,
            url: i.web_url,
            labels: i.labels,
            author: i.author.username,
            assignees: i.assignees.map((a) => a.username),
            createdAt: i.created_at,
            updatedAt: i.updated_at,
            closedAt: i.closed_at,
          })),
          totalCount: totalFromHeader ? parseInt(totalFromHeader, 10) : issues.length,
          returnedCount: issues.length,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to list GitLab issues: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
});
