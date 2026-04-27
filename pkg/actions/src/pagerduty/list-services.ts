/**
 * pagerduty.list_services — List PagerDuty services
 *
 * Lists existing services with optional name filtering.
 * A service represents an application or component you open incidents against.
 * Requires a PagerDuty API key credential.
 *
 * @see https://developer.pagerduty.com/api-reference/e960cca205c0f-list-services
 */

import { defineAction } from '@flowlib/action-kit';
import { PAGERDUTY_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const PD_API_BASE = 'https://api.pagerduty.com';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'PagerDuty credential is required'),
  query: z.string().optional().default(''),
  limit: z.number().int().min(1).max(100).optional().default(25),
  offset: z.number().int().min(0).optional().default(0),
});

export const pagerdutyListServicesAction = defineAction({
  id: 'pagerduty.list_services',
  name: 'List Services',
  description:
    'List PagerDuty services (GET /services). Use when the user wants to discover available services or find a service ID for creating/filtering incidents.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"services": [{"id": "PWIXJZS", "name": "My Web App", "status": "active", "description": "Production web app", "created_at": "2025-01-01T00:00:00Z"}], "more": false}\n' +
    '```',
  provider: PAGERDUTY_PROVIDER,
  actionCategory: 'read',
  tags: ['pagerduty', 'services', 'list', 'discover', 'operations'],

  credential: {
    required: true,
    type: 'api_key',
    description: 'PagerDuty REST API key (v2)',
  },

  params: {
    schema: paramsSchema,
    fields: [
      {
        name: 'credentialId',
        label: 'PagerDuty Credential',
        type: 'text',
        required: true,
        description: 'PagerDuty API key credential for authentication',
        aiProvided: false,
      },
      {
        name: 'query',
        label: 'Search Query',
        type: 'text',
        placeholder: 'web app',
        description: 'Filter services by name. Leave empty to list all.',
        aiProvided: true,
      },
      {
        name: 'limit',
        label: 'Limit',
        type: 'number',
        defaultValue: 25,
        description: 'Maximum number of services to return (1–100).',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'offset',
        label: 'Offset',
        type: 'number',
        defaultValue: 0,
        description: 'Pagination offset.',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  async execute(params, context) {
    const { credentialId, query, limit, offset } = params;

    let credential = context.credential;
    if (!credential && context.functions?.getCredential) {
      credential = await context.functions.getCredential(credentialId);
    }
    if (!credential) {
      return {
        success: false,
        error: `Credential not found: ${credentialId}. Please create a PagerDuty API key credential.`,
      };
    }

    const token =
      (credential.config?.token as string) ?? (credential.config?.accessToken as string);
    if (!token) {
      return {
        success: false,
        error: 'No valid API token in credential. Please provide a PagerDuty REST API key.',
      };
    }

    context.logger.debug('Listing PagerDuty services', { query });

    try {
      const url = new URL(`${PD_API_BASE}/services`);
      url.searchParams.set('limit', String(limit));
      url.searchParams.set('offset', String(offset));

      if (query?.trim()) {
        url.searchParams.set('query', query);
      }

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Token token=${token}`,
          Accept: 'application/vnd.pagerduty+json;version=2',
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `PagerDuty API error (${response.status}): ${errorText}`,
        };
      }

      const data = (await response.json()) as {
        services: Array<{
          id: string;
          name: string;
          description: string;
          status: string;
          created_at: string;
          html_url: string;
          escalation_policy: { id: string; summary: string };
          teams: Array<{ id: string; summary: string }>;
        }>;
        more: boolean;
        total: number | null;
      };

      return {
        success: true,
        output: {
          services: data.services.map((s) => ({
            id: s.id,
            name: s.name,
            description: s.description,
            status: s.status,
            created_at: s.created_at,
            html_url: s.html_url,
            escalation_policy: s.escalation_policy?.summary,
            teams: s.teams?.map((t) => t.summary).filter(Boolean),
          })),
          more: data.more,
          total: data.total,
        },
        metadata: {
          serviceCount: data.services.length,
          more: data.more,
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `PagerDuty list services failed: ${msg}` };
    }
  },
});
