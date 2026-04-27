/**
 * freshdesk.create_ticket — Create a new Freshdesk ticket
 *
 * Creates a support ticket in a Freshdesk domain with subject, description,
 * requester email, priority, and status.
 * Supports OAuth2 Bearer token or API key (Basic) authentication.
 */

import { defineAction } from '@flowlib/action-kit';
import { FRESHDESK_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Freshdesk credential is required'),
  domain: z.string().min(1, 'Freshdesk domain is required'),
  subject: z.string().min(1, 'Subject is required'),
  description: z.string().min(1, 'Description is required'),
  email: z.string().email('Valid requester email is required'),
  priority: z.number().int().min(1).max(4).optional().default(1),
  status: z.number().int().min(2).max(5).optional().default(2),
  type: z.string().optional(),
  tags: z.array(z.string()).optional(),
  ccEmails: z.array(z.string()).optional(),
  groupId: z.number().int().optional(),
  responderId: z.number().int().optional(),
});

export const freshdeskCreateTicketAction = defineAction({
  id: 'freshdesk.create_ticket',
  name: 'Create Ticket',
  description:
    'Create a new support ticket in Freshdesk (POST /api/v2/tickets). Use when the user wants to open a ticket. ' +
    'Required: `subject`, `description` (HTML or plain text), and `email` (requester). ' +
    'Optional: `priority` (1=Low, 2=Medium, 3=High, 4=Urgent), `status` (2=Open, 3=Pending, 4=Resolved, 5=Closed), ' +
    "`type`, `tags`, `cc_emails`, `group_id`, `responder_id`. If the email doesn't exist in Freshdesk, a new contact is created.\n\n" +
    'Example response:\n' +
    '```json\n' +
    '{"id": 1, "subject": "Issue with billing", "status": 2, "priority": 1, "requester_id": 123, "group_id": null, "type": null, "tags": [], "created_at": "2025-01-15T10:00:00Z"}\n' +
    '```',
  provider: FRESHDESK_PROVIDER,
  actionCategory: 'write',
  tags: ['freshdesk', 'support', 'ticket', 'helpdesk', 'create', 'oauth2'],

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
        name: 'subject',
        label: 'Subject',
        type: 'text',
        required: true,
        placeholder: 'Issue with billing',
        description: 'The subject / title of the ticket',
        aiProvided: true,
      },
      {
        name: 'description',
        label: 'Description',
        type: 'textarea',
        required: true,
        placeholder: 'Describe the issue in detail…',
        description: 'HTML or plain-text body of the ticket',
        aiProvided: true,
      },
      {
        name: 'email',
        label: 'Requester Email',
        type: 'text',
        required: true,
        placeholder: 'customer@example.com',
        description: 'Email address of the requester',
        aiProvided: true,
      },
      {
        name: 'priority',
        label: 'Priority',
        type: 'select',
        defaultValue: 1,
        description: 'Ticket priority',
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
        name: 'status',
        label: 'Status',
        type: 'select',
        defaultValue: 2,
        description: 'Ticket status',
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
        name: 'type',
        label: 'Type',
        type: 'text',
        placeholder: 'Problem',
        description: 'Ticket type (e.g. Question, Incident, Problem, Feature Request)',
        aiProvided: true,
        extended: true,
      },
      {
        name: 'tags',
        label: 'Tags',
        type: 'json',
        placeholder: '["billing", "urgent"]',
        description: 'Array of tags to associate with the ticket',
        aiProvided: true,
        extended: true,
      },
      {
        name: 'ccEmails',
        label: 'CC Emails',
        type: 'json',
        placeholder: '["manager@example.com"]',
        description: 'Array of email addresses to CC on the ticket',
        aiProvided: true,
        extended: true,
      },
      {
        name: 'groupId',
        label: 'Group ID',
        type: 'number',
        description: 'ID of the agent group to assign the ticket to',
        aiProvided: true,
        extended: true,
      },
      {
        name: 'responderId',
        label: 'Responder ID',
        type: 'number',
        description: 'ID of the agent to assign the ticket to',
        aiProvided: true,
        extended: true,
      },
    ],
  },

  async execute(params, context) {
    const {
      credentialId,
      domain,
      subject,
      description,
      email,
      priority,
      status,
      type,
      tags,
      ccEmails,
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

    context.logger.debug('Creating Freshdesk ticket', { domain, subject, email });

    try {
      const response = await fetch(`${baseUrl}/api/v2/tickets`, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          subject,
          description,
          email,
          priority,
          status,
          ...(type && { type }),
          ...(tags && tags.length > 0 && { tags }),
          ...(ccEmails && ccEmails.length > 0 && { cc_emails: ccEmails }),
          ...(groupId && { group_id: groupId }),
          ...(responderId && { responder_id: responderId }),
        }),
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
        error: `Failed to create Freshdesk ticket: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
});
