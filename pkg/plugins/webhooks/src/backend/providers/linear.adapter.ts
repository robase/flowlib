/**
 * Linear webhook adapter.
 *
 * Uses Linear's GraphQL API: `webhookCreate`, `webhookUpdate`, `webhookDelete`,
 * `webhooks` query. Requires the OAuth2 credential to have the `admin` scope —
 * the registration service surfaces a `MISSING_SCOPES` error otherwise so the
 * frontend can offer a re-authorize affordance.
 *
 * Docs: https://linear.app/developers/webhooks
 */

import type { Credential } from '@flowlib/core';
import type {
  CreateRemoteWebhookInput,
  RemoteWebhook,
  UpdateRemoteWebhookInput,
  WebhookProviderAdapter,
  WebhookProviderContext,
} from './types';

const LINEAR_API = 'https://api.linear.app/graphql';

interface LinearWebhookNode {
  id: string;
  url: string;
  enabled: boolean;
  resourceTypes: string[] | null;
  team?: { id: string; name: string; key: string } | null;
  allPublicTeams?: boolean | null;
  label?: string | null;
}

function getAccessToken(credential: Credential): string {
  const token =
    (credential.config?.accessToken as string | undefined) ??
    (credential.config?.token as string | undefined);
  if (!token) {
    throw new Error('Linear credential is missing an access token');
  }
  return token;
}

