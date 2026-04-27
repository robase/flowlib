/**
 * zendesk.update_ticket — Update a ticket in Zendesk
 *
 * Updates an existing Zendesk ticket. Supports changing status, priority,
 * subject, and adding public or internal comments.
 * Requires a Zendesk OAuth2 credential with ticket write scopes.
 */

import { defineAction } from '@flowlib/action-kit';
import { ZENDESK_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Zendesk credential is required'),
  subdomain: z.string().min(1, 'Zendesk subdomain is required'),
  ticketId: z.string().min(1, 'Ticket ID is required'),
  subject: z.string().optional().default(''),
  status: z.enum(['new', 'open', 'pending', 'hold', 'solved', 'closed']).optional(),
  priority: z.enum(['urgent', 'high', 'normal', 'low']).optional(),
  comment: z.string().optional().default(''),
  commentPublic: z.boolean().optional().default(true),
});

export const zendeskUpdateTicketAction = defineAction({
  id: 'zendesk.update_ticket',
  name: 'Update Ticket',
  description:
    'Update a Zendesk ticket (PUT /api/v2/tickets/{ticketId}). Use when the user wants to change a ticket\u2019s status, priority, subject, or add a comment. Call with `ticketId` and at least one of: `status` (new/open/pending/hold/solved/closed), `priority`, `subject`, or `comment` (with optional `commentPublic` flag for internal notes).\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"id": 35436, "subject": "Help!", "status": "solved", "priority": "normal", "updated_at": "2024-01-16T14:30:00Z"}\n' +
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
        name: 'ticketId',
        label: 'Ticket ID',
        type: 'text',
        required: true,
        placeholder: 'e.g. 12345',
        description: 'The numeric ID of the ticket to update',
        aiProvided: true,
      },
      {
        name: 'subject',
        label: 'Subject',
        type: 'text',
        placeholder: 'New subject (leave empty to keep current)',
        description: 'New ticket subject. Leave empty to keep current.',
        aiProvided: true,
        extended: true,
      },
      {
        name: 'status',
        label: 'Status',
        type: 'select',
        options: [
          { label: 'New', value: 'new' },
          { label: 'Open', value: 'open' },
          { label: 'Pending', value: 'pending' },
          { label: 'Hold', value: 'hold' },
          { label: 'Solved', value: 'solved' },
          { label: 'Closed', value: 'closed' },
        ],
        description: 'Set the ticket status.',
        aiProvided: true,
        extended: true,
      },
      {
        name: 'priority',
        label: 'Priority',
        type: 'select',
        options: [
          { label: 'Urgent', value: 'urgent' },
          { label: 'High', value: 'high' },
          { label: 'Normal', value: 'normal' },
          { label: 'Low', value: 'low' },
        ],
        description: 'Set the ticket priority.',
        aiProvided: true,
        extended: true,
      },
      {
        name: 'comment',
        label: 'Comment',
        type: 'textarea',
        placeholder: 'Add a comment to the ticket...',
        description: 'A comment to add to the ticket. Supports {{ expression }} templating.',
        aiProvided: true,
        extended: true,
      },
      {
        name: 'commentPublic',
        label: 'Public Comment',
        type: 'boolean',
        defaultValue: true,
        description: 'Whether the comment is public (visible to requester) or internal.',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['zendesk', 'tickets', 'update', 'support', 'oauth2'],

  async execute(params, context) {
    const { credentialId, subdomain, ticketId, subject, status, priority, comment, commentPublic } =
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
    const url = `${baseUrl}/api/v2/tickets/${encodeURIComponent(ticketId)}`;

    context.logger.debug('Updating Zendesk ticket', { subdomain, ticketId });

    // Build update payload — only include provided fields
    const ticket: Record<string, unknown> = {};
    if (subject) {
      ticket.subject = subject;
    }
    if (status) {
      ticket.status = status;
    }
    if (priority) {
      ticket.priority = priority;
    }
    if (comment) {
      ticket.comment = { body: comment, public: commentPublic };
    }

    if (Object.keys(ticket).length === 0) {
      return {
        success: false,
        error: 'No fields to update. Provide at least one field to change.',
      };
    }

    try {
      const response = await fetch(url, {
        method: 'PUT',
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
        error: `Failed to update Zendesk ticket: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});
