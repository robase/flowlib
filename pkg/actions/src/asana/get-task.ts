/**
 * asana.get_task — Get a single Asana task
 *
 * Retrieves the full details of a single task by its GID using the
 * Asana REST API. Requires an Asana OAuth2 credential.
 */

import { defineAction } from '@flowlib/action-kit';
import { ASANA_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const ASANA_API = 'https://app.asana.com/api/1.0';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Asana credential is required'),
  taskGid: z.string().min(1, 'Task GID is required'),
});

export const asanaGetTaskAction = defineAction({
  id: 'asana.get_task',
  name: 'Get Task',
  description:
    'Get the full details of a single Asana task (GET /tasks/{task_gid}). Use when the user wants to view all information about a specific task including notes, subtasks, and custom fields.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"gid": "12345", "name": "Design review", "notes": "Review the mockups", "completed": false, "due_on": "2024-03-01", "assignee": {"name": "Alice"}}\n' +
    '```',
  provider: ASANA_PROVIDER,
  actionCategory: 'read',

  credential: {
    required: true,
    type: 'oauth2',
    oauth2Provider: 'asana',
    requiredScopes: ['tasks:read'],
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
        name: 'taskGid',
        label: 'Task GID',
        type: 'text',
        required: true,
        placeholder: 'e.g. 1234567890',
        description: 'The GID of the task to retrieve.',
        aiProvided: true,
      },
    ],
  },

  tags: ['asana', 'tasks', 'get', 'project-management'],

  async execute(params, context) {
    const { credentialId, taskGid } = params;

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

    context.logger.debug('Getting Asana task', { taskGid });

    try {
      const response = await fetch(`${ASANA_API}/tasks/${encodeURIComponent(taskGid)}`, {
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