async function graphql<T>(
  credential: Credential,
  query: string,
  variables?: Record<string, unknown>,
): Promise<{ data: T }> {
  const response = await fetch(LINEAR_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getAccessToken(credential)}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Linear API error ${response.status}: ${body}`);
  }

  const json = (await response.json()) as {
    data?: T;
    errors?: Array<{ message: string }>;
  };

  if (json.errors?.length) {
    throw new Error(`Linear GraphQL error: ${json.errors.map((e) => e.message).join(', ')}`);
  }
  if (!json.data) {
    throw new Error('Linear GraphQL returned no data');
  }
  return { data: json.data };
}

function toRemoteWebhook(node: LinearWebhookNode): RemoteWebhook {
  return {
    id: node.id,
    url: node.url,
    events: node.resourceTypes ?? [],
    enabled: node.enabled,
    // Linear's Webhook type does not expose `secret` as a queryable field —
    // we only ever know the secret we sent on `webhookCreate`. The
    // registration service falls back to its generated secret via
    // `remote.secret ?? secret`.
    secret: null,
    raw: node,
  };
}

export const linearWebhookAdapter: WebhookProviderAdapter = {
  id: 'linear',
  displayName: 'Linear',
  category: 'project_management',
  oauth2Provider: 'linear',
  requiredScopes: ['admin'],

  scopeFields: [
    {
      name: 'teamId',
      label: 'Team',
      type: 'async-picker',
      required: false,
      loader: 'teams',
    },
    {
      name: 'allPublicTeams',
      label: 'All public teams',
      type: 'select',
      required: false,
      options: [
        { value: 'false', label: 'No — single team' },
        { value: 'true', label: 'Yes — subscribe across all public teams' },
      ],
    },
  ],

  scopeLoaders: {
    async teams(ctx) {
      const result = await graphql<{
        teams: { nodes: Array<{ id: string; name: string; key: string }> };
      }>(
        ctx.credential,
        `
          query {
            teams(orderBy: updatedAt) {
              nodes {
                id
                name
                key
              }
            }
          }
        `,
      );
      return result.data.teams.nodes.map((t) => ({
        value: t.id,
        label: `${t.name} (${t.key})`,
      }));
    },
  },

  events: [
    { value: 'Issue', label: 'Issues' },
    { value: 'Comment', label: 'Comments' },
    { value: 'IssueLabel', label: 'Issue labels' },
    { value: 'IssueAttachment', label: 'Issue attachments' },
    { value: 'Project', label: 'Projects' },
    { value: 'ProjectUpdate', label: 'Project updates' },
    { value: 'Cycle', label: 'Cycles' },
    { value: 'Reaction', label: 'Reactions' },
    { value: 'Document', label: 'Documents' },
    { value: 'Initiative', label: 'Initiatives' },
    { value: 'InitiativeUpdate', label: 'Initiative updates' },
    { value: 'Customer', label: 'Customers' },
    { value: 'CustomerNeed', label: 'Customer requests' },
    { value: 'User', label: 'Users' },
  ],

  async list(ctx: WebhookProviderContext): Promise<RemoteWebhook[]> {
    const result = await graphql<{ webhooks: { nodes: LinearWebhookNode[] } }>(
      ctx.credential,
      `
        query {
          webhooks {
            nodes {
              id
              url
              enabled
              resourceTypes
              label
              team {
                id
                name
                key
              }
              allPublicTeams
            }
          }
        }
      `,
    );
    return result.data.webhooks.nodes.map(toRemoteWebhook);
  },

  async get(ctx: WebhookProviderContext, remoteId: string): Promise<RemoteWebhook> {
    const result = await graphql<{ webhook: LinearWebhookNode }>(
      ctx.credential,
      `
        query ($id: String!) {
          webhook(id: $id) {
            id
            url
            enabled
            resourceTypes
            label
            team {
              id
              name
              key
            }
            allPublicTeams
          }
        }
      `,
      { id: remoteId },
    );
    return toRemoteWebhook(result.data.webhook);
  },

  async create(input: CreateRemoteWebhookInput): Promise<RemoteWebhook> {
    const allPublicTeams =
      input.scope.allPublicTeams === 'true' || input.scope.allPublicTeams === true;
    const teamId = typeof input.scope.teamId === 'string' ? input.scope.teamId : undefined;

    if (!allPublicTeams && !teamId) {
      throw new Error('Linear webhook requires either `teamId` or `allPublicTeams: true`');
    }

    const webhookInput: Record<string, unknown> = {
      url: input.url,
      resourceTypes: input.events,
      secret: input.secret,
      enabled: true,
      label: input.description,
    };
    if (allPublicTeams) {
      webhookInput.allPublicTeams = true;
    } else if (teamId) {
      webhookInput.teamId = teamId;
    }

    const result = await graphql<{
      webhookCreate: { success: boolean; webhook: LinearWebhookNode | null };
    }>(
      input.credential,
      `
        mutation ($input: WebhookCreateInput!) {
          webhookCreate(input: $input) {
            success
            webhook {
              id
              url
              enabled
              resourceTypes
              label
              team {
                id
                name
                key
              }
              allPublicTeams
            }
          }
        }
      `,
      { input: webhookInput },
    );

    if (!result.data.webhookCreate.success || !result.data.webhookCreate.webhook) {
      throw new Error('Linear webhookCreate returned success: false');
    }
    return toRemoteWebhook(result.data.webhookCreate.webhook);
  },

  async update(input: UpdateRemoteWebhookInput): Promise<RemoteWebhook> {
    const updateInput: Record<string, unknown> = {};
    if (input.events !== undefined) {
      updateInput.resourceTypes = input.events;
    }
    if (input.enabled !== undefined) {
      updateInput.enabled = input.enabled;
    }

    if (Object.keys(updateInput).length === 0) {
      return this.get(input, input.remoteId);
    }

    const result = await graphql<{
      webhookUpdate: { success: boolean; webhook: LinearWebhookNode | null };
    }>(
      input.credential,
      `
        mutation ($id: String!, $input: WebhookUpdateInput!) {
          webhookUpdate(id: $id, input: $input) {
            success
            webhook {
              id
              url
              enabled
              resourceTypes
              label
              team {
                id
                name
                key
              }
              allPublicTeams
            }
          }
        }
      `,
      { id: input.remoteId, input: updateInput },
    );

    if (!result.data.webhookUpdate.success || !result.data.webhookUpdate.webhook) {
      throw new Error('Linear webhookUpdate returned success: false');
    }
    return toRemoteWebhook(result.data.webhookUpdate.webhook);
  },

  async delete(ctx: WebhookProviderContext, remoteId: string): Promise<void> {
    const result = await graphql<{ webhookDelete: { success: boolean } }>(
      ctx.credential,
      `
        mutation ($id: String!) {
          webhookDelete(id: $id) {
            success
          }
        }
      `,
      { id: remoteId },
    );
    if (!result.data.webhookDelete.success) {
      throw new Error('Linear webhookDelete returned success: false');
    }
  },
};
