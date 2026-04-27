/**
 * asana.list_tasks — List tasks in an Asana project
 *
 * Retrieves tasks belonging to a given project. Includes name, completion
 * status, due date, assignee, and notes via opt_fields. Requires an Asana
 * OAuth2 credential.
 */

import { defineAction } from '@flowlib/action-kit';
import { ASANA_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const ASANA_API = 'https://app.asana.com/api/1.0';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Asana credential is required'),
  projectGid: z.string().min(1, 'Project GID is required'),
  limit: z.number().int().min(1).max(100).optional().default(50),
});

export const asanaListTasksAction = defineAction({
  id: 'asana.list_tasks',
  name: 'List Tasks',
  description:
    'List tasks in an Asana project (GET /tasks?project={gid}). Use when the user wants to see all tasks, check completion status, or review upcoming work in a project.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '[{"gid": "12345", "name": "Design review", "completed": false, "due_on": "2024-03-01", "assignee": {"name": "Alice"}}]\n' +
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
        name: 'projectGid',
        label: 'Project GID',
        type: 'text',
        required: true,
        placeholder: 'e.g. 1234567890',
        description:
          'The GID of the project to list tasks from. Use List Projects to find project GIDs.',
        aiProvided: true,
      },
      {
        name: 'limit',
        label: 'Limit',
        type: 'number',
        defaultValue: 50,
        description: 'Maximum number of tasks to return (1–100).',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['asana', 'tasks', 'list', 'project-management'],

  async execute(params, context) {
    const { credentialId, projectGid, limit } = params;

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

    context.logger.debug('Listing Asana tasks', { projectGid, limit });

    try {
      const optFields = 'name,completed,due_on,assignee.name,notes';
      const url = `${ASANA_API}/tasks?project=${encodeURIComponent(projectGid)}&limit=${limit}&opt_fields=${encodeURIComponent(optFields)}`;
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
