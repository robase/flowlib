/**
 * sendgrid.get_email_activity — Retrieve email activity/events
 *
 * Queries the SendGrid Email Activity Feed to find messages and their
 * delivery status. Useful for tracking whether emails were delivered,
 * opened, clicked, bounced, etc.
 *
 * @see https://www.twilio.com/docs/sendgrid/api-reference/email-activity/filter-all-messages
 */

import { defineAction } from '@flowlib/action-kit';
import { SENDGRID_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'SendGrid credential is required'),
  baseUrl: z.string().optional().default('https://api.sendgrid.com'),
  query: z.string().optional().default(''),
  limit: z.number().int().min(1).max(1000).optional().default(10),
});

export const sendgridGetEmailActivityAction = defineAction({
  id: 'sendgrid.get_email_activity',
  name: 'Get Email Activity',
  description:
    'Query the SendGrid Email Activity Feed (GET /v3/messages). Call with an optional `query` filter string (e.g. `to_email="user@example.com"`, `status="delivered"`, `subject="Hello"`) and `limit` (1–1000, default 10). Use when the user wants to track delivery status of specific emails — delivered, opened, clicked, bounced, deferred, etc. Requires an API key with Email Activity Feed access enabled.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"messages": [{"msg_id": "abc123", "from_email": "sender@example.com", "to_email": "user@example.com", "subject": "Hello", "status": "delivered", "opens_count": 2, "clicks_count": 1, "last_event_time": "2024-01-15T10:30:00Z"}]}\n' +
    '```',
  provider: SENDGRID_PROVIDER,
  actionCategory: 'read',
  tags: ['sendgrid', 'email', 'activity', 'tracking', 'events', 'delivery'],

  credential: {
    required: true,
    description: 'SendGrid API key credential',
  },

  params: {
    schema: paramsSchema,
    fields: [
      {
        name: 'credentialId',
        label: 'SendGrid Credential',
        type: 'text',
        required: true,
        description: 'SendGrid API key credential for authentication',
        aiProvided: false,
      },
      {
        name: 'baseUrl',
        label: 'API Base URL',
        type: 'text',
        required: false,
        defaultValue: 'https://api.sendgrid.com',
        description: 'SendGrid API base URL',
        extended: true,
        aiProvided: false,
      },
      {
        name: 'query',
        label: 'Search Query',
        type: 'text',
        required: false,
        placeholder: 'to_email="user@example.com"',
        description:
          'Filter query for email activity (e.g. to_email, subject, status). See SendGrid query syntax.',
        aiProvided: true,
      },
      {
        name: 'limit',
        label: 'Limit',
        type: 'number',
        required: false,
        defaultValue: 10,
        description: 'Maximum number of messages to return (1–1000)',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  async execute(params, context) {
    const { credentialId, baseUrl, query, limit } = params;

    let credential = context.credential;
    if (!credential && context.functions?.getCredential) {
      credential = await context.functions.getCredential(credentialId);
    }
    if (!credential) {
      return {
        success: false,
        error: `Credential not found: ${credentialId}. Please create a SendGrid API key credential.`,
      };
    }

    const apiKey = (credential.config?.apiKey as string) ?? (credential.config?.token as string);
    if (!apiKey) {
      return {
        success: false,
        error: 'No API key found in credential. Please add a SendGrid API key.',
      };
    }

    const apiBase = baseUrl || 'https://api.sendgrid.com';
    const queryParams = new URLSearchParams();
    if (query) {
      queryParams.set('query', query);
    }
    if (limit) {
      queryParams.set('limit', String(limit));
    }

    const qs = queryParams.toString();
    const url = `${apiBase}/v3/messages${qs ? `?${qs}` : ''}`;

    context.logger.debug('Querying SendGrid email activity', { query, limit });

    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'User-Agent': 'flowlib/1.0',
        },
      });

      if (!response.ok) {
        const errorBody = await response.text();
        return { success: false, error: `SendGrid API error ${response.status}: ${errorBody}` };
      }

      const result = (await response.json()) as { messages?: unknown[] };

      return {
        success: true,
        output: {
          messages: result.messages ?? [],
          count: Array.isArray(result.messages) ? result.messages.length : 0,
        },
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Failed to query SendGrid email activity: ${message}` };
    }
  },
});
