/**
 * gmail.create_draft — Create a draft email in Gmail
 *
 * Creates a draft email that can be reviewed before sending.
 * Supports plain text and HTML bodies, CC/BCC, and reply threading.
 * Requires a Google Gmail OAuth2 credential.
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
    lines.push(`References: ${options.inReplyTo}`);
  }

  lines.push(`Content-Type: ${mimeType}; charset="UTF-8"`);
  lines.push('');
  lines.push(options.body);

  const raw = lines.join('\r\n');
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
  body: z.string().default(''),
  cc: z.string().optional().default(''),
  bcc: z.string().optional().default(''),
  isHtml: z.boolean().optional().default(false),
  threadId: z.string().optional().default(''),
  inReplyTo: z.string().optional().default(''),
});

export const gmailCreateDraftAction = defineAction({
  id: 'gmail.create_draft',
  name: 'Create Draft',
  description:
    'Create a draft email in Gmail (users.drafts.create). Use when the user wants to prepare an email for review before sending.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"draftId": "r123", "messageId": "18e1a2b", "threadId": "18e1a2b"}\n' +
    '```',
  provider: GMAIL_PROVIDER,
  actionCategory: 'write',
  tags: ['gmail', 'google', 'email', 'mail', 'draft', 'compose', 'write', 'prepare', 'oauth2'],

  credential: {
    required: true,
    type: 'oauth2',
    oauth2Provider: 'google',
    requiredScopes: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.compose',
      'https://www.googleapis.com/auth/gmail.modify',
    ],
    description: 'Gmail OAuth2 credential with compose permissions',
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
        placeholder: 'Draft subject',
        description: 'Email subject line',
        aiProvided: true,
      },
      {
        name: 'body',
        label: 'Body',
        type: 'textarea',
        placeholder: 'Draft body...',
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
        description: 'Gmail thread ID to place draft within (for threaded replies)',
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

    context.logger.debug('Creating Gmail draft', { to, subject, hasThread: !!threadId });

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

      const draftBody: { message: Record<string, string> } = {
        message: { raw },
      };
      if (threadId) {
        draftBody.message.threadId = threadId;
      }

      const response = await fetch(`${GMAIL_API_BASE}/drafts`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(draftBody),
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
        message: { id: string; threadId: string; labelIds: string[] };
      };

      return {
        success: true,
        output: {
          draftId: result.id,
          messageId: result.message.id,
          threadId: result.message.threadId,
          to,
          subject,
        },
        metadata: {
          draftId: result.id,
          messageId: result.message.id,
          to,
          subject,
          createdAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Gmail API error: ${msg}` };
    }
  },
});
