/**
 * asana.update_task — Update an existing Asana task
 *
 * Updates fields on a task identified by its GID. All fields are optional;
 * only provided values are sent to the API. Requires an Asana OAuth2
 * credential.
 */

import { defineAction } from '@flowlib/action-kit';
import { ASANA_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const ASANA_API = 'https://app.asana.com/api/1.0';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Asana credential is required'),
  taskGid: z.string().min(1, 'Task GID is required'),
  name: z.string().optional().default(''),
  notes: z.string().optional().default(''),
  dueOn: z.string().optional().default(''),
  completed: z.boolean().optional(),
  assignee: z.string().optional().default(''),
});

export const asanaUpdateTaskAction = defineAction({
  id: 'asana.update_task',
  name: 'Update Task',
  description:
    "Update an existing Asana task (PUT /tasks/{task_gid}). Use when the user wants to modify a task's name, notes, due date, completion status, or assignee.\n\n" +
    'Example response:\n' +
    '```json\n' +
    '{"gid": "12345", "name": "Updated task", "completed": true, "due_on": "2024-03-01", "assignee": {"name": "Alice"}}\n' +
    '```',
  provider: ASANA_PROVIDER,
  actionCategory: 'write',

  credential: {
    required: true,
    type: 'oauth2',
    oauth2Provider: 'asana',
    requiredScopes: ['tasks:write'],
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
        description: 'The GID of the task to update.',
        aiProvided: true,
      },
      {
        name: 'name',
        label: 'Name',
        type: 'text',
        placeholder: 'New task name',
        description: 'Updated task name. Leave empty to keep unchanged.',
        aiProvided: true,
      },
      {
        name: 'notes',
        label: 'Notes',
        type: 'textarea',
        placeholder: 'Updated notes...',
        description: 'Updated plain-text notes / description.',
        aiProvided: true,
      },
      {
        name: 'dueOn',
        label: 'Due Date',
        type: 'text',
        placeholder: 'YYYY-MM-DD',
        description: 'Updated due date in YYYY-MM-DD format.',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'completed',
        label: 'Completed',
        type: 'boolean',
        description: 'Mark the task as completed or incomplete.',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'assignee',
        label: 'Assignee',
        type: 'text',
        placeholder: 'User GID or email',
        description: 'Updated assignee specified as a user GID or email address.',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['asana', 'tasks', 'update', 'project-management'],

  async execute(params, context) {
    const { credentialId, taskGid, name, notes, dueOn, completed, assignee } = params;

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

    context.logger.debug('Updating Asana task', { taskGid });

    const taskData: Record<string, unknown> = {};
    if (name) {
      taskData.name = name;
    }
    if (notes) {
      taskData.notes = notes;
    }
    if (dueOn) {
      taskData.due_on = dueOn;
    }
    if (completed !== undefined) {
      taskData.completed = completed;
    }
    if (assignee) {
      taskData.assignee = assignee;
    }

    try {
      const response = await fetch(`${ASANA_API}/tasks/${encodeURIComponent(taskGid)}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ data: taskData }),
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
