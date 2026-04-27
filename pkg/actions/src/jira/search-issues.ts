/**
 * jira.search_issues — Search Jira issues using JQL
 *
 * Searches for issues in the given Jira Cloud instance using JQL (Jira Query
 * Language).  Supports pagination and field selection.
 * Requires a Jira OAuth2 credential and the Atlassian Cloud ID.
 */

import { defineAction } from '@flowlib/action-kit';
import { JIRA_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Jira credential is required'),
  cloudId: z.string().min(1, 'Cloud ID is required'),
  jql: z.string().min(1, 'JQL query is required'),
  maxResults: z.number().int().min(1).max(100).optional().default(25),
  startAt: z.number().int().min(0).optional().default(0),
  fields: z.string().optional().default('summary,status,priority,assignee'),
});

export const jiraSearchIssuesAction = defineAction({
  id: 'jira.search_issues',
  name: 'Search Issues',
  description:
    'Search Jira issues using JQL (POST /rest/api/3/search). Use when the user wants to find issues matching specific criteria like project, status, assignee, or custom fields.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"issues": [{"id": "10001", "key": "PROJ-123", "fields": {"summary": "Fix login", "status": {"name": "Done"}}}], "total": 42, "maxResults": 25}\n' +
    '```',
  provider: JIRA_PROVIDER,
  actionCategory: 'read',

  credential: {
    required: true,
    type: 'oauth2',
    oauth2Provider: 'jira',
    requiredScopes: ['read:jira-work'],
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
        name: 'jql',
        label: 'JQL Query',
        type: 'textarea',
        required: true,
        placeholder: 'project = MYPROJ AND status = "In Progress"',
        description: 'JQL query to search issues. See Jira docs for syntax.',
        aiProvided: true,
      },
      {
        name: 'maxResults',
        label: 'Max Results',
        type: 'number',
        defaultValue: 25,
        description: 'Maximum number of issues to return (1–100)',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'startAt',
        label: 'Start At',
        type: 'number',
        defaultValue: 0,
        description: 'Index of the first result to return (for pagination)',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'fields',
        label: 'Fields',
        type: 'text',
        defaultValue: 'summary,status,priority,assignee',
        description: 'Comma-separated list of fields to include in results',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['jira', 'atlassian', 'issues', 'project-management', 'search', 'jql'],

  async execute(params, context) {
    const { credentialId, cloudId, jql, maxResults, startAt, fields } = params;

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
    const fieldList = fields
      ? fields.split(',').map((f) => f.trim())
      : ['summary', 'status', 'priority', 'assignee'];

    try {
      const response = await fetch(`${baseUrl}/rest/api/3/search`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          jql,
          maxResults,
          startAt,
          fields: fieldList,
        }),
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
