/**
 * jira.add_comment — Add a comment to a Jira issue
 *
 * Posts a comment on an existing Jira issue.  The comment body is sent
 * in Atlassian Document Format (ADF).
 * Requires a Jira OAuth2 credential and the Atlassian Cloud ID.
 */

import { defineAction } from '@flowlib/action-kit';
import { JIRA_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Jira credential is required'),
  cloudId: z.string().min(1, 'Cloud ID is required'),
  issueIdOrKey: z.string().min(1, 'Issue ID or key is required'),
  body: z.string().min(1, 'Comment body is required'),
});

export const jiraAddCommentAction = defineAction({
  id: 'jira.add_comment',
  name: 'Add Comment',
  description:
    'Add a comment to a Jira issue (POST /rest/api/3/issue/{issueIdOrKey}/comment). Use when the user wants to post a note or update on an existing issue. Text is auto-converted to Atlassian Document Format.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"id": "10001", "author": {"displayName": "Mia"}, "created": "2024-01-15T10:30:00.000+0000"}\n' +
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
        name: 'issueIdOrKey',
        label: 'Issue ID or Key',
        type: 'text',
        required: true,
        placeholder: 'e.g. PROJ-123',
        description: 'The issue key (e.g. PROJ-123) or numeric ID to comment on',
        aiProvided: true,
      },
      {
        name: 'body',
        label: 'Comment',
        type: 'textarea',
        required: true,
        placeholder: 'Write your comment here...',
        description: 'Comment text (plain text, converted to ADF automatically)',
        aiProvided: true,
      },
    ],
  },

  tags: ['jira', 'atlassian', 'issues', 'project-management', 'comment'],

  async execute(params, context) {
    const { credentialId, cloudId, issueIdOrKey, body } = params;

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

    try {
      const response = await fetch(
        `${baseUrl}/rest/api/3/issue/${encodeURIComponent(issueIdOrKey)}/comment`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            body: {
              type: 'doc',
              version: 1,
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: body }],
                },
              ],
            },
          }),
        },
      );

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
