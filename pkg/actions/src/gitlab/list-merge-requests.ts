/**
 * gitlab.list_merge_requests — List merge requests in a GitLab project
 *
 * Lists merge requests for a given project. Supports filtering by state.
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
  state: z.enum(['opened', 'closed', 'merged', 'all']).optional().default('opened'),
});

export const gitlabListMergeRequestsAction = defineAction({
  id: 'gitlab.list_merge_requests',
  name: 'List Merge Requests',
  description:
    'List merge requests in a GitLab project (GET /api/v4/projects/:id/merge_requests). Use when the user wants to review open MRs, check CI status, or audit merged code. ' +
    'Call with `projectId`; optionally filter by `state` (opened/closed/merged/all) and set `perPage` (default 20).\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"mergeRequests": [{"iid": 10, "title": "Add feature", "state": "opened", "url": "https://gitlab.com/g/p/-/merge_requests/10", "sourceBranch": "feature/x", "targetBranch": "main"}], "totalCount": 8}\n' +
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
          { label: 'Merged', value: 'merged' },
          { label: 'All', value: 'all' },
        ],
        description: 'Filter merge requests by state',
        aiProvided: true,
      },
      {
        name: 'perPage',
        label: 'Per Page',
        type: 'number',
        defaultValue: 20,
        description: 'Number of merge requests to return per page (1–100)',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['gitlab', 'merge-request', 'pull-request', 'development', 'oauth2'],

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

    context.logger.debug('Listing GitLab merge requests', { apiBase, projectId, state, perPage });

    try {
      const response = await fetch(
        `${apiBase}/api/v4/projects/${encodedProjectId}/merge_requests?per_page=${perPage}&state=${state}`,
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

      const mergeRequests = (await response.json()) as Array<{
        id: number;
        iid: number;
        title: string;
        description: string | null;
        state: string;
        web_url: string;
        source_branch: string;
        target_branch: string;
        author: { username: string };
        assignees: Array<{ username: string }>;
        labels: string[];
        merged_by: { username: string } | null;
        created_at: string;
        updated_at: string;
        merged_at: string | null;
      }>;

      const totalFromHeader = response.headers.get('x-total');

      return {
        success: true,
        output: {
          mergeRequests: mergeRequests.map((mr) => ({
            id: mr.id,
            iid: mr.iid,
            title: mr.title,
            description: mr.description,
            state: mr.state,
            url: mr.web_url,
            sourceBranch: mr.source_branch,
            targetBranch: mr.target_branch,
            author: mr.author.username,
            assignees: mr.assignees.map((a) => a.username),
            labels: mr.labels,
            mergedBy: mr.merged_by?.username ?? null,
            createdAt: mr.created_at,
            updatedAt: mr.updated_at,
            mergedAt: mr.merged_at,
          })),
          totalCount: totalFromHeader ? parseInt(totalFromHeader, 10) : mergeRequests.length,
          returnedCount: mergeRequests.length,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to list GitLab merge requests: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
});
