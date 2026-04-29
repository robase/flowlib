/**
 * linear.create_issue — Create an issue in Linear
 *
 * Creates a new issue in a Linear team using the GraphQL API.
 * Supports title, description, priority, assignee, label, and estimate.
 * Requires a Linear OAuth2 credential with write scope.
 */

import { defineAction } from '@flowlib/action-kit';
import { LINEAR_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const LINEAR_API = 'https://api.linear.app/graphql';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Linear credential is required'),
  teamId: z.string().min(1, 'Team ID is required'),
  title: z.string().min(1, 'Issue title is required'),
  description: z.string().optional().default(''),
  priority: z.number().int().min(0).max(4).optional(),
  assigneeId: z.string().optional().default(''),
  labelIds: z.array(z.string()).optional().default([]),
  stateId: z.string().optional().default(''),
  estimate: z.number().int().min(0).optional(),
  dueDate: z.string().optional().default(''),
  parentId: z.string().optional().default(''),
});

export const linearCreateIssueAction = defineAction({
  id: 'linear.create_issue',
  name: 'Create Issue',
  description:
    'Create a new issue in a Linear team (issueCreate mutation). Use when the user wants to file a bug, feature request, or task in Linear.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"id": "abc123", "identifier": "ENG-42", "title": "Fix login bug", "url": "https://linear.app/team/issue/ENG-42"}\n' +
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
        name: 'teamId',
        label: 'Team ID',
        type: 'text',
        required: true,
        placeholder: 'e.g. abc123',
        description:
          'The UUID of the team to create the issue in. ' +
          'Use linear.list_teams to find team IDs — do not guess.',
        aiProvided: true,
        helper: {
          kind: 'async-picker',
          loader: 'teams',
          dependsOn: ['credentialId'],
          searchable: true,
        },
      },
      {
        name: 'title',
        label: 'Title',
        type: 'text',
        required: true,
        placeholder: 'Bug: Something is broken',
        description: 'Issue title',
        aiProvided: true,
      },
      {
        name: 'description',
        label: 'Description',
        type: 'textarea',
        placeholder: 'Describe the issue in detail...',
        description:
          'Issue description (Markdown supported). Supports {{ expression }} templating.',
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
        description:
          'UUID of the user to assign the issue to. ' +
          'Use the Linear API to look up user IDs — do not use email addresses.',
        aiProvided: true,
      },
      {
        name: 'stateId',
        label: 'State ID',
        type: 'text',
        placeholder: 'e.g. state-id-123',
        description:
          'UUID of the workflow state to set on the issue. ' +
          'Leave empty for the default state. Use the Linear API to list workflow states.',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'labelIds',
        label: 'Label IDs',
        type: 'json',
        defaultValue: [],
        description: 'Label IDs to apply, e.g. ["label-id-1", "label-id-2"].',
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
        helper: { kind: 'date', mode: 'date' },
      },
      {
        name: 'parentId',
        label: 'Parent Issue ID',
        type: 'text',
        placeholder: 'e.g. issue-id-123',
        description: 'Parent issue ID to create this as a sub-issue.',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['linear', 'issues', 'create', 'project-management', 'development', 'oauth2'],

  loaders: {
    /**
     * Lists Linear teams the credential has access to. Powers the
     * `teamId` field's async-picker helper.
     */
    teams: {
      handler: async ({ deps }, ctx) => {
        const credentialId = deps.credentialId as string | undefined;
        if (!credentialId) {
          return { options: [], placeholder: 'Pick a credential first' };
        }

        const credential = await ctx.services.credentials.getDecrypted(credentialId);
        const accessToken =
          (credential?.config?.accessToken as string) ?? (credential?.config?.token as string);
        if (!accessToken) {
          return { options: [], placeholder: 'Credential has no access token' };
        }

        const response = await fetch(LINEAR_API, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            query: `query { teams(orderBy: updatedAt) { nodes { id name key } } }`,
          }),
        });

        if (!response.ok) {
          ctx.logger.warn('Linear teams loader: API error', { status: response.status });
          return { options: [] };
        }

        const data = (await response.json()) as {
          data?: { teams?: { nodes?: Array<{ id: string; name: string; key: string }> } };
        };
        const nodes = data?.data?.teams?.nodes ?? [];
        return {
          options: nodes.map((t) => ({ label: `${t.name} (${t.key})`, value: t.id })),
        };
      },
    },
  },

  async execute(params, context) {
    const {
      credentialId,
      teamId,
      title,
      description,
      priority,
      assigneeId,
      labelIds,
      stateId,
      estimate,
      dueDate,
      parentId,
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

    context.logger.debug('Creating Linear issue', { teamId, title });

    // Build input object
    const input: Record<string, unknown> = {
      teamId,
      title,
    };
    if (description) {
      input.description = description;
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
    if (stateId) {
      input.stateId = stateId;
    }
    if (estimate !== undefined && estimate !== null) {
      input.estimate = estimate;
    }
    if (dueDate) {
      input.dueDate = dueDate;
    }
    if (parentId) {
      input.parentId = parentId;
    }

    const mutation = `
      mutation CreateIssue($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue {
            id
            identifier
            title
            description
            priority
            priorityLabel
            url
            createdAt
            state { id name color type }
            assignee { id name displayName }
            team { id name key }
            labels { nodes { id name } }
            estimate
            dueDate
            parent { id identifier title }
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
          variables: { input },
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
          issueCreate: {
            success: boolean;
            issue: {
              id: string;
              identifier: string;
              title: string;
              description: string | null;
              priority: number;
              priorityLabel: string;
              url: string;
              createdAt: string;
              state: { id: string; name: string; color: string; type: string } | null;
              assignee: { id: string; name: string; displayName: string } | null;
              team: { id: string; name: string; key: string } | null;
              labels: { nodes: Array<{ id: string; name: string }> };
              estimate: number | null;
              dueDate: string | null;
              parent: { id: string; identifier: string; title: string } | null;
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

      if (!data.data?.issueCreate.success || !data.data.issueCreate.issue) {
        return {
          success: false,
          error: 'Linear issue creation failed — no issue returned.',
        };
      }

      const issue = data.data.issueCreate.issue;

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
          parent: issue.parent
            ? {
                id: issue.parent.id,
                identifier: issue.parent.identifier,
                title: issue.parent.title,
              }
            : null,
          createdAt: issue.createdAt,
        },
        metadata: {
          issueId: issue.id,
          identifier: issue.identifier,
          url: issue.url,
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Linear create issue failed: ${msg}` };
    }
  },
});
