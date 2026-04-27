/**
 * resend.send_email — Send an email via Resend
 *
 * Sends a transactional email through the Resend API.
 * Supports plain text and HTML bodies, CC/BCC, reply-to, scheduled sending,
 * and custom tags. Requires a Resend API key credential.
 *
 * @see https://resend.com/docs/api-reference/emails/send-email
 */

import { defineAction } from '@flowlib/action-kit';
import { RESEND_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const RESEND_API_BASE = 'https://api.resend.com';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Resend credential is required'),
  from: z.string().min(1, 'Sender address is required'),
  to: z.string().min(1, 'Recipient address is required'),
  subject: z.string().min(1, 'Subject is required'),
  html: z.string().optional().default(''),
  text: z.string().optional().default(''),
  cc: z.string().optional().default(''),
  bcc: z.string().optional().default(''),
  replyTo: z.string().optional().default(''),
  scheduledAt: z.string().optional().default(''),
});

export const resendSendEmailAction = defineAction({
  id: 'resend.send_email',
  name: 'Send Email',
  description:
    'Send a transactional email via Resend (POST /emails). Use when the user wants to send a single email with HTML or plain text content.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"id": "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794"}\n' +
    '```',
  provider: RESEND_PROVIDER,
  actionCategory: 'write',
  tags: ['resend', 'email', 'send', 'transactional', 'mail', 'notify'],

  credential: {
    required: true,
    description: 'Resend API key credential',
  },

  params: {
    schema: paramsSchema,
    fields: [
      {
        name: 'credentialId',
        label: 'Resend Credential',
        type: 'text',
        required: true,
        description: 'Resend API key credential for authentication',
        aiProvided: false,
      },
      {
        name: 'from',
        label: 'From',
        type: 'text',
        required: true,
        placeholder: 'Your Name <you@yourdomain.com>',
        description: 'Sender email address. Use "Name <email>" format for friendly names.',
        aiProvided: true,
      },
      {
        name: 'to',
        label: 'To',
        type: 'text',
        required: true,
        placeholder: 'recipient@example.com',
        description: 'Recipient email address(es). Comma-separate for multiple (max 50).',
        aiProvided: true,
      },
      {
        name: 'subject',
        label: 'Subject',
        type: 'text',
        required: true,
        placeholder: 'Welcome to our service',
        description: 'Email subject line',
        aiProvided: true,
      },
      {
        name: 'html',
        label: 'HTML Body',
        type: 'textarea',
        required: false,
        placeholder: '<p>Hello, ...</p>',
        description: 'HTML version of the email body. Supports {{ expression }} templating.',
        aiProvided: true,
      },
      {
        name: 'text',
        label: 'Text Body',
        type: 'textarea',
        required: false,
        placeholder: 'Hello, ...',
        description: 'Plain text version. If omitted, Resend auto-generates from HTML.',
        aiProvided: true,
      },
      {
        name: 'cc',
        label: 'CC',
        type: 'text',
        placeholder: 'cc@example.com',
        description: 'CC recipients (comma-separated)',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'bcc',
        label: 'BCC',
        type: 'text',
        placeholder: 'bcc@example.com',
        description: 'BCC recipients (comma-separated)',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'replyTo',
        label: 'Reply-To',
        type: 'text',
        placeholder: 'reply@example.com',
        description: 'Reply-to address (comma-separated for multiple)',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'scheduledAt',
        label: 'Schedule At',
        type: 'text',
        placeholder: '2024-12-25T10:00:00Z',
        description: 'Schedule delivery time in ISO 8601 or natural language (e.g. "in 1 hour")',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  async execute(params, context) {
    const { credentialId, from, to, subject, html, text, cc, bcc, replyTo, scheduledAt } = params;

    let credential = context.credential;
    if (!credential && context.functions?.getCredential) {
      credential = await context.functions.getCredential(credentialId);
    }
    if (!credential) {
      return {
        success: false,
        error: `Credential not found: ${credentialId}. Please create a Resend API key credential.`,
      };
    }

    const apiKey = (credential.config?.apiKey as string) ?? (credential.config?.token as string);
    if (!apiKey) {
      return {
        success: false,
        error: 'No API key found in credential. Please add a Resend API key.',
      };
    }

    // Build recipients — split comma-separated strings into arrays
    const toArray = to
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const body: Record<string, unknown> = {
      from,
      to: toArray,
      subject,
    };

    if (html) {
      body.html = html;
    }
    if (text) {
      body.text = text;
    }
    if (cc) {
      body.cc = cc
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
    if (bcc) {
      body.bcc = bcc
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
    if (replyTo) {
      body.reply_to = replyTo
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
    if (scheduledAt) {
      body.scheduledAt = scheduledAt;
    }

    context.logger.debug('Sending email via Resend', { from, to: toArray, subject });

    try {
      const response = await fetch(`${RESEND_API_BASE}/emails`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'User-Agent': 'flowlib/1.0',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        return { success: false, error: `Resend API error ${response.status}: ${errorBody}` };
      }

      const result = (await response.json()) as { id: string };

      return {
        success: true,
        output: {
          id: result.id,
          message: `Email sent successfully to ${toArray.join(', ')}`,
        },
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Failed to send email via Resend: ${message}` };
    }
  },
});
