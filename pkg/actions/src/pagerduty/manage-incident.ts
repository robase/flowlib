/**
 * pagerduty.manage_incident — Update a PagerDuty incident
 *
 * Acknowledge, resolve, escalate, reassign, or change the urgency of an
 * existing incident. Uses the PUT /incidents bulk manage endpoint for a
 * single incident.
 * Requires a PagerDuty API key credential and a valid user email (From header).
 *
 * @see https://developer.pagerduty.com/api-reference/f79f697c07f6c-manage-incidents
 */

import { defineAction } from '@flowlib/action-kit';
import { PAGERDUTY_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const PD_API_BASE = 'https://api.pagerduty.com';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'PagerDuty credential is required'),
  fromEmail: z.string().email('A valid PagerDuty user email is required'),
  incidentId: z.string().min(1, 'Incident ID is required'),
  status: z.enum(['triggered', 'acknowledged', 'resolved']).optional().default('acknowledged'),
  title: z.string().optional().default(''),
  urgency: z.enum(['high', 'low', '']).optional().default(''),
  resolution: z.string().optional().default(''),
  escalationLevel: z.number().int().min(1).optional(),
});

export const pagerdutyManageIncidentAction = defineAction({
  id: 'pagerduty.manage_incident',
  name: 'Manage Incident',
  description:
    'Update a PagerDuty incident — acknowledge, resolve, escalate, or change urgency (PUT /incidents). Use when the user wants to change the status or properties of an existing incident.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"id": "PT4KHLK", "incident_number": 1234, "title": "The server is on fire.", "status": "acknowledged", "urgency": "high", "html_url": "https://subdomain.pagerduty.com/incidents/PT4KHLK"}\n' +
    '```',
  provider: PAGERDUTY_PROVIDER,
  actionCategory: 'write',
  tags: [
    'pagerduty',
    'incident',
    'update',
    'acknowledge',
    'resolve',
    'escalate',
    'manage',
    'operations',
  ],

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
        name: 'fromEmail',
        label: 'From Email',
        type: 'text',
        required: true,
        placeholder: 'user@example.com',
        description:
          'Email of a valid PagerDuty user. Required by the API as the requester identity.',
        aiProvided: true,
      },
      {
        name: 'incidentId',
        label: 'Incident ID',
        type: 'text',
        required: true,
        placeholder: 'PT4KHLK',
        description: 'ID of the incident to update.',
        aiProvided: true,
      },
      {
        name: 'status',
        label: 'Status',
        type: 'select',
        defaultValue: 'acknowledged',
        options: [
          { label: 'Triggered', value: 'triggered' },
          { label: 'Acknowledged', value: 'acknowledged' },
          { label: 'Resolved', value: 'resolved' },
        ],
        description: 'New status for the incident.',
        aiProvided: true,
      },
      {
        name: 'title',
        label: 'Title',
        type: 'text',
        placeholder: '',
        description: 'Update the incident title. Leave empty to keep current.',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'urgency',
        label: 'Urgency',
        type: 'select',
        defaultValue: '',
        options: [
          { label: 'No change', value: '' },
          { label: 'High', value: 'high' },
          { label: 'Low', value: 'low' },
        ],
        description: 'Change the urgency. Leave empty to keep current.',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'resolution',
        label: 'Resolution Note',
        type: 'textarea',
        placeholder: 'Root cause was...',
        description:
          'Resolution note (only used when status is resolved). Added to the Resolve log entry.',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'escalationLevel',
        label: 'Escalation Level',
        type: 'number',
        description: 'Escalate to this level in the escalation policy.',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  async execute(params, context) {
    const {
      credentialId,
      fromEmail,
      incidentId,
      status,
      title,
      urgency,
      resolution,
      escalationLevel,
    } = params;

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

    context.logger.debug('Managing PagerDuty incident', { incidentId, status });

    try {
      const incident: Record<string, unknown> = {
        id: incidentId,
        type: 'incident_reference',
      };

      if (status) {
        incident.status = status;
      }
      if (title?.trim()) {
        incident.title = title;
      }
      if (urgency?.trim()) {
        incident.urgency = urgency;
      }
      if (resolution?.trim() && status === 'resolved') {
        incident.resolution = resolution;
      }
      if (escalationLevel !== undefined) {
        incident.escalation_level = escalationLevel;
      }

      const response = await fetch(`${PD_API_BASE}/incidents`, {
        method: 'PUT',
        headers: {
          Authorization: `Token token=${token}`,
          Accept: 'application/vnd.pagerduty+json;version=2',
          'Content-Type': 'application/json',
          From: fromEmail,
        },
        body: JSON.stringify({ incidents: [incident] }),
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
          html_url: string;
          service: { id: string; summary: string };
        }>;
      };

      const inc = data.incidents?.[0];
      if (!inc) {
        return { success: false, error: 'No incident returned from PagerDuty.' };
      }

      return {
        success: true,
        output: {
          id: inc.id,
          incident_number: inc.incident_number,
          title: inc.title,
          status: inc.status,
          urgency: inc.urgency,
          html_url: inc.html_url,
          service: inc.service?.summary,
        },
        metadata: {
          incidentId: inc.id,
          html_url: inc.html_url,
          updatedFields: Object.keys(incident).filter((k) => k !== 'id' && k !== 'type'),
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `PagerDuty manage incident failed: ${msg}` };
    }
  },
});
