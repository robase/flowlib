/**
 * jira.list_projects — List Jira projects
 *
 * Returns projects accessible to the authenticated user in the given
 * Jira Cloud instance.  Uses the v3 project search endpoint.
 * Requires a Jira OAuth2 credential and the Atlassian Cloud ID.
 */

import { defineAction } from '@flowlib/action-kit';
import { JIRA_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Jira credential is required'),
  cloudId: z.string().min(1, 'Cloud ID is required'),
});

export const jiraListProjectsAction = defineAction({
  id: 'jira.list_projects',
  name: 'List Projects',
  description:
    'List Jira projects accessible to the authenticated user (GET /rest/api/3/project/search). Use when the user needs to find project keys or IDs before creating or searching issues.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '[{"id": "10000", "key": "PROJ", "name": "My Project"}]\n' +
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
    ],
  },

  tags: ['jira', 'atlassian', 'issues', 'project-management', 'list', 'read'],

  async execute(params, context) {
    const { credentialId, cloudId } = params;

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
      const response = await fetch(`${baseUrl}/rest/api/3/project/search`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        const errText = await response.text();
        return { success: false, error: `Jira API error (${response.status}): ${errText}` };
      }

      const data = (await response.json()) as { values?: Record<string, unknown>[] };
      const projects = (data.values ?? []).map((p) => ({
        id: p.id,
        key: p.key,
        name: p.name,
      }));

      return { success: true, output: projects };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Jira request failed: ${msg}` };
    }
  },
});
