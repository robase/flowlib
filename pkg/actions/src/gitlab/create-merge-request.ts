/**
 * gitlab.create_merge_request — Create a GitLab merge request
 *
 * Creates a new merge request in a GitLab project. Supports source/target
 * branches, title, and description. Supports both gitlab.com and
 * self-hosted instances via the baseUrl param.
 * Requires a GitLab OAuth2 credential or personal access token.
 */

import { defineAction } from '@flowlib/action-kit';
import { GITLAB_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'GitLab credential is required'),
  baseUrl: z.string().optional().default('https://gitlab.com'),
  projectId: z.string().min(1, 'Project ID is required'),
  sourceBranch: z.string().min(1, 'Source branch is required'),
  targetBranch: z.string().optional().default('main'),
  title: z.string().min(1, 'Merge request title is required'),
  description: z.string().optional().default(''),
});

export const gitlabCreateMergeRequestAction = defineAction({
  id: 'gitlab.create_merge_request',
  name: 'Create Merge Request',
  description:
    'Create a merge request in a GitLab project (POST /api/v4/projects/:id/merge_requests). Use when the user wants to open a merge request for code review. ' +
    'Call with `projectId`, `sourceBranch`, `targetBranch`, and `title`; optionally include `description`.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"mergeRequestId": 1, "mergeRequestIid": 10, "url": "https://gitlab.com/group/project/-/merge_requests/10", "title": "Add feature", "state": "opened", "sourceBranch": "feature/x", "targetBranch": "main"}\n' +
    '```',
  provider: GITLAB_PROVIDER,
  actionCategory: 'write',

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
        name: 'sourceBranch',
        label: 'Source Branch',
        type: 'text',
        required: true,
        placeholder: 'feature/my-feature',
        description: 'Branch to merge from',
        aiProvided: true,
      },
      {
        name: 'targetBranch',
        label: 'Target Branch',
        type: 'text',
        required: true,
        defaultValue: 'main',
        placeholder: 'main',
        description: 'Branch to merge into (default: main)',
        aiProvided: true,
      },
      {
        name: 'title',
        label: 'Title',
        type: 'text',
        required: true,
        placeholder: 'Add new feature',
        description: 'Merge request title',
        aiProvided: true,
      },
      {
        name: 'description',
        label: 'Description',
        type: 'textarea',
        placeholder: 'Describe the changes...',
        description:
          'Merge request description (Markdown supported). Supports template expressions ({{ variable }}).',
        aiProvided: true,
      },
    ],
  },

  tags: ['gitlab', 'merge-request', 'pull-request', 'development', 'oauth2'],

  async execute(params, context) {
    const { credentialId, baseUrl, projectId, sourceBranch, targetBranch, title, description } =
      params;

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

    context.logger.debug('Creating GitLab merge request', {
      apiBase,
      projectId,
      sourceBranch,
      targetBranch,
      title,
    });

    try {
      const mrBody: Record<string, unknown> = {
        source_branch: sourceBranch,
        target_branch: targetBranch,
        title,
      };
      if (description) {
        mrBody.description = description;
      }

      const response = await fetch(
        `${apiBase}/api/v4/projects/${encodedProjectId}/merge_requests`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(mrBody),
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `GitLab API error: ${response.status} ${response.statusText} - ${errorText}`,
        };
      }

      const mr = (await response.json()) as {
        id: number;
        iid: number;
        title: string;
        description: string | null;
        state: string;
        web_url: string;
        source_branch: string;
        target_branch: string;
        author: { username: string };
        created_at: string;
      };

      return {
        success: true,
        output: {
          mergeRequestId: mr.id,
          mergeRequestIid: mr.iid,
          url: mr.web_url,
          title: mr.title,
          state: mr.state,
          sourceBranch: mr.source_branch,
          targetBranch: mr.target_branch,
          author: mr.author.username,
          createdAt: mr.created_at,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to create GitLab merge request: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
});
