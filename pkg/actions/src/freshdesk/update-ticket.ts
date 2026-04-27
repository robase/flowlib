/**
 * freshdesk.update_ticket — Update an existing Freshdesk ticket
 *
 * Updates fields on a Freshdesk ticket (status, priority, subject, description).
 * Supports OAuth2 Bearer token or API key (Basic) authentication.
 */

import { defineAction } from '@flowlib/action-kit';
import { FRESHDESK_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Freshdesk credential is required'),
  domain: z.string().min(1, 'Freshdesk domain is required'),
  ticketId: z.string().min(1, 'Ticket ID is required'),
  status: z.number().int().min(2).max(5).optional(),
  priority: z.number().int().min(1).max(4).optional(),
  subject: z.string().optional(),
  description: z.string().optional(),
  type: z.string().optional(),
  tags: z.array(z.string()).optional(),
  groupId: z.number().int().optional(),
  responderId: z.number().int().optional(),
});

export const freshdeskUpdateTicketAction = defineAction({
  id: 'freshdesk.update_ticket',
  name: 'Update Ticket',
  description:
    'Update an existing Freshdesk ticket (PUT /api/v2/tickets/{id}). Use when the user wants to change a ticket\u2019s fields. ' +
    'Supports: `status` (2=Open, 3=Pending, 4=Resolved, 5=Closed), `priority` (1–4), `subject`, `description`, ' +
    '`type`, `tags`, `group_id`, `responder_id`. At least one field must be provided. ' +
    'Note: outbound ticket subject and description cannot be updated.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"id": 1, "subject": "Updated subject", "status": 4, "priority": 3, "group_id": 5, "responder_id": 42, "tags": ["escalated"], "updated_at": "2025-01-16T12:00:00Z"}\n' +
    '```',
  provider: FRESHDESK_PROVIDER,
  actionCategory: 'write',
  tags: ['freshdesk', 'support', 'ticket', 'helpdesk', 'update', 'oauth2'],

  credential: {
    required: true,
    type: 'oauth2',
    oauth2Provider: 'freshdesk',
    description: 'Freshdesk OAuth2 credential or API key credential',
  },

  params: {
    schema: paramsSchema,
    fields: [
      {
        name: 'credentialId',
        label: 'Freshdesk Credential',
        type: 'text',
        required: true,
        description: 'Freshdesk OAuth2 or API key credential',
        aiProvided: false,
      },
      {
        name: 'domain',
        label: 'Domain',
        type: 'text',
        required: true,
        placeholder: 'mycompany',
        description: 'Your Freshdesk subdomain (e.g. "mycompany" for mycompany.freshdesk.com)',
        aiProvided: false,
      },
      {
        name: 'ticketId',
        label: 'Ticket ID',
        type: 'text',
        required: true,
        placeholder: '12345',
        description: 'The numeric ID of the ticket to update',
        aiProvided: true,
      },
      {
        name: 'status',
        label: 'Status',
        type: 'select',
        description: 'New ticket status (leave empty to keep current)',
        aiProvided: true,
        extended: true,
        options: [
          { label: 'Open', value: 2 },
          { label: 'Pending', value: 3 },
          { label: 'Resolved', value: 4 },
          { label: 'Closed', value: 5 },
        ],
      },
      {
        name: 'priority',
        label: 'Priority',
        type: 'select',
        description: 'New ticket priority (leave empty to keep current)',
        aiProvided: true,
        extended: true,
        options: [
          { label: 'Low', value: 1 },
          { label: 'Medium', value: 2 },
          { label: 'High', value: 3 },
          { label: 'Urgent', value: 4 },
        ],
      },
      {
        name: 'subject',
        label: 'Subject',
        type: 'text',
        description: 'New ticket subject (leave empty to keep current)',
        aiProvided: true,
        extended: true,
      },
      {
        name: 'description',
        label: 'Description',
        type: 'textarea',
        description:
          'New ticket description/body in HTML or plain text (leave empty to keep current)',
        aiProvided: true,
        extended: true,
      },
      {
        name: 'type',
        label: 'Type',
        type: 'text',
        placeholder: 'Problem',
        description: 'New ticket type (e.g. Question, Incident, Problem)',
        aiProvided: true,
        extended: true,
      },
      {
        name: 'tags',
        label: 'Tags',
        type: 'json',
        placeholder: '["billing", "urgent"]',
        description: 'Replace the ticket tags with this array',
        aiProvided: true,
        extended: true,
      },
      {
        name: 'groupId',
        label: 'Group ID',
        type: 'number',
        description: 'Reassign ticket to this agent group',
        aiProvided: true,
        extended: true,
      },
      {
        name: 'responderId',
        label: 'Responder ID',
        type: 'number',
        description: 'Reassign ticket to this agent',
        aiProvided: true,
        extended: true,
      },
    ],
  },

  async execute(params, context) {
    const {
      credentialId,
      domain,
      ticketId,
      status,
      priority,
      subject,
      description,
      type,
      tags,
      groupId,
      responderId,
    } = params;

    let credential = context.credential;
    if (!credential && context.functions?.getCredential) {
      credential = await context.functions.getCredential(credentialId);
    }
    if (!credential) {
      return {
        success: false,
        error: `Credential not found: ${credentialId}. Please create a Freshdesk credential.`,
      };
    }

    const accessToken =
      (credential.config?.accessToken as string) ?? (credential.config?.token as string);
    const apiKey = credential.config?.apiKey as string;

    let authHeader: string;
    if (accessToken) {
      authHeader = `Bearer ${accessToken}`;
    } else if (apiKey) {
      authHeader = `Basic ${btoa(`${apiKey}:X`)}`;
    } else {
      return { success: false, error: 'No access token or API key found in credential.' };
    }

    const baseUrl = `https://${encodeURIComponent(domain)}.freshdesk.com`;

    const body: Record<string, unknown> = {};
    if (status !== undefined) {
      body.status = status;
    }
    if (priority !== undefined) {
      body.priority = priority;
    }
    if (subject !== undefined && subject !== '') {
      body.subject = subject;
    }
    if (description !== undefined && description !== '') {
      body.description = description;
    }
    if (type !== undefined && type !== '') {
      body.type = type;
    }
    if (tags !== undefined) {
      body.tags = tags;
    }
    if (groupId !== undefined) {
      body.group_id = groupId;
    }
    if (responderId !== undefined) {
      body.responder_id = responderId;
    }

    if (Object.keys(body).length === 0) {
      return {
        success: false,
        error: 'No fields to update. Provide at least one of status, priority, or subject.',
      };
    }

    context.logger.debug('Updating Freshdesk ticket', {
      domain,
      ticketId,
      fields: Object.keys(body),
    });

    try {
      const response = await fetch(`${baseUrl}/api/v2/tickets/${encodeURIComponent(ticketId)}`, {
        method: 'PUT',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Freshdesk API error (${response.status}): ${errorText}`,
        };
      }

      const ticket = await response.json();

      return { success: true, output: ticket };
    } catch (error) {
      return {
        success: false,
        error: `Failed to update Freshdesk ticket: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
});
