/**
 * gitlab.create_issue — Create a GitLab issue
 *
 * Creates a new issue in a GitLab project. Supports title, description,
 * and labels. Supports both gitlab.com and self-hosted instances.
 * Requires a GitLab OAuth2 credential or personal access token.
 */

import { defineAction } from '@flowlib/action-kit';
import { GITLAB_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'GitLab credential is required'),
  baseUrl: z.string().optional().default('https://gitlab.com'),
  projectId: z.string().min(1, 'Project ID is required'),
  title: z.string().min(1, 'Issue title is required'),
  description: z.string().optional().default(''),
  labels: z.string().optional().default(''),
});

export const gitlabCreateIssueAction = defineAction({
  id: 'gitlab.create_issue',
  name: 'Create Issue',
  description:
    'Create a new issue in a GitLab project (POST /api/v4/projects/:id/issues). Use when the user wants to file a bug, task, or feature request. ' +
    'Call with `projectId`, `title`, and optionally `description` and `labels`.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"issueId": 1, "issueIid": 42, "url": "https://gitlab.com/group/project/-/issues/42", "title": "Bug: broken", "state": "opened", "labels": ["bug"]}\n' +
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
        name: 'title',
        label: 'Title',
        type: 'text',
        required: true,
        placeholder: 'Bug: something is broken',
        description: 'Issue title',
        aiProvided: true,
      },
      {
        name: 'description',
        label: 'Description',
        type: 'textarea',
        placeholder: 'Describe the issue in detail...',
        description:
          'Issue description (Markdown supported). Supports template expressions ({{ variable }}).',
        aiProvided: true,
      },
      {
        name: 'labels',
        label: 'Labels',
        type: 'text',
        placeholder: 'bug,urgent',
        description: 'Comma-separated list of label names to apply',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['gitlab', 'issue', 'bug', 'development', 'project-management', 'oauth2'],

  async execute(params, context) {
    const { credentialId, baseUrl, projectId, title, description, labels } = params;

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

    context.logger.debug('Creating GitLab issue', { apiBase, projectId, title });

    try {
      const issueBody: Record<string, unknown> = { title };
      if (description) {
        issueBody.description = description;
      }
      if (labels) {
        issueBody.labels = labels;
      }

      const response = await fetch(`${apiBase}/api/v4/projects/${encodedProjectId}/issues`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(issueBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `GitLab API error: ${response.status} ${response.statusText} - ${errorText}`,
        };
      }

      const issue = (await response.json()) as {
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
      };

      return {
        success: true,
        output: {
          issueId: issue.id,
          issueIid: issue.iid,
          url: issue.web_url,
          title: issue.title,
          state: issue.state,
          labels: issue.labels,
          author: issue.author.username,
          createdAt: issue.created_at,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to create GitLab issue: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
});
