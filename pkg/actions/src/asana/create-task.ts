/**
 * asana.create_task — Create a task in an Asana project
 *
 * Creates a new task in the specified project via the Asana REST API.
 * Supports name, notes, due date, and assignee. Requires an Asana
 * OAuth2 credential.
 */

import { defineAction } from '@flowlib/action-kit';
import { ASANA_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const ASANA_API = 'https://app.asana.com/api/1.0';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Asana credential is required'),
  projectGid: z.string().min(1, 'Project GID is required'),
  name: z.string().min(1, 'Task name is required'),
  notes: z.string().optional().default(''),
  dueOn: z.string().optional().default(''),
  assignee: z.string().optional().default(''),
});

export const asanaCreateTaskAction = defineAction({
  id: 'asana.create_task',
  name: 'Create Task',
  description:
    'Create a new task in an Asana project (POST /tasks). Use when the user wants to add a new task, to-do, or work item to an Asana project.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"gid": "12345", "name": "Design review", "resource_type": "task", "completed": false, "due_on": "2024-03-01", "assignee": {"gid": "67890", "name": "Alice"}}\n' +
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
        name: 'projectGid',
        label: 'Project GID',
        type: 'text',
        required: true,
        placeholder: 'e.g. 1234567890',
        description:
          'The GID of the project to create the task in. Use List Projects to find project GIDs.',
        aiProvided: true,
      },
      {
        name: 'name',
        label: 'Task Name',
        type: 'text',
        required: true,
        placeholder: 'e.g. Design review',
        description: 'Name of the task to create.',
        aiProvided: true,
      },
      {
        name: 'notes',
        label: 'Notes',
        type: 'textarea',
        placeholder: 'Task description or notes...',
        description: 'Plain-text notes / description for the task.',
        aiProvided: true,
      },
      {
        name: 'dueOn',
        label: 'Due Date',
        type: 'text',
        placeholder: 'YYYY-MM-DD',
        description: 'Due date in YYYY-MM-DD format.',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'assignee',
        label: 'Assignee',
        type: 'text',
        placeholder: 'User GID or email',
        description: 'Assignee specified as a user GID or email address.',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['asana', 'tasks', 'create', 'project-management'],

  async execute(params, context) {
    const { credentialId, projectGid, name, notes, dueOn, assignee } = params;

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

    context.logger.debug('Creating Asana task', { projectGid, name });

    const taskData: Record<string, unknown> = {
      name,
      projects: [projectGid],
    };
    if (notes) {
      taskData.notes = notes;
    }
    if (dueOn) {
      taskData.due_on = dueOn;
    }
    if (assignee) {
      taskData.assignee = assignee;
    }

    try {
      const response = await fetch(`${ASANA_API}/tasks`, {
        method: 'POST',
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
