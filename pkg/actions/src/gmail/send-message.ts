/**
 * gmail.send_message — Send an email via Gmail
 *
 * Composes and sends an email message through the Gmail API.
 * Supports plain text and HTML bodies, CC/BCC, and reply threading.
 * Requires a Google Gmail OAuth2 credential with send scope.
 */

import { defineAction } from '@flowlib/action-kit';
import { GMAIL_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

/**
 * Build an RFC 2822 compliant email and base64url-encode it for the Gmail API.
 */
function buildRawEmail(options: {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
  isHtml?: boolean;
  inReplyTo?: string;
  references?: string;
}): string {
  const mimeType = options.isHtml ? 'text/html' : 'text/plain';

  const lines: string[] = [`To: ${options.to}`, `Subject: ${options.subject}`, `MIME-Version: 1.0`];

  if (options.cc) {
    lines.push(`Cc: ${options.cc}`);
  }
  if (options.bcc) {
    lines.push(`Bcc: ${options.bcc}`);
  }
  if (options.inReplyTo) {
    lines.push(`In-Reply-To: ${options.inReplyTo}`);
    lines.push(`References: ${options.references ?? options.inReplyTo}`);
  }

  lines.push(`Content-Type: ${mimeType}; charset="UTF-8"`);
  lines.push(''); // blank line separates headers from body
  lines.push(options.body);

  const raw = lines.join('\r\n');
  // base64url encoding (no padding)
  return Buffer.from(raw)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Gmail credential is required'),
  to: z.string().min(1, 'Recipient address is required'),
  subject: z.string().min(1, 'Subject is required'),
  body: z.string().min(1, 'Message body is required'),
  cc: z.string().optional().default(''),
  bcc: z.string().optional().default(''),
  isHtml: z.boolean().optional().default(false),
  threadId: z.string().optional().default(''),
  inReplyTo: z.string().optional().default(''),
});

export const gmailSendMessageAction = defineAction({
  id: 'gmail.send_message',
  name: 'Send Email',
  description:
    'Send an email via Gmail (users.messages.send). Use when the user wants to compose and send an email message.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"id": "18e1a2b3c4d5e6f7", "threadId": "18e1a2b3c4d5e6f7", "labelIds": ["SENT"]}\n' +
    '```',
  provider: GMAIL_PROVIDER,
  actionCategory: 'write',
  tags: [
    'gmail',
    'google',
    'email',
    'mail',
    'send',
    'compose',
    'write',
    'message',
    'notify',
    'oauth2',
  ],

  credential: {
    required: true,
    type: 'oauth2',
    oauth2Provider: 'google',
    requiredScopes: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.compose',
      'https://www.googleapis.com/auth/gmail.modify',
    ],
    description: 'Gmail OAuth2 credential with send permissions',
  },

  params: {
    schema: paramsSchema,
    fields: [
      {
        name: 'credentialId',
        label: 'Gmail Credential',
        type: 'text',
        required: true,
        description: 'Gmail OAuth2 credential for authentication',
        aiProvided: false,
      },
      {
        name: 'to',
        label: 'To',
        type: 'text',
        required: true,
        placeholder: 'recipient@example.com',
        description: 'Recipient email address(es). Comma-separate for multiple.',
        aiProvided: true,
      },
      {
        name: 'subject',
        label: 'Subject',
        type: 'text',
        required: true,
        placeholder: 'Meeting follow-up',
        description: 'Email subject line',
        aiProvided: true,
      },
      {
        name: 'body',
        label: 'Body',
        type: 'textarea',
        required: true,
        placeholder: 'Hello, ...',
        description: 'Email body content. Supports {{ expression }} templating.',
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
        name: 'isHtml',
        label: 'HTML Body',
        type: 'boolean',
        defaultValue: false,
        description: 'Whether the body is HTML formatted',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'threadId',
        label: 'Thread ID',
        type: 'text',
        description: 'Gmail thread ID to reply within (for threading)',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'inReplyTo',
        label: 'In-Reply-To',
        type: 'text',
        description: 'Message-ID header of the email being replied to',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  async execute(params, context) {
    const { credentialId, to, subject, body, cc, bcc, isHtml, threadId, inReplyTo } = params;

    // Resolve credential
    let credential = context.credential;
    if (!credential && context.functions?.getCredential) {
      credential = await context.functions.getCredential(credentialId);
    }
    if (!credential) {
      return {
        success: false,
        error: `Credential not found: ${credentialId}. Please create a Gmail OAuth2 credential.`,
      };
    }
    if (credential.authType !== 'oauth2') {
      return {
        success: false,
        error: `Invalid credential type: ${credential.authType}. Gmail requires an OAuth2 credential.`,
      };
    }

    const accessToken = credential.config?.accessToken as string;
    if (!accessToken) {
      return {
        success: false,
        error: 'No valid access token in credential. Please re-authorize the Gmail credential.',
      };
    }

    context.logger.debug('Sending email via Gmail', {
      to,
      subject,
      hasCC: !!cc,
      hasBCC: !!bcc,
      isHtml,
      hasThread: !!threadId,
    });

    try {
      const raw = buildRawEmail({
        to,
        subject,
        body,
        cc: cc || undefined,
        bcc: bcc || undefined,
        isHtml,
        inReplyTo: inReplyTo || undefined,
      });

      const sendBody: Record<string, string> = { raw };
      if (threadId) {
        sendBody.threadId = threadId;
      }

      const response = await fetch(`${GMAIL_API_BASE}/messages/send`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(sendBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Gmail API error (${response.status}): ${response.statusText} - ${errorText}`,
        };
      }

      const result = (await response.json()) as {
        id: string;
        threadId: string;
        labelIds: string[];
      };

      return {
        success: true,
        output: {
          messageId: result.id,
          threadId: result.threadId,
          labelIds: result.labelIds,
          to,
          subject,
        },
        metadata: {
          messageId: result.id,
          threadId: result.threadId,
          to,
          subject,
          sentAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Gmail API error: ${msg}` };
    }
  },
});
