/**
 * pagerduty.create_incident — Create a PagerDuty incident
 *
 * Creates a new incident against a specified service. Supports setting
 * title, urgency, priority, body details, and escalation policy.
 * Requires a PagerDuty API key credential and a valid user email (From header).
 *
 * @see https://developer.pagerduty.com/api-reference/a7d81b0e9200f-create-an-incident
 */

import { defineAction } from '@flowlib/action-kit';
import { PAGERDUTY_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const PD_API_BASE = 'https://api.pagerduty.com';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'PagerDuty credential is required'),
  fromEmail: z.string().email('A valid PagerDuty user email is required'),
  title: z.string().min(1, 'Incident title is required'),
  serviceId: z.string().min(1, 'Service ID is required'),
  urgency: z.enum(['high', 'low']).optional().default('high'),
  body: z.string().optional().default(''),
  incidentKey: z.string().optional().default(''),
  escalationPolicyId: z.string().optional().default(''),
});

export const pagerdutyCreateIncidentAction = defineAction({
  id: 'pagerduty.create_incident',
  name: 'Create Incident',
  description:
    'Create a PagerDuty incident (POST /incidents). Use when the user wants to manually trigger an incident on a service. Requires a From email header matching a valid PagerDuty user.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"id": "PT4KHLK", "incident_number": 1234, "title": "The server is on fire.", "status": "triggered", "urgency": "high", "html_url": "https://subdomain.pagerduty.com/incidents/PT4KHLK"}\n' +
    '```',
  provider: PAGERDUTY_PROVIDER,
  actionCategory: 'write',
  tags: ['pagerduty', 'incident', 'create', 'trigger', 'alert', 'on-call', 'operations'],

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
        name: 'title',
        label: 'Title',
        type: 'text',
        required: true,
        placeholder: 'Database connection pool exhausted',
        description: 'Succinct description of the incident.',
        aiProvided: true,
      },
      {
        name: 'serviceId',
        label: 'Service ID',
        type: 'text',
        required: true,
        placeholder: 'PWIXJZS',
        description: 'PagerDuty service ID to create the incident on.',
        aiProvided: true,
      },
      {
        name: 'urgency',
        label: 'Urgency',
        type: 'select',
        defaultValue: 'high',
        options: [
          { label: 'High', value: 'high' },
          { label: 'Low', value: 'low' },
        ],
        description: 'Urgency of the incident.',
        aiProvided: true,
      },
      {
        name: 'body',
        label: 'Body Details',
        type: 'textarea',
        placeholder: 'Detailed description of what happened...',
        description: 'Additional details about the incident.',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'incidentKey',
        label: 'Incident Key',
        type: 'text',
        placeholder: 'dedup-key-123',
        description:
          'De-duplication key. Subsequent requests with the same key and service are rejected if an open incident matches.',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'escalationPolicyId',
        label: 'Escalation Policy ID',
        type: 'text',
        placeholder: 'PT20YPA',
        description: 'Override escalation policy. Leave empty to use the service default.',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  async execute(params, context) {
    const {
      credentialId,
      fromEmail,
      title,
      serviceId,
      urgency,
      body,
      incidentKey,
      escalationPolicyId,
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

    context.logger.debug('Creating PagerDuty incident', { serviceId, title });

    try {
      const incident: Record<string, unknown> = {
        type: 'incident',
        title,
        service: { id: serviceId, type: 'service_reference' },
        urgency,
      };

      if (body?.trim()) {
        incident.body = { type: 'incident_body', details: body };
      }
      if (incidentKey?.trim()) {
        incident.incident_key = incidentKey;
      }
      if (escalationPolicyId?.trim()) {
        incident.escalation_policy = {
          id: escalationPolicyId,
          type: 'escalation_policy_reference',
        };
      }

      const response = await fetch(`${PD_API_BASE}/incidents`, {
        method: 'POST',
        headers: {
          Authorization: `Token token=${token}`,
          Accept: 'application/vnd.pagerduty+json;version=2',
          'Content-Type': 'application/json',
          From: fromEmail,
        },
        body: JSON.stringify({ incident }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `PagerDuty API error (${response.status}): ${errorText}`,
        };
      }

      const data = (await response.json()) as {
        incident: {
          id: string;
          incident_number: number;
          title: string;
          status: string;
          urgency: string;
          created_at: string;
          html_url: string;
          service: { id: string; summary: string };
        };
      };

      const inc = data.incident;
      return {
        success: true,
        output: {
          id: inc.id,
          incident_number: inc.incident_number,
          title: inc.title,
          status: inc.status,
          urgency: inc.urgency,
          created_at: inc.created_at,
          html_url: inc.html_url,
          service: inc.service?.summary,
        },
        metadata: {
          incidentId: inc.id,
          html_url: inc.html_url,
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `PagerDuty create incident failed: ${msg}` };
    }
  },
});
