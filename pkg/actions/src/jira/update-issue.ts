/**
 * jira.update_issue — Update an existing Jira issue
 *
 * Updates fields on an existing Jira issue.  Summary and description can
 * be changed; status transitions require a separate transition API call
 * which is not covered by this action.
 * Requires a Jira OAuth2 credential and the Atlassian Cloud ID.
 */

import { defineAction } from '@flowlib/action-kit';
import { JIRA_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Jira credential is required'),
  cloudId: z.string().min(1, 'Cloud ID is required'),
  issueIdOrKey: z.string().min(1, 'Issue ID or key is required'),
  summary: z.string().optional(),
  description: z.string().optional(),
  status: z.string().optional(),
});

export const jiraUpdateIssueAction = defineAction({
  id: 'jira.update_issue',
  name: 'Update Issue',
  description:
    "Update an existing Jira issue (PUT /rest/api/3/issue/{issueIdOrKey}). Use when the user wants to modify an issue's summary, description, or transition its status. Returns 204 on success for field updates. Status transitions use GET/POST /rest/api/3/issue/{id}/transitions automatically.\n\n" +
    'Example response:\n' +
    '```json\n' +
    '{"issueIdOrKey": "PROJ-123", "updated": true, "fieldsUpdated": ["summary"], "statusTransitioned": false}\n' +
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
        description: 'The issue key (e.g. PROJ-123) or numeric ID to update',
        aiProvided: true,
      },
      {
        name: 'summary',
        label: 'Summary',
        type: 'text',
        placeholder: 'New summary (leave empty to keep current)',
        description: 'Updated issue summary. Leave empty to keep existing.',
        aiProvided: true,
        extended: true,
      },
      {
        name: 'description',
        label: 'Description',
        type: 'textarea',
        placeholder: 'New description (leave empty to keep current)',
        description:
          'Updated description (plain text, converted to ADF). Leave empty to keep existing.',
        aiProvided: true,
        extended: true,
      },
      {
        name: 'status',
        label: 'Status',
        type: 'text',
        placeholder: 'e.g. Done (requires transition API)',
        description:
          'Desired status name. Note: status changes require the transitions API and may not work directly.',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['jira', 'atlassian', 'issues', 'project-management', 'update'],

  async execute(params, context) {
    const { credentialId, cloudId, issueIdOrKey, summary, description, status } = params;

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

    const fields: Record<string, unknown> = {};

    if (summary) {
      fields.summary = summary;
    }

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

    if (Object.keys(fields).length === 0 && !status) {
      return {
        success: false,
        error: 'No fields to update. Provide at least summary or description.',
      };
    }

    try {
      // Update fields if any were provided
      if (Object.keys(fields).length > 0) {
        const response = await fetch(
          `${baseUrl}/rest/api/3/issue/${encodeURIComponent(issueIdOrKey)}`,
          {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify({ fields }),
          },
        );

        if (!response.ok) {
          const errText = await response.text();
          return { success: false, error: `Jira API error (${response.status}): ${errText}` };
        }
      }

      // Status transitions require the transitions API
      if (status) {
        // First, get available transitions
        const transitionsRes = await fetch(
          `${baseUrl}/rest/api/3/issue/${encodeURIComponent(issueIdOrKey)}/transitions`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: 'application/json',
            },
          },
        );

        if (!transitionsRes.ok) {
          const errText = await transitionsRes.text();
          return {
            success: false,
            error: `Failed to get transitions (${transitionsRes.status}): ${errText}`,
          };
        }

        const transitionsData = (await transitionsRes.json()) as {
          transitions?: { id: string; name: string }[];
        };
        const transition = transitionsData.transitions?.find(
          (t) => t.name.toLowerCase() === status.toLowerCase(),
        );

        if (!transition) {
          const available = (transitionsData.transitions ?? []).map((t) => t.name).join(', ');
          return {
            success: false,
            error: `Transition "${status}" not found. Available: ${available || 'none'}`,
          };
        }

        const transitionRes = await fetch(
          `${baseUrl}/rest/api/3/issue/${encodeURIComponent(issueIdOrKey)}/transitions`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify({ transition: { id: transition.id } }),
          },
        );

        if (!transitionRes.ok) {
          const errText = await transitionRes.text();
          return {
            success: false,
            error: `Transition failed (${transitionRes.status}): ${errText}`,
          };
        }
      }

      return {
        success: true,
        output: {
          issueIdOrKey,
          updated: true,
          fieldsUpdated: Object.keys(fields),
          statusTransitioned: !!status,
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Jira request failed: ${msg}` };
    }
  },
});
