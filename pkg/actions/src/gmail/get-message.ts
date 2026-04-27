/**
 * gmail.get_message — Get full email details
 *
 * Retrieves the full content of a single Gmail message by ID,
 * including headers, body (plain text & HTML), and attachments metadata.
 * Requires a Google Gmail OAuth2 credential.
 */

import { defineAction } from '@flowlib/action-kit';
import { GMAIL_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

interface GmailFullMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  sizeEstimate?: number;
  payload?: GmailPayload;
}

interface GmailPayload {
  mimeType?: string;
  headers?: Array<{ name: string; value: string }>;
  body?: { size: number; data?: string };
  parts?: GmailPayload[];
  filename?: string;
}

function getHeader(
  headers: Array<{ name: string; value: string }> | undefined,
  name: string,
): string | undefined {
  return headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;
}

/** Decode base64url-encoded body data from Gmail API. */
function decodeBody(data: string | undefined): string {
  if (!data) {
    return '';
  }
  // Gmail uses base64url encoding (- instead of +, _ instead of /)
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64').toString('utf-8');
}

/** Recursively extract text bodies and attachment info from the MIME tree. */
function extractContent(payload: GmailPayload | undefined): {
  textBody: string;
  htmlBody: string;
  attachments: Array<{ filename: string; mimeType: string; size: number }>;
} {
  const result = {
    textBody: '',
    htmlBody: '',
    attachments: [] as Array<{ filename: string; mimeType: string; size: number }>,
  };
  if (!payload) {
    return result;
  }

  // Single-part message
  if (!payload.parts) {
    if (payload.mimeType === 'text/plain' && payload.body?.data) {
      result.textBody = decodeBody(payload.body.data);
    } else if (payload.mimeType === 'text/html' && payload.body?.data) {
      result.htmlBody = decodeBody(payload.body.data);
    } else if (payload.filename && payload.body?.size) {
      result.attachments.push({
        filename: payload.filename,
        mimeType: payload.mimeType ?? 'application/octet-stream',
        size: payload.body.size,
      });
    }
    return result;
  }

  // Multipart — recurse into parts
  for (const part of payload.parts) {
    const sub = extractContent(part);
    if (!result.textBody && sub.textBody) {
      result.textBody = sub.textBody;
    }
    if (!result.htmlBody && sub.htmlBody) {
      result.htmlBody = sub.htmlBody;
    }
    result.attachments.push(...sub.attachments);
  }

  return result;
}

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Gmail credential is required'),
  messageId: z
    .string()
    .min(1, 'Message ID is required')
    .refine((id) => !id.includes('@'), {
      message:
        'Message ID cannot be an email address. Use the numeric/alphanumeric ID from gmail.list_messages (e.g. "18e1a2b3c4d5e6f7").',
    }),
  format: z.enum(['full', 'metadata', 'minimal']).optional().default('full'),
});

export const gmailGetMessageAction = defineAction({
  id: 'gmail.get_message',
  name: 'Get Email',
  description:
    'Get the full content of a single email by its Gmail message ID (users.messages.get). ' +
    'The messageId is an opaque alphanumeric string (e.g. "18e1a2b3c4d5e6f7") returned by gmail.list_messages — it is NOT an email address. ' +
    'You must call gmail.list_messages first to obtain valid message IDs.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"id": "18e1a2b", "threadId": "18e1a2b", "from": "alice@example.com", "subject": "Hello", "textBody": "...", "attachments": []}\n' +
    '```',
  provider: GMAIL_PROVIDER,
  actionCategory: 'read',
  tags: [
    'gmail',
    'google',
    'email',
    'mail',
    'read',
    'get',
    'fetch',
    'message',
    'content',
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
    description: 'Gmail OAuth2 credential for authentication',
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
        name: 'messageId',
        label: 'Message ID',
        type: 'text',
        required: true,
        placeholder: '18e1a2b3c4d5e6f7',
        description:
          'The Gmail message ID to retrieve. This is an alphanumeric string from gmail.list_messages output, NOT an email address.',
        aiProvided: true,
      },
      {
        name: 'format',
        label: 'Format',
        type: 'select',
        defaultValue: 'full',
        options: [
          { label: 'Full (headers + body)', value: 'full' },
          { label: 'Metadata (headers only)', value: 'metadata' },
          { label: 'Minimal (IDs + labels only)', value: 'minimal' },
        ],
        description: 'Level of detail to retrieve',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  async execute(params, context) {
    const { credentialId, messageId, format } = params;

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

    context.logger.debug('Fetching Gmail message', { messageId, format });

    try {
      const url = new URL(`${GMAIL_API_BASE}/messages/${encodeURIComponent(messageId)}`);
      url.searchParams.set('format', format);

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        // Add helpful context for common errors
        if (response.status === 400 && errorText.includes('Invalid id value')) {
          return {
            success: false,
            error:
              `Gmail API error (400): Invalid message ID "${messageId}". ` +
              'Message IDs are alphanumeric strings like "18e1a2b3c4d5e6f7", not email addresses. ' +
              'Call gmail.list_messages first to get valid message IDs.',
          };
        }
        return {
          success: false,
          error: `Gmail API error (${response.status}): ${response.statusText} - ${errorText}`,
        };
      }

      const msg = (await response.json()) as GmailFullMessage;
      const headers = msg.payload?.headers;
      const content = format === 'full' ? extractContent(msg.payload) : null;

      return {
        success: true,
        output: {
          id: msg.id,
          threadId: msg.threadId,
          labelIds: msg.labelIds ?? [],
          snippet: msg.snippet ?? '',
          from: getHeader(headers, 'From'),
          to: getHeader(headers, 'To'),
          cc: getHeader(headers, 'Cc'),
          subject: getHeader(headers, 'Subject'),
          date: getHeader(headers, 'Date'),
          messageId: getHeader(headers, 'Message-ID'),
          ...(content
            ? {
                textBody: content.textBody,
                htmlBody: content.htmlBody,
                attachments: content.attachments,
              }
            : {}),
          sizeEstimate: msg.sizeEstimate,
          internalDate: msg.internalDate,
          isUnread: msg.labelIds?.includes('UNREAD') ?? false,
          isStarred: msg.labelIds?.includes('STARRED') ?? false,
        },
        metadata: {
          messageId: msg.id,
          format,
          hasAttachments: (content?.attachments.length ?? 0) > 0,
        },
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Gmail get message failed: ${errMsg}` };
    }
  },
});
