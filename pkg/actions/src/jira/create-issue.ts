/**
 * jira.create_issue — Create a Jira issue
 *
 * Creates a new issue in a Jira project.  The description is sent in
 * Atlassian Document Format (ADF).  Requires a Jira OAuth2 credential
 * and the Atlassian Cloud ID.
 */

import { defineAction } from '@flowlib/action-kit';
import { JIRA_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Jira credential is required'),
  cloudId: z.string().min(1, 'Cloud ID is required'),
  projectKey: z.string().min(1, 'Project key is required'),
  summary: z.string().min(1, 'Summary is required'),
  description: z.string().optional().default(''),
  issueType: z.string().optional().default('Task'),
});

export const jiraCreateIssueAction = defineAction({
  id: 'jira.create_issue',
  name: 'Create Issue',
  description:
    'Create a new Jira issue (POST /rest/api/3/issue). Use when the user wants to file a bug, task, story, or epic in a Jira project. Description is auto-converted to Atlassian Document Format.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"id": "10000", "key": "ED-24", "self": "https://your-domain.atlassian.net/rest/api/3/issue/10000"}\n' +
    '```',
  provider: JIRA_PROVIDER,
  actionCategory: 'write',

  credential: {
    required: true,
    type: 'oauth2',
    oauth2Provider: 'jira',
    requiredScopes: ['write:jira-work'],
    description: 'Jira OAuth2 credential',
  },

  params: {
    schema: paramsSchema,
    fields: [
      {
        name: 'credentialId',
        label: 'Jira Credential',
        type: 'text',
        required: true,
        description: 'Jira OAuth2 credential for authentication',
        aiProvided: false,
      },
      {
        name: 'cloudId',
        label: 'Cloud ID',
        type: 'text',
        required: true,
        placeholder: 'e.g. a1b2c3d4-...',
        description: 'Atlassian Cloud ID. Find at /oauth/token/accessible-resources',
        aiProvided: false,
      },
      {
        name: 'projectKey',
        label: 'Project Key',
        type: 'text',
        required: true,
        placeholder: 'e.g. PROJ',
        description: 'The key of the project to create the issue in (e.g. PROJ)',
        aiProvided: true,
      },
      {
        name: 'summary',
        label: 'Summary',
        type: 'text',
        required: true,
        placeholder: 'Brief summary of the issue',
        description: 'Issue summary / title',
        aiProvided: true,
      },
      {
        name: 'description',
        label: 'Description',
        type: 'textarea',
        placeholder: 'Detailed description of the issue...',
        description: 'Issue description (plain text, converted to ADF automatically)',
        aiProvided: true,
        extended: true,
      },
      {
        name: 'issueType',
        label: 'Issue Type',
        type: 'select',
        defaultValue: 'Task',
        options: [
          { label: 'Task', value: 'Task' },
          { label: 'Bug', value: 'Bug' },
          { label: 'Story', value: 'Story' },
          { label: 'Epic', value: 'Epic' },
          { label: 'Sub-task', value: 'Sub-task' },
        ],
        description: 'The type of issue to create',
        aiProvided: true,
        extended: true,
      },
    ],
  },

  tags: ['jira', 'atlassian', 'issues', 'project-management', 'create'],

  async execute(params, context) {
    const { credentialId, cloudId, projectKey, summary, description, issueType } = params;

    let credential = context.credential;
    if (!credential && context.functions?.getCredential) {
      credential = await context.functions.getCredential(credentialId);
    }
    if (!credential) {
      return { success: false, error: `Credential not found: ${credentialId}` };
    }

    const accessToken =
      (credential.config?.accessToken as string) ?? (credential.config?.token as string);
    if (!accessToken) {
      return { success: false, error: 'No valid access token found on credential.' };
    }

    const baseUrl = `https://api.atlassian.com/ex/jira/${encodeURIComponent(cloudId)}`;

    const fields: Record<string, unknown> = {
      project: { key: projectKey },
      summary,
      issuetype: { name: issueType },
    };

    if (description) {
      fields.description = {
        type: 'doc',
        version: 1,
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: description }],
          },
        ],
      };
    }

    try {
      const response = await fetch(`${baseUrl}/rest/api/3/issue`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ fields }),
      });

      if (!response.ok) {
        const errText = await response.text();
        return { success: false, error: `Jira API error (${response.status}): ${errText}` };
      }

      const data = await response.json();
      return { success: true, output: data };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Jira request failed: ${msg}` };
    }
  },
});
