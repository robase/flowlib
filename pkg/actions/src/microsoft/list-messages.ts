/**
 * microsoft.list_messages — List / search Outlook emails
 *
 * Searches and retrieves email messages from the authenticated user's mailbox
 * via the Microsoft Graph API.
 * Requires a Microsoft 365 OAuth2 credential with Mail.Read scope.
 */

import { defineAction } from '@flowlib/action-kit';
import { MICROSOFT_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0';

interface GraphMessage {
  id: string;
  createdDateTime: string;
  lastModifiedDateTime: string;
  receivedDateTime: string;
  sentDateTime: string;
  subject: string;
  bodyPreview: string;
  importance: string;
  isRead: boolean;
  isDraft: boolean;
  hasAttachments: boolean;
  from?: { emailAddress: { name: string; address: string } };
  toRecipients?: Array<{ emailAddress: { name: string; address: string } }>;
  ccRecipients?: Array<{ emailAddress: { name: string; address: string } }>;
  categories: string[];
  webLink: string;
  conversationId: string;
  flag?: { flagStatus: string };
}

interface GraphMessagesResponse {
  value: GraphMessage[];
  '@odata.count'?: number;
  '@odata.nextLink'?: string;
}

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Microsoft 365 credential is required'),
  top: z.number().int().min(1).max(100).optional().default(25),
  search: z.string().optional().default(''),
  filter: z.string().optional().default(''),
  folder: z.string().optional().default(''),
  orderBy: z.string().optional().default('receivedDateTime desc'),
  includeCount: z.boolean().optional().default(false),
});

export const microsoftListMessagesAction = defineAction({
  id: 'microsoft.list_messages',
  name: 'List Emails',
  description:
    'List or search emails from a Microsoft 365 / Outlook mailbox (GET /me/messages). Use when you need to search or browse emails in Outlook.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"id": "AAMkAGI1A...", "subject": "Quarterly Report", "from": {"emailAddress": {"name": "Jane", "address": "jane@example.com"}}, "receivedDateTime": "2025-01-15T10:30:00Z", "isRead": true}\n' +
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
        name: 'top',
        label: 'Max Results',
        type: 'number',
        defaultValue: 25,
        description: 'Maximum number of messages to return (1–100)',
        aiProvided: true,
      },
      {
        name: 'search',
        label: 'Search',
        type: 'text',
        placeholder: 'quarterly report',
        description: 'Free-text search across subject, body, and addresses (uses Microsoft Search)',
        aiProvided: true,
      },
      {
        name: 'filter',
        label: 'OData Filter',
        type: 'text',
        placeholder: 'isRead eq false',
        description:
          'OData $filter expression. Examples: "isRead eq false", "hasAttachments eq true", "from/emailAddress/address eq \'user@example.com\'"',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'folder',
        label: 'Mail Folder',
        type: 'select',
        defaultValue: '',
        options: [
          { label: 'All Mail (default)', value: '' },
          { label: 'Inbox', value: 'inbox' },
          { label: 'Sent Items', value: 'sentitems' },
          { label: 'Drafts', value: 'drafts' },
          { label: 'Deleted Items', value: 'deleteditems' },
          { label: 'Archive', value: 'archive' },
          { label: 'Junk Email', value: 'junkemail' },
        ],
        description: 'Which mail folder to list messages from',
        aiProvided: true,
      },
      {
        name: 'orderBy',
        label: 'Order By',
        type: 'text',
        defaultValue: 'receivedDateTime desc',
        description: 'OData $orderby expression',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'includeCount',
        label: 'Include Total Count',
        type: 'boolean',
        defaultValue: false,
        description: 'Include total matching message count (may be slower)',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['microsoft', 'outlook', 'email', 'mail', 'list', 'search', 'graph', 'oauth2'],

  async execute(params, context) {
    const { credentialId, top, search, filter, folder, orderBy, includeCount } = params;

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

    context.logger.debug('Listing Microsoft 365 messages', { top, folder, hasSearch: !!search });

    try {
      // Build the endpoint — folder-specific or general
      const basePath = folder?.trim()
        ? `${GRAPH_API_BASE}/me/mailFolders/${encodeURIComponent(folder)}/messages`
        : `${GRAPH_API_BASE}/me/messages`;

      const url = new URL(basePath);
      url.searchParams.set('$top', String(top));
      url.searchParams.set(
        '$select',
        'id,subject,bodyPreview,from,toRecipients,ccRecipients,receivedDateTime,sentDateTime,isRead,isDraft,hasAttachments,importance,categories,webLink,conversationId,flag',
      );

      if (!search?.trim() && orderBy?.trim()) {
        url.searchParams.set('$orderby', orderBy);
      }
      if (filter?.trim()) {
        url.searchParams.set('$filter', filter);
      }
      if (search?.trim()) {
        url.searchParams.set('$search', `"${search}"`);
      }

      const headers: Record<string, string> = {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      };

      if (search?.trim() || includeCount) {
        headers['ConsistencyLevel'] = 'eventual';
      }
      if (includeCount) {
        url.searchParams.set('$count', 'true');
      }

      const response = await fetch(url.toString(), { headers });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Microsoft Graph API error: ${response.status} - ${errorText}`,
        };
      }

      const data = (await response.json()) as GraphMessagesResponse;

      const messages = data.value.map((msg) => ({
        id: msg.id,
        subject: msg.subject,
        bodyPreview: msg.bodyPreview,
        from: msg.from?.emailAddress ?? null,
        to: msg.toRecipients?.map((r) => r.emailAddress) ?? [],
        cc: msg.ccRecipients?.map((r) => r.emailAddress) ?? [],
        receivedDateTime: msg.receivedDateTime,
        sentDateTime: msg.sentDateTime,
        isRead: msg.isRead,
        isDraft: msg.isDraft,
        hasAttachments: msg.hasAttachments,
        importance: msg.importance,
        categories: msg.categories,
        webLink: msg.webLink,
        conversationId: msg.conversationId,
        flagStatus: msg.flag?.flagStatus ?? null,
      }));

      return {
        success: true,
        output: {
          messages,
          messageCount: messages.length,
          totalCount: data['@odata.count'] ?? null,
          hasMore: !!data['@odata.nextLink'],
          search: search || null,
          folder: folder || 'all',
        },
        metadata: {
          messageCount: messages.length,
          totalCount: data['@odata.count'],
          hasMore: !!data['@odata.nextLink'],
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Microsoft Graph operation failed: ${msg}` };
    }
  },
});
