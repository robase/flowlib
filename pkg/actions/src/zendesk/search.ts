/**
 * zendesk.search — Search Zendesk tickets, users, or organizations
 *
 * Performs a search across a Zendesk instance using the Search API.
 * Supports Zendesk search syntax for filtering by type, status, assignee, etc.
 * Requires a Zendesk OAuth2 credential with read scopes.
 */

import { defineAction } from '@flowlib/action-kit';
import { ZENDESK_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Zendesk credential is required'),
  subdomain: z.string().min(1, 'Zendesk subdomain is required'),
  query: z.string().min(1, 'Search query is required'),
  perPage: z.number().int().min(1).max(100).optional().default(25),
});

export const zendeskSearchAction = defineAction({
  id: 'zendesk.search',
  name: 'Search',
  description:
    'Search Zendesk tickets, users, or organizations (GET /api/v2/search.json). Use when the user wants to find resources by criteria. Call with `query` using Zendesk search syntax — e.g. `type:ticket status:open`, `type:ticket priority:urgent assignee:me`, `type:user email:foo@bar.com`. Optional `perPage` (1–100).\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"results": [{"id": 35436, "result_type": "ticket", "subject": "Help!", "status": "open", "priority": "high"}], "count": 5, "nextPage": "https://..."  }\n' +
    '```',
  provider: ZENDESK_PROVIDER,
  actionCategory: 'read',

  credential: {
    required: true,
    type: 'oauth2',
    oauth2Provider: 'zendesk',
    requiredScopes: ['read'],
    description: 'Zendesk OAuth2 credential with read access',
  },

  params: {
    schema: paramsSchema,
    fields: [
      {
        name: 'credentialId',
        label: 'Zendesk Credential',
        type: 'text',
        required: true,
        description: 'Zendesk OAuth2 credential for authentication',
        aiProvided: false,
      },
      {
        name: 'subdomain',
        label: 'Subdomain',
        type: 'text',
        required: true,
        placeholder: 'e.g. mycompany',
        description: 'Your Zendesk subdomain (the part before .zendesk.com)',
        aiProvided: false,
      },
      {
        name: 'query',
        label: 'Search Query',
        type: 'text',
        required: true,
        placeholder: 'e.g. type:ticket status:open priority:high',
        description:
          'Zendesk search query. Supports syntax like type:ticket, status:open, assignee:me, priority:urgent, created>2024-01-01, tags:billing.',
        aiProvided: true,
      },
      {
        name: 'perPage',
        label: 'Results Per Page',
        type: 'number',
        defaultValue: 25,
        description: 'Number of results to return (1–100).',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['zendesk', 'search', 'tickets', 'users', 'organizations', 'support', 'oauth2'],

  async execute(params, context) {
    const { credentialId, subdomain, query, perPage } = params;

    // Resolve credential
    let credential = context.credential;
    if (!credential && context.functions?.getCredential) {
      credential = await context.functions.getCredential(credentialId);
    }
    if (!credential) {
      return {
        success: false,
        error: `Credential not found: ${credentialId}. Please create a Zendesk OAuth2 credential.`,
      };
    }

    const accessToken =
      (credential.config?.accessToken as string) ?? (credential.config?.token as string);
    if (!accessToken) {
      return {
        success: false,
        error: 'No valid access token in credential. Please re-authorize the Zendesk credential.',
      };
    }

    const baseUrl = `https://${encodeURIComponent(subdomain)}.zendesk.com`;
    const searchParams = new URLSearchParams({
      query,
      per_page: String(perPage),
    });
    const url = `${baseUrl}/api/v2/search.json?${searchParams.toString()}`;

    context.logger.debug('Searching Zendesk', { subdomain, query, perPage });

    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Zendesk API error (${response.status}): ${errorText}`,
        };
      }

      const data = (await response.json()) as Record<string, unknown>;

      return {
        success: true,
        output: {
          results: data.results ?? [],
          count: data.count ?? 0,
          facets: data.facets ?? null,
          nextPage: data.next_page ?? null,
          previousPage: data.previous_page ?? null,
        },
      };
    } catch (err) {
      return {
        success: false,
        error: `Failed to search Zendesk: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});
