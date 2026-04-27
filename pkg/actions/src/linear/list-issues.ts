/**
 * linear.list_issues — List issues from Linear
 *
 * Queries Linear's GraphQL API to list issues with optional filters
 * for team, state, assignee, and label. Returns issue details including
 * title, description, state, priority, and assignee.
 * Requires a Linear OAuth2 credential with read scope.
 */

import { defineAction } from '@flowlib/action-kit';
import { LINEAR_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const LINEAR_API = 'https://api.linear.app/graphql';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Linear credential is required'),
  teamId: z.string().optional().default(''),
  stateFilter: z.string().optional().default(''),
  assigneeId: z.string().optional().default(''),
  labelName: z.string().optional().default(''),
  limit: z.number().int().min(1).max(250).optional().default(50),
  includeArchived: z.boolean().optional().default(false),
});

export const linearListIssuesAction = defineAction({
  id: 'linear.list_issues',
  name: 'List Issues',
  description:
    'List issues from Linear with optional filters (issues query). Use when the user wants to see, search, or filter their Linear issues.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '[{"id": "abc123", "identifier": "ENG-42", "title": "Fix login bug", "state": {"name": "In Progress"}, "priority": 2, "assignee": {"name": "Alice"}}]\n' +
    '```',
  provider: LINEAR_PROVIDER,
  actionCategory: 'read',

  credential: {
    required: true,
    type: 'oauth2',
    oauth2Provider: 'linear',
    requiredScopes: ['read'],
    description: 'Linear OAuth2 credential with read scope',
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
        placeholder: 'e.g. abc123',
        description: 'Filter issues by team ID. Leave empty for all teams.',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'stateFilter',
        label: 'State Filter',
        type: 'text',
        placeholder: 'e.g. In Progress, Done, Backlog',
        description: 'Filter by issue state name (case-insensitive partial match).',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'assigneeId',
        label: 'Assignee ID',
        type: 'text',
        placeholder: 'e.g. user-id-123',
        description: 'Filter issues assigned to a specific user ID.',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'labelName',
        label: 'Label',
        type: 'text',
        placeholder: 'e.g. Bug, Feature',
        description: 'Filter issues by label name (case-insensitive partial match).',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'limit',
        label: 'Limit',
        type: 'number',
        defaultValue: 50,
        description: 'Maximum number of issues to return (1–250).',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'includeArchived',
        label: 'Include Archived',
        type: 'boolean',
        defaultValue: false,
        description: 'Include archived issues in the results.',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['linear', 'issues', 'list', 'project-management', 'development', 'oauth2'],

  async execute(params, context) {
    const { credentialId, teamId, stateFilter, assigneeId, labelName, limit, includeArchived } =
      params;

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

    context.logger.debug('Listing Linear issues', { teamId, stateFilter, limit });

    // Build GraphQL filter
    const filter: Record<string, unknown> = {};
    if (teamId) {
      filter.team = { id: { eq: teamId } };
    }
    if (stateFilter) {
      filter.state = { name: { containsIgnoreCase: stateFilter } };
    }
    if (assigneeId) {
      filter.assignee = { id: { eq: assigneeId } };
    }
    if (labelName) {
      filter.labels = { name: { containsIgnoreCase: labelName } };
    }

    const query = `
      query ListIssues($first: Int!, $filter: IssueFilter, $includeArchived: Boolean) {
        issues(first: $first, filter: $filter, includeArchived: $includeArchived, orderBy: updatedAt) {
          nodes {
            id
            identifier
            title
            description
            priority
            priorityLabel
            url
            createdAt
            updatedAt
            state { id name color type }
            assignee { id name email displayName }
            team { id name key }
            labels { nodes { id name color } }
            estimate
            dueDate
          }
          pageInfo {
            hasNextPage
            endCursor
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
          query,
          variables: {
            first: Math.min(Math.max(1, limit), 250),
            filter: Object.keys(filter).length > 0 ? filter : undefined,
            includeArchived,
          },
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
          issues: {
            nodes: Array<{
              id: string;
              identifier: string;
              title: string;
              description: string | null;
              priority: number;
              priorityLabel: string;
              url: string;
              createdAt: string;
              updatedAt: string;
              state: { id: string; name: string; color: string; type: string } | null;
              assignee: { id: string; name: string; email: string; displayName: string } | null;
              team: { id: string; name: string; key: string } | null;
              labels: { nodes: Array<{ id: string; name: string; color: string }> };
              estimate: number | null;
              dueDate: string | null;
            }>;
            pageInfo: { hasNextPage: boolean; endCursor: string | null };
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

      const issues = (data.data?.issues.nodes ?? []).map((issue) => ({
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        description: issue.description ?? '',
        priority: issue.priority,
        priorityLabel: issue.priorityLabel,
        url: issue.url,
        state: issue.state?.name ?? 'Unknown',
        stateType: issue.state?.type ?? 'unstarted',
        assignee: issue.assignee
          ? { id: issue.assignee.id, name: issue.assignee.displayName || issue.assignee.name }
          : null,
        team: issue.team ? { id: issue.team.id, name: issue.team.name, key: issue.team.key } : null,
        labels: issue.labels.nodes.map((l) => l.name),
        estimate: issue.estimate,
        dueDate: issue.dueDate,
        createdAt: issue.createdAt,
        updatedAt: issue.updatedAt,
      }));

      const hasNextPage = data.data?.issues.pageInfo.hasNextPage ?? false;

      return {
        success: true,
        output: {
          issues,
          count: issues.length,
          hasMore: hasNextPage,
        },
        metadata: {
          issueCount: issues.length,
          hasMore: hasNextPage,
          filters: { teamId, stateFilter, assigneeId, labelName },
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Linear list issues failed: ${msg}` };
    }
  },
});
