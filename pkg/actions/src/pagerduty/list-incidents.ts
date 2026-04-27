/**
 * pagerduty.list_incidents — List PagerDuty incidents
 *
 * Lists existing incidents with optional filtering by status, service,
 * urgency, date range, and assigned user.
 * Requires a PagerDuty API key credential.
 *
 * @see https://developer.pagerduty.com/api-reference/9d0b4b12e36f9-list-incidents
 */

import { defineAction } from '@flowlib/action-kit';
import { PAGERDUTY_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const PD_API_BASE = 'https://api.pagerduty.com';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'PagerDuty credential is required'),
  statuses: z.string().optional().default('triggered,acknowledged'),
  serviceIds: z.string().optional().default(''),
  urgencies: z.string().optional().default(''),
  since: z.string().optional().default(''),
  until: z.string().optional().default(''),
  limit: z.number().int().min(1).max(100).optional().default(25),
  offset: z.number().int().min(0).optional().default(0),
  sortBy: z.string().optional().default(''),
});

export const pagerdutyListIncidentsAction = defineAction({
  id: 'pagerduty.list_incidents',
  name: 'List Incidents',
  description:
    'List PagerDuty incidents (GET /incidents). Use when the user wants to see current or recent incidents, triage open alerts, or check incident status across services.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"incidents": [{"id": "PT4KHLK", "incident_number": 1234, "title": "The server is on fire.", "status": "triggered", "urgency": "high", "service": {"id": "PWIXJZS", "summary": "My Web App"}, "created_at": "2025-04-07T08:00:00Z"}], "more": false}\n' +
    '```',
  provider: PAGERDUTY_PROVIDER,
  actionCategory: 'read',
  tags: ['pagerduty', 'incidents', 'list', 'alerts', 'on-call', 'monitoring', 'operations'],

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
        name: 'statuses',
        label: 'Statuses',
        type: 'text',
        defaultValue: 'triggered,acknowledged',
        placeholder: 'triggered,acknowledged,resolved',
        description:
          'Comma-separated list of statuses to filter: triggered, acknowledged, resolved.',
        aiProvided: true,
      },
      {
        name: 'serviceIds',
        label: 'Service IDs',
        type: 'text',
        placeholder: 'PWIXJZS,P2KLBNA',
        description:
          'Comma-separated PagerDuty service IDs to filter by. Leave empty for all services.',
        aiProvided: true,
      },
      {
        name: 'urgencies',
        label: 'Urgencies',
        type: 'text',
        placeholder: 'high,low',
        description: 'Comma-separated urgencies to filter: high, low.',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'since',
        label: 'Since',
        type: 'text',
        placeholder: '2025-04-06T00:00:00Z',
        description: 'Start of date range (ISO 8601). Default is 1 month ago.',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'until',
        label: 'Until',
        type: 'text',
        placeholder: '2025-04-07T00:00:00Z',
        description: 'End of date range (ISO 8601). Default is now.',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'sortBy',
        label: 'Sort By',
        type: 'text',
        placeholder: 'created_at:desc',
        description: 'Sort field and direction, e.g. "created_at:desc", "incident_number:asc".',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'limit',
        label: 'Limit',
        type: 'number',
        defaultValue: 25,
        description: 'Maximum number of incidents to return (1–100).',
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
    const { credentialId, statuses, serviceIds, urgencies, since, until, sortBy, limit, offset } =
      params;

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

    context.logger.debug('Listing PagerDuty incidents', { statuses });

    try {
      const url = new URL(`${PD_API_BASE}/incidents`);
      url.searchParams.set('limit', String(limit));
      url.searchParams.set('offset', String(offset));

      if (statuses?.trim()) {
        for (const s of statuses
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)) {
          url.searchParams.append('statuses[]', s);
        }
      }
      if (serviceIds?.trim()) {
        for (const id of serviceIds
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)) {
          url.searchParams.append('service_ids[]', id);
        }
      }
      if (urgencies?.trim()) {
        for (const u of urgencies
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)) {
          url.searchParams.append('urgencies[]', u);
        }
      }
      if (since?.trim()) {
        url.searchParams.set('since', since);
      }
      if (until?.trim()) {
        url.searchParams.set('until', until);
      }
      if (sortBy?.trim()) {
        url.searchParams.set('sort_by', sortBy);
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
        incidents: Array<{
          id: string;
          incident_number: number;
          title: string;
          status: string;
          urgency: string;
          created_at: string;
          updated_at: string;
          html_url: string;
          service: { id: string; summary: string };
          assignments: Array<{ assignee: { id: string; summary: string } }>;
        }>;
        more: boolean;
        total: number | null;
      };

      return {
        success: true,
        output: {
          incidents: data.incidents.map((i) => ({
            id: i.id,
            incident_number: i.incident_number,
            title: i.title,
            status: i.status,
            urgency: i.urgency,
            created_at: i.created_at,
            updated_at: i.updated_at,
            html_url: i.html_url,
            service: i.service?.summary,
            serviceId: i.service?.id,
            assignees: i.assignments?.map((a) => a.assignee?.summary).filter(Boolean),
          })),
          more: data.more,
          total: data.total,
        },
        metadata: {
          incidentCount: data.incidents.length,
          more: data.more,
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `PagerDuty list incidents failed: ${msg}` };
    }
  },
});
