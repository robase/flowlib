/**
 * asana.list_projects — List projects in an Asana workspace
 *
 * Retrieves projects in a given workspace. Supports limiting the number
 * of results returned. Requires an Asana OAuth2 credential.
 */

import { defineAction } from '@flowlib/action-kit';
import { ASANA_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const ASANA_API = 'https://app.asana.com/api/1.0';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Asana credential is required'),
  workspaceGid: z.string().min(1, 'Workspace GID is required'),
  limit: z.number().int().min(1).max(100).optional().default(50),
});

export const asanaListProjectsAction = defineAction({
  id: 'asana.list_projects',
  name: 'List Projects',
  description:
    'List projects in an Asana workspace (GET /projects?workspace={gid}). Use when the user needs to find project GIDs before listing or creating tasks.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '[{"gid": "12345", "name": "Q1 Launch", "resource_type": "project"}]\n' +
    '```',
  provider: ASANA_PROVIDER,
  actionCategory: 'read',

  credential: {
    required: true,
    type: 'oauth2',
    oauth2Provider: 'asana',
    description: 'Asana OAuth2 credential',
  },

  params: {
    schema: paramsSchema,
    fields: [
      {
        name: 'credentialId',
        label: 'Asana Credential',
        type: 'text',
        required: true,
        description: 'Asana OAuth2 credential for authentication',
        aiProvided: false,
      },
      {
        name: 'workspaceGid',
        label: 'Workspace GID',
        type: 'text',
        required: true,
        placeholder: 'e.g. 1234567890',
        description:
          'The GID of the workspace to list projects from. Use List Workspaces to find workspace GIDs.',
        aiProvided: true,
      },
      {
        name: 'limit',
        label: 'Limit',
        type: 'number',
        defaultValue: 50,
        description: 'Maximum number of projects to return (1–100).',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['asana', 'projects', 'list', 'project-management'],

  async execute(params, context) {
    const { credentialId, workspaceGid, limit } = params;

    let credential = context.credential;
    if (!credential && context.functions?.getCredential) {
      credential = await context.functions.getCredential(credentialId);
    }
    if (!credential) {
      return {
        success: false,
        error: `Credential not found: ${credentialId}. Please create an Asana OAuth2 credential.`,
      };
    }

    const accessToken =
      (credential.config?.accessToken as string) ?? (credential.config?.token as string);
    if (!accessToken) {
      return {
        success: false,
        error: 'No valid access token in credential. Please re-authorize the Asana credential.',
      };
    }

    context.logger.debug('Listing Asana projects', { workspaceGid, limit });

    try {
      const url = `${ASANA_API}/projects?workspace=${encodeURIComponent(workspaceGid)}&limit=${limit}`;
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errText = await response.text();
        return { success: false, error: `Asana API error (${response.status}): ${errText}` };
      }

      const result = (await response.json()) as { data?: unknown };
      return { success: true, output: result.data ?? result };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Asana request failed: ${msg}` };
    }
  },
});
