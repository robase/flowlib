/**
 * zendesk.create_ticket — Create a ticket in Zendesk
 *
 * Creates a new support ticket in a Zendesk instance with subject,
 * description, priority, type, and optional requester email.
 * Requires a Zendesk OAuth2 credential with ticket write scopes.
 */

import { defineAction } from '@flowlib/action-kit';
import { ZENDESK_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Zendesk credential is required'),
  subdomain: z.string().min(1, 'Zendesk subdomain is required'),
  subject: z.string().min(1, 'Ticket subject is required'),
  description: z.string().min(1, 'Ticket description is required'),
  priority: z.enum(['urgent', 'high', 'normal', 'low']).optional().default('normal'),
  type: z.enum(['problem', 'incident', 'question', 'task']).optional().default('question'),
  requesterEmail: z.string().optional().default(''),
});

export const zendeskCreateTicketAction = defineAction({
  id: 'zendesk.create_ticket',
  name: 'Create Ticket',
  description:
    'Create a new support ticket in Zendesk (POST /api/v2/tickets). Use when the user wants to open a support ticket. Call with `subject` and `description` (ticket body text); optionally set `priority` (urgent/high/normal/low), `type` (problem/incident/question/task), and `requesterEmail`.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"id": 35436, "subject": "Help!", "status": "new", "priority": "normal", "requester_id": 123, "created_at": "2024-01-15T10:00:00Z"}\n' +
    '```',
  provider: ZENDESK_PROVIDER,
  actionCategory: 'write',

  credential: {
    required: true,
    type: 'oauth2',
    oauth2Provider: 'zendesk',
    requiredScopes: ['write'],
    description: 'Zendesk OAuth2 credential with ticket write access',
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
        name: 'subject',
        label: 'Subject',
        type: 'text',
        required: true,
        placeholder: 'e.g. Cannot log in to my account',
        description: 'The subject line of the ticket',
        aiProvided: true,
      },
      {
        name: 'description',
        label: 'Description',
        type: 'textarea',
        required: true,
        placeholder: 'Describe the issue in detail...',
        description: 'The full description of the ticket. Supports {{ expression }} templating.',
        aiProvided: true,
      },
      {
        name: 'priority',
        label: 'Priority',
        type: 'select',
        defaultValue: 'normal',
        options: [
          { label: 'Urgent', value: 'urgent' },
          { label: 'High', value: 'high' },
          { label: 'Normal', value: 'normal' },
          { label: 'Low', value: 'low' },
        ],
        description: 'Ticket priority level.',
        aiProvided: true,
        extended: true,
      },
      {
        name: 'type',
        label: 'Type',
        type: 'select',
        defaultValue: 'question',
        options: [
          { label: 'Problem', value: 'problem' },
          { label: 'Incident', value: 'incident' },
          { label: 'Question', value: 'question' },
          { label: 'Task', value: 'task' },
        ],
        description: 'Ticket type.',
        aiProvided: true,
        extended: true,
      },
      {
        name: 'requesterEmail',
        label: 'Requester Email',
        type: 'text',
        placeholder: 'e.g. customer@example.com',
        description: 'Email of the ticket requester. Leave empty to use the authenticated user.',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['zendesk', 'tickets', 'create', 'support', 'oauth2'],

  async execute(params, context) {
    const { credentialId, subdomain, subject, description, priority, type, requesterEmail } =
      params;

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
    const url = `${baseUrl}/api/v2/tickets`;

    context.logger.debug('Creating Zendesk ticket', { subdomain, subject });

    const ticket: Record<string, unknown> = {
      subject,
      comment: { body: description },
      priority,
      type,
    };

    if (requesterEmail) {
      ticket.requester = { email: requesterEmail };
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ticket }),
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
        output: data.ticket ?? data,
      };
    } catch (err) {
      return {
        success: false,
        error: `Failed to create Zendesk ticket: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});
