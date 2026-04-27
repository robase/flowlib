/**
 * linear.list_teams — List teams in a Linear workspace
 *
 * Queries Linear's GraphQL API to list all teams the authenticated user
 * has access to. Useful for discovering team IDs before creating issues.
 * Requires a Linear OAuth2 credential with read scope.
 */

import { defineAction } from '@flowlib/action-kit';
import { LINEAR_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const LINEAR_API = 'https://api.linear.app/graphql';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Linear credential is required'),
  includeArchived: z.boolean().optional().default(false),
});

export const linearListTeamsAction = defineAction({
  id: 'linear.list_teams',
  name: 'List Teams',
  description:
    'List all teams in the Linear workspace (teams query). Use when the user needs to discover team IDs, workflow states, labels, or members before creating or filtering issues.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '[{"id": "team1", "name": "Engineering", "key": "ENG", "issueCount": 150, "states": [{"name": "In Progress"}], "members": [{"name": "Alice"}]}]\n' +
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
        name: 'includeArchived',
        label: 'Include Archived',
        type: 'boolean',
        defaultValue: false,
        description: 'Include archived teams in the results.',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['linear', 'teams', 'list', 'project-management', 'development', 'oauth2'],

  async execute(params, context) {
    const { credentialId, includeArchived } = params;

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

    context.logger.debug('Listing Linear teams');

    const query = `
      query ListTeams($includeArchived: Boolean) {
        teams(includeArchived: $includeArchived, orderBy: updatedAt) {
          nodes {
            id
            name
            key
            description
            color
            icon
            private
            issueCount
            timezone
            createdAt
            updatedAt
            states {
              nodes {
                id
                name
                color
                type
                position
              }
            }
            labels {
              nodes {
                id
                name
                color
              }
            }
            members {
              nodes {
                id
                name
                displayName
                email
              }
            }
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
          variables: { includeArchived },
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
          teams: {
            nodes: Array<{
              id: string;
              name: string;
              key: string;
              description: string | null;
              color: string | null;
              icon: string | null;
              private: boolean;
              issueCount: number;
              timezone: string | null;
              createdAt: string;
              updatedAt: string;
              states: {
                nodes: Array<{
                  id: string;
                  name: string;
                  color: string;
                  type: string;
                  position: number;
                }>;
              };
              labels: { nodes: Array<{ id: string; name: string; color: string }> };
              members: {
                nodes: Array<{ id: string; name: string; displayName: string; email: string }>;
              };
            }>;
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

      const teams = (data.data?.teams.nodes ?? []).map((team) => ({
        id: team.id,
        name: team.name,
        key: team.key,
        description: team.description ?? '',
        color: team.color,
        icon: team.icon,
        isPrivate: team.private,
        issueCount: team.issueCount,
        timezone: team.timezone,
        states: team.states.nodes.map((s) => ({
          id: s.id,
          name: s.name,
          type: s.type,
        })),
        labels: team.labels.nodes.map((l) => ({
          id: l.id,
          name: l.name,
        })),
        members: team.members.nodes.map((m) => ({
          id: m.id,
          name: m.displayName || m.name,
          email: m.email,
        })),
        createdAt: team.createdAt,
        updatedAt: team.updatedAt,
      }));

      return {
        success: true,
        output: {
          teams,
          count: teams.length,
        },
        metadata: {
          teamCount: teams.length,
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Linear list teams failed: ${msg}` };
    }
  },
});
