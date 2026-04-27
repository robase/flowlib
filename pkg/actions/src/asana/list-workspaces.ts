/**
 * asana.list_workspaces — List workspaces in Asana
 *
 * Retrieves all workspaces accessible by the authenticated user via the
 * Asana REST API. Useful for discovering workspace GIDs before listing
 * projects or tasks.
 * Requires an Asana OAuth2 credential.
 */

import { defineAction } from '@flowlib/action-kit';
import { ASANA_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const ASANA_API = 'https://app.asana.com/api/1.0';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Asana credential is required'),
});

export const asanaListWorkspacesAction = defineAction({
  id: 'asana.list_workspaces',
  name: 'List Workspaces',
  description:
    'List all workspaces accessible by the authenticated Asana user (GET /workspaces). Use when the user needs to discover workspace GIDs before listing projects or tasks.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '[{"gid": "12345", "name": "My Company", "resource_type": "workspace"}]\n' +
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
    ],
  },

  tags: ['asana', 'workspaces', 'list', 'project-management'],

  async execute(params, context) {
    const { credentialId } = params;

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

    context.logger.debug('Listing Asana workspaces');

    try {
      const response = await fetch(`${ASANA_API}/workspaces`, {
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
