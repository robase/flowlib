/**
 * microsoft.get_message — Get full email details
 *
 * Retrieves the full content of a single email by its message ID,
 * including body (text & HTML), headers, and attachment metadata.
 * Requires a Microsoft 365 OAuth2 credential with Mail.Read scope.
 */

import { defineAction } from '@flowlib/action-kit';
import { MICROSOFT_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0';

interface GraphFullMessage {
  id: string;
  createdDateTime: string;
  lastModifiedDateTime: string;
  receivedDateTime: string;
  sentDateTime: string;
  subject: string;
  bodyPreview: string;
  body: { contentType: string; content: string };
  importance: string;
  isRead: boolean;
  isDraft: boolean;
  hasAttachments: boolean;
  from?: { emailAddress: { name: string; address: string } };
  sender?: { emailAddress: { name: string; address: string } };
  toRecipients?: Array<{ emailAddress: { name: string; address: string } }>;
  ccRecipients?: Array<{ emailAddress: { name: string; address: string } }>;
  bccRecipients?: Array<{ emailAddress: { name: string; address: string } }>;
  replyTo?: Array<{ emailAddress: { name: string; address: string } }>;
  categories: string[];
  webLink: string;
  conversationId: string;
  conversationIndex: string;
  internetMessageId: string;
  flag?: { flagStatus: string };
}

interface GraphAttachment {
  id: string;
  name: string;
  contentType: string;
  size: number;
  isInline: boolean;
  lastModifiedDateTime: string;
}

interface GraphAttachmentsResponse {
  value: GraphAttachment[];
}

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Microsoft 365 credential is required'),
  messageId: z.string().min(1, 'Message ID is required'),
  includeAttachments: z.boolean().optional().default(true),
  preferTextBody: z.boolean().optional().default(false),
});

export const microsoftGetMessageAction = defineAction({
  id: 'microsoft.get_message',
  name: 'Get Email',
  description:
    'Get the full content of a single email by its message ID (GET /me/messages/{id}). Use when you need to read the full body, headers, or attachments of a specific email.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"id": "AAMkAGI1A...", "subject": "Re: Project Update", "body": {"contentType": "html", "content": "<html>...</html>"}, "from": {"emailAddress": {"name": "Jane", "address": "jane@example.com"}}, "hasAttachments": true}\n' +
    '```',
  provider: MICROSOFT_PROVIDER,
  actionCategory: 'read',

  credential: {
    required: true,
    type: 'oauth2',
    oauth2Provider: 'microsoft',
    requiredScopes: ['Mail.Read'],
    description: 'Microsoft 365 OAuth2 credential with Mail.Read scope',
  },

  params: {
    schema: paramsSchema,
    fields: [
      {
        name: 'credentialId',
        label: 'Microsoft 365 Credential',
        type: 'text',
        required: true,
        description: 'Microsoft 365 OAuth2 credential for authentication',
        aiProvided: false,
      },
      {
        name: 'messageId',
        label: 'Message ID',
        type: 'text',
        required: true,
        placeholder: 'AAMkAGI1A...',
        description: 'The message ID to retrieve (from list_messages output)',
        aiProvided: true,
      },
      {
        name: 'includeAttachments',
        label: 'Include Attachments',
        type: 'boolean',
        defaultValue: true,
        description: 'Fetch attachment metadata (names, sizes, content types)',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'preferTextBody',
        label: 'Prefer Plain Text',
        type: 'boolean',
        defaultValue: false,
        description:
          'Request plain text body instead of HTML (via Prefer header). Useful for AI processing.',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['microsoft', 'outlook', 'email', 'mail', 'read', 'graph', 'oauth2'],

  async execute(params, context) {
    const { credentialId, messageId, includeAttachments, preferTextBody } = params;

    let credential = context.credential;
    if (!credential && context.functions?.getCredential) {
      credential = await context.functions.getCredential(credentialId);
    }
    if (!credential) {
      return { success: false, error: `Credential not found: ${credentialId}` };
    }

    const accessToken = credential.config?.accessToken as string;
    if (!accessToken) {
      return { success: false, error: 'No valid access token. Please re-authorize.' };
    }

    context.logger.debug('Fetching Microsoft 365 message', { messageId });

    try {
      const url = `${GRAPH_API_BASE}/me/messages/${encodeURIComponent(messageId)}`;

      const headers: Record<string, string> = {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      };

      if (preferTextBody) {
        headers['Prefer'] = 'outlook.body-content-type="text"';
      }

      const response = await fetch(url, { headers });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Microsoft Graph API error: ${response.status} - ${errorText}`,
        };
      }

      const msg = (await response.json()) as GraphFullMessage;

      // Optionally fetch attachment metadata
      let attachments: Array<{
        id: string;
        name: string;
        contentType: string;
        size: number;
        isInline: boolean;
      }> = [];

      if (includeAttachments && msg.hasAttachments) {
        try {
          const attachUrl = `${url}/attachments?$select=id,name,contentType,size,isInline`;
          const attachResp = await fetch(attachUrl, {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: 'application/json',
            },
          });
          if (attachResp.ok) {
            const attachData = (await attachResp.json()) as GraphAttachmentsResponse;
            attachments = attachData.value.map((a) => ({
              id: a.id,
              name: a.name,
              contentType: a.contentType,
              size: a.size,
              isInline: a.isInline,
            }));
          }
        } catch {
          // Non-fatal — continue without attachment info
          context.logger.debug('Failed to fetch attachments for message', { messageId });
        }
      }

      return {
        success: true,
        output: {
          id: msg.id,
          subject: msg.subject,
          bodyPreview: msg.bodyPreview,
          body: {
            contentType: msg.body.contentType,
            content: msg.body.content,
          },
          from: msg.from?.emailAddress ?? null,
          sender: msg.sender?.emailAddress ?? null,
          to: msg.toRecipients?.map((r) => r.emailAddress) ?? [],
          cc: msg.ccRecipients?.map((r) => r.emailAddress) ?? [],
          bcc: msg.bccRecipients?.map((r) => r.emailAddress) ?? [],
          replyTo: msg.replyTo?.map((r) => r.emailAddress) ?? [],
          receivedDateTime: msg.receivedDateTime,
          sentDateTime: msg.sentDateTime,
          isRead: msg.isRead,
          isDraft: msg.isDraft,
          importance: msg.importance,
          hasAttachments: msg.hasAttachments,
          attachments,
          categories: msg.categories,
          webLink: msg.webLink,
          conversationId: msg.conversationId,
          internetMessageId: msg.internetMessageId,
          flagStatus: msg.flag?.flagStatus ?? null,
        },
        metadata: {
          messageId: msg.id,
          hasAttachments: msg.hasAttachments,
          attachmentCount: attachments.length,
        },
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Microsoft Graph get message failed: ${errMsg}` };
    }
  },
});
