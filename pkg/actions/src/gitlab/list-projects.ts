/**
 * gitlab.list_projects — List GitLab projects
 *
 * Lists projects the authenticated user has access to.
 * Supports both gitlab.com and self-hosted instances via the baseUrl param.
 * Requires a GitLab OAuth2 credential or personal access token.
 */

import { defineAction } from '@flowlib/action-kit';
import { GITLAB_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'GitLab credential is required'),
  baseUrl: z.string().optional().default('https://gitlab.com'),
  perPage: z.number().int().min(1).max(100).optional().default(20),
});

export const gitlabListProjectsAction = defineAction({
  id: 'gitlab.list_projects',
  name: 'List Projects',
  description:
    'List GitLab projects the authenticated user has access to (GET /api/v4/projects?membership=true). Use when the user needs to discover available repositories or find a project ID. ' +
    'No required params beyond credentials; optionally set `perPage` (default 20).\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"projects": [{"id": 1, "name": "my-app", "fullPath": "group/my-app", "url": "https://gitlab.com/group/my-app", "visibility": "private", "defaultBranch": "main"}], "totalCount": 5}\n' +
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
        name: 'perPage',
        label: 'Per Page',
        type: 'number',
        defaultValue: 20,
        description: 'Number of projects to return per page (1–100)',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['gitlab', 'projects', 'repositories', 'development', 'oauth2'],

  async execute(params, context) {
    const { credentialId, baseUrl, perPage } = params;

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

    context.logger.debug('Listing GitLab projects', { apiBase, perPage });

    try {
      const response = await fetch(
        `${apiBase}/api/v4/projects?membership=true&per_page=${perPage}`,
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

      const projects = (await response.json()) as Array<{
        id: number;
        name: string;
        name_with_namespace: string;
        path_with_namespace: string;
        web_url: string;
        description: string | null;
        visibility: string;
        default_branch: string;
        star_count: number;
        forks_count: number;
        open_issues_count: number;
        created_at: string;
        last_activity_at: string;
      }>;

      const totalFromHeader = response.headers.get('x-total');

      return {
        success: true,
        output: {
          projects: projects.map((p) => ({
            id: p.id,
            name: p.name,
            fullPath: p.path_with_namespace,
            fullName: p.name_with_namespace,
            url: p.web_url,
            description: p.description,
            visibility: p.visibility,
            defaultBranch: p.default_branch,
            stars: p.star_count,
            forks: p.forks_count,
            openIssues: p.open_issues_count,
            createdAt: p.created_at,
            lastActivityAt: p.last_activity_at,
          })),
          totalCount: totalFromHeader ? parseInt(totalFromHeader, 10) : projects.length,
          returnedCount: projects.length,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to list GitLab projects: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
});
