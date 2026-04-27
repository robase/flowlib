/**
 * sendgrid.send_email — Send an email via SendGrid v3 API
 *
 * Sends a transactional email through the SendGrid Mail Send endpoint.
 * Supports HTML and plain text bodies, CC/BCC, reply-to, scheduled sending,
 * and dynamic template IDs. Requires a SendGrid API key credential.
 *
 * @see https://www.twilio.com/docs/sendgrid/api-reference/mail-send/mail-send
 */

import { defineAction } from '@flowlib/action-kit';
import { SENDGRID_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'SendGrid credential is required'),
  baseUrl: z.string().optional().default('https://api.sendgrid.com'),
  from: z.string().min(1, 'Sender address is required'),
  fromName: z.string().optional().default(''),
  to: z.string().min(1, 'Recipient address is required'),
  subject: z.string().min(1, 'Subject is required'),
  html: z.string().optional().default(''),
  text: z.string().optional().default(''),
  cc: z.string().optional().default(''),
  bcc: z.string().optional().default(''),
  replyTo: z.string().optional().default(''),
  templateId: z.string().optional().default(''),
  dynamicTemplateData: z.string().optional().default(''),
  sendAt: z.number().int().optional(),
});

/** Split comma-separated emails into SendGrid {email,name?} objects. */
function parseRecipients(raw: string): Array<{ email: string; name?: string }> {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((addr) => {
      // Handle "Name <email>" format
      const match = addr.match(/^(.+?)\s*<(.+?)>$/);
      if (match) {
        return { email: match[2].trim(), name: match[1].trim() };
      }
      return { email: addr };
    });
}

export const sendgridSendEmailAction = defineAction({
  id: 'sendgrid.send_email',
  name: 'Send Email',
  description:
    'Send a transactional email via SendGrid (POST /v3/mail/send). Call with `to`, `subject`, and either `html`/`text` body or a `templateId` with `dynamicTemplateData`. Supports `cc`, `bcc`, `replyTo`, and scheduled sending via `sendAt` (Unix timestamp, up to 72h ahead). The `from` address must be a verified sender or domain.\n\nReturns HTTP 202 Accepted with no JSON body. The `x-message-id` header contains the tracking ID.\n\nExample output:\n```json\n{"message": "Email sent successfully to user@example.com", "messageId": "abc123def456", "statusCode": 202}\n```',
  provider: SENDGRID_PROVIDER,
  actionCategory: 'write',
  tags: ['sendgrid', 'twilio', 'email', 'send', 'transactional', 'mail', 'notify'],

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
        placeholder: 'https://api.sendgrid.com',
        description:
          'SendGrid API base URL. Use https://api.eu.sendgrid.com for EU regional subusers.',
        extended: true,
        aiProvided: false,
      },
      {
        name: 'from',
        label: 'From Email',
        type: 'text',
        required: true,
        placeholder: 'sender@yourdomain.com',
        description: 'Sender email address (must be a verified sender or domain)',
        aiProvided: true,
      },
      {
        name: 'fromName',
        label: 'From Name',
        type: 'text',
        required: false,
        placeholder: 'Your Company',
        description: 'Friendly sender display name',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'to',
        label: 'To',
        type: 'text',
        required: true,
        placeholder: 'recipient@example.com',
        description: 'Recipient email address(es). Comma-separate for multiple (max 1,000 total).',
        aiProvided: true,
      },
      {
        name: 'subject',
        label: 'Subject',
        type: 'text',
        required: true,
        placeholder: 'Order confirmation',
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
        description: 'Plain text version of the email body',
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
        description: 'Reply-to email address',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'templateId',
        label: 'Template ID',
        type: 'text',
        placeholder: 'd-xxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        description: 'SendGrid dynamic template ID. When set, html/text are ignored.',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'dynamicTemplateData',
        label: 'Template Data (JSON)',
        type: 'code',
        placeholder: '{"name": "Alice", "orderId": "12345"}',
        description: 'JSON object of variables for the dynamic template',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'sendAt',
        label: 'Send At (Unix Timestamp)',
        type: 'number',
        description: 'Schedule delivery as a Unix timestamp (up to 72 hours in advance)',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  async execute(params, context) {
    const {
      credentialId,
      baseUrl,
      from,
      fromName,
      to,
      subject,
      html,
      text,
      cc,
      bcc,
      replyTo,
      templateId,
      dynamicTemplateData,
      sendAt,
    } = params;

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

    const toRecipients = parseRecipients(to);

    // Build personalizations
    const personalization: Record<string, unknown> = { to: toRecipients };
    if (cc) {
      personalization.cc = parseRecipients(cc);
    }
    if (bcc) {
      personalization.bcc = parseRecipients(bcc);
    }
    if (templateId && dynamicTemplateData) {
      try {
        personalization.dynamic_template_data = JSON.parse(dynamicTemplateData);
      } catch {
        return { success: false, error: `Invalid JSON for dynamic template data` };
      }
    }

    const fromObj: Record<string, string> = { email: from };
    if (fromName) {
      fromObj.name = fromName;
    }

    const payload: Record<string, unknown> = {
      personalizations: [personalization],
      from: fromObj,
      subject,
    };

    // Template vs content
    if (templateId) {
      payload.template_id = templateId;
    } else {
      const content: Array<{ type: string; value: string }> = [];
      if (text) {
        content.push({ type: 'text/plain', value: text });
      }
      if (html) {
        content.push({ type: 'text/html', value: html });
      }
      if (content.length === 0) {
        return { success: false, error: 'Either html, text, or templateId must be provided' };
      }
      payload.content = content;
    }

    if (replyTo) {
      const parsed = parseRecipients(replyTo);
      if (parsed.length > 0) {
        payload.reply_to = parsed[0];
      }
    }
    if (sendAt) {
      payload.send_at = sendAt;
    }

    const apiBase = baseUrl || 'https://api.sendgrid.com';

    context.logger.debug('Sending email via SendGrid', {
      from,
      to: toRecipients.map((r) => r.email),
      subject,
    });

    try {
      const response = await fetch(`${apiBase}/v3/mail/send`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'User-Agent': 'flowlib/1.0',
        },
        body: JSON.stringify(payload),
      });

      // SendGrid returns 202 Accepted on success with empty body
      if (response.status === 202) {
        const messageId = response.headers.get('X-Message-Id') ?? undefined;
        return {
          success: true,
          output: {
            message: `Email sent successfully to ${toRecipients.map((r) => r.email).join(', ')}`,
            messageId,
            statusCode: 202,
          },
        };
      }

      if (!response.ok) {
        const errorBody = await response.text();
        return { success: false, error: `SendGrid API error ${response.status}: ${errorBody}` };
      }

      return {
        success: true,
        output: {
          message: `Email sent successfully`,
          statusCode: response.status,
        },
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Failed to send email via SendGrid: ${message}` };
    }
  },
});
