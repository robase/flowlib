/**
 * linear.update_issue — Update an issue in Linear
 *
 * Updates an existing Linear issue via the GraphQL API.
 * Supports modifying title, description, state, priority, assignee, labels,
 * estimate, and due date. Only provided fields are updated.
 * Requires a Linear OAuth2 credential with write scope.
 */

import { defineAction } from '@flowlib/action-kit';
import { LINEAR_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const LINEAR_API = 'https://api.linear.app/graphql';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Linear credential is required'),
  issueId: z.string().min(1, 'Issue ID is required'),
  title: z.string().optional().default(''),
  description: z.string().optional().default(''),
  stateId: z.string().optional().default(''),
  priority: z.number().int().min(0).max(4).optional(),
  assigneeId: z.string().optional().default(''),
  labelIds: z.array(z.string()).optional().default([]),
  estimate: z.number().int().min(0).optional(),
  dueDate: z.string().optional().default(''),
});

export const linearUpdateIssueAction = defineAction({
  id: 'linear.update_issue',
  name: 'Update Issue',
  description:
    "Update an existing Linear issue (issueUpdate mutation). Use when the user wants to modify an issue's title, description, state, priority, or other fields. Only provided fields are changed.\n\n" +
    'Example response:\n' +
    '```json\n' +
    '{"id": "abc123", "identifier": "ENG-42", "title": "Updated title", "url": "https://linear.app/team/issue/ENG-42"}\n' +
    '```',
  provider: LINEAR_PROVIDER,
  actionCategory: 'write',

  credential: {
    required: true,
    type: 'oauth2',
    oauth2Provider: 'linear',
    requiredScopes: ['write'],
    description: 'Linear OAuth2 credential with write scope',
  },

  params: {
    schema: paramsSchema,
    fields: [
      {
        name: 'credentialId',
        label: 'Linear Credential',
        type: 'text',
        required: true,
        description: 'Linear OAuth2 credential for authentication',
        aiProvided: false,
      },
      {
        name: 'issueId',
        label: 'Issue ID',
        type: 'text',
        required: true,
        placeholder: 'e.g. abc123 or TEAM-123',
        description:
          'The UUID or human-readable key (e.g. "TEAM-123") of the issue to update. ' +
          'Use linear.list_issues to find issue IDs — do not guess.',
        aiProvided: true,
      },
      {
        name: 'title',
        label: 'Title',
        type: 'text',
        placeholder: 'New title (leave empty to keep current)',
        description: 'New issue title. Leave empty to keep current.',
        aiProvided: true,
      },
      {
        name: 'description',
        label: 'Description',
        type: 'textarea',
        placeholder: 'New description (leave empty to keep current)',
        description: 'New issue description (Markdown). Leave empty to keep current.',
        aiProvided: true,
      },
      {
        name: 'stateId',
        label: 'State ID',
        type: 'text',
        placeholder: 'e.g. state-id-123',
        description: 'Workflow state ID to transition to.',
        aiProvided: true,
      },
      {
        name: 'priority',
        label: 'Priority',
        type: 'select',
        options: [
          { label: 'No priority', value: 0 },
          { label: 'Urgent', value: 1 },
          { label: 'High', value: 2 },
          { label: 'Medium', value: 3 },
          { label: 'Low', value: 4 },
        ],
        description: 'Issue priority (0 = none, 1 = urgent, 4 = low).',
        aiProvided: true,
      },
      {
        name: 'assigneeId',
        label: 'Assignee ID',
        type: 'text',
        placeholder: 'e.g. user-id-123',
        description: 'User ID to assign the issue to.',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'labelIds',
        label: 'Label IDs',
        type: 'json',
        defaultValue: [],
        description: 'Label IDs to set (replaces existing), e.g. ["label-id-1"].',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'estimate',
        label: 'Estimate',
        type: 'number',
        description: 'Issue estimate (story points).',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'dueDate',
        label: 'Due Date',
        type: 'text',
        placeholder: 'YYYY-MM-DD',
        description: 'Due date in YYYY-MM-DD format.',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['linear', 'issues', 'update', 'project-management', 'development', 'oauth2'],

  async execute(params, context) {
    const {
      credentialId,
      issueId,
      title,
      description,
      stateId,
      priority,
      assigneeId,
      labelIds,
      estimate,
      dueDate,
    } = params;

    // Resolve credential
    let credential = context.credential;
    if (!credential && context.functions?.getCredential) {
      credential = await context.functions.getCredential(credentialId);
    }
    if (!credential) {
      return {
        success: false,
        error: `Credential not found: ${credentialId}. Please create a Linear OAuth2 credential.`,
      };
    }

    const accessToken =
      (credential.config?.accessToken as string) ?? (credential.config?.token as string);
    if (!accessToken) {
      return {
        success: false,
        error: 'No valid access token in credential. Please re-authorize the Linear credential.',
      };
    }

    context.logger.debug('Updating Linear issue', { issueId });

    // Build update input — only include fields that have values
    const input: Record<string, unknown> = {};
    if (title) {
      input.title = title;
    }
    if (description) {
      input.description = description;
    }
    if (stateId) {
      input.stateId = stateId;
    }
    if (priority !== undefined && priority !== null) {
      input.priority = priority;
    }
    if (assigneeId) {
      input.assigneeId = assigneeId;
    }
    if (labelIds.length > 0) {
      input.labelIds = labelIds;
    }
    if (estimate !== undefined && estimate !== null) {
      input.estimate = estimate;
    }
    if (dueDate) {
      input.dueDate = dueDate;
    }

    if (Object.keys(input).length === 0) {
      return {
        success: false,
        error: 'No fields to update. Provide at least one field to change.',
      };
    }

    const mutation = `
      mutation UpdateIssue($issueId: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $issueId, input: $input) {
          success
          issue {
            id
            identifier
            title
            description
            priority
            priorityLabel
            url
            updatedAt
            state { id name color type }
            assignee { id name displayName }
            team { id name key }
            labels { nodes { id name } }
            estimate
            dueDate
          }
        }
      }
    `;

    try {
      const response = await fetch(LINEAR_API, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: mutation,
          variables: { issueId, input },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Linear API error: ${response.status} ${response.statusText} - ${errorText}`,
        };
      }

      const data = (await response.json()) as {
        data?: {
          issueUpdate: {
            success: boolean;
            issue: {
              id: string;
              identifier: string;
              title: string;
              description: string | null;
              priority: number;
              priorityLabel: string;
              url: string;
              updatedAt: string;
              state: { id: string; name: string; color: string; type: string } | null;
              assignee: { id: string; name: string; displayName: string } | null;
              team: { id: string; name: string; key: string } | null;
              labels: { nodes: Array<{ id: string; name: string }> };
              estimate: number | null;
              dueDate: string | null;
            } | null;
          };
        };
        errors?: Array<{ message: string }>;
      };

      if (data.errors?.length) {
        return {
          success: false,
          error: `Linear GraphQL error: ${data.errors.map((e) => e.message).join(', ')}`,
        };
      }

      if (!data.data?.issueUpdate.success || !data.data.issueUpdate.issue) {
        return {
          success: false,
          error: 'Linear issue update failed — no issue returned.',
        };
      }

      const issue = data.data.issueUpdate.issue;

      return {
        success: true,
        output: {
          id: issue.id,
          identifier: issue.identifier,
          title: issue.title,
          description: issue.description ?? '',
          priority: issue.priority,
          priorityLabel: issue.priorityLabel,
          url: issue.url,
          state: issue.state?.name ?? 'Unknown',
          assignee: issue.assignee
            ? { id: issue.assignee.id, name: issue.assignee.displayName || issue.assignee.name }
            : null,
          team: issue.team
            ? { id: issue.team.id, name: issue.team.name, key: issue.team.key }
            : null,
          labels: issue.labels.nodes.map((l) => l.name),
          estimate: issue.estimate,
          dueDate: issue.dueDate,
          updatedAt: issue.updatedAt,
        },
        metadata: {
          issueId: issue.id,
          identifier: issue.identifier,
          url: issue.url,
          fieldsUpdated: Object.keys(input),
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Linear update issue failed: ${msg}` };
    }
  },
});
