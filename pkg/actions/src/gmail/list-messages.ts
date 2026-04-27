/**
 * gmail.list_messages — List / search Gmail messages
 *
 * Searches and retrieves email metadata from Gmail via the Gmail API.
 * Requires a Google Gmail OAuth2 credential.
 */

import { defineAction } from '@flowlib/action-kit';
import { GMAIL_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

interface GmailListResponse {
  messages?: Array<{ id: string; threadId: string }>;
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

interface GmailMessageResponse {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  payload?: {
    headers?: Array<{ name: string; value: string }>;
  };
}

interface ParsedEmail {
  id: string;
  threadId: string;
  from?: string;
  to?: string;
  subject?: string;
  date?: string;
  snippet?: string;
  labels?: string[];
  isUnread?: boolean;
  isStarred?: boolean;
}

function getHeader(
  headers: Array<{ name: string; value: string }> | undefined,
  name: string,
): string | undefined {
  return headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;
}

function parseMessage(msg: GmailMessageResponse): ParsedEmail {
  const headers = msg.payload?.headers;
  return {
    id: msg.id,
    threadId: msg.threadId,
    from: getHeader(headers, 'From'),
    to: getHeader(headers, 'To'),
    subject: getHeader(headers, 'Subject'),
    date: getHeader(headers, 'Date'),
    snippet: msg.snippet,
    labels: msg.labelIds,
    isUnread: msg.labelIds?.includes('UNREAD'),
    isStarred: msg.labelIds?.includes('STARRED'),
  };
}

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Gmail credential is required'),
  maxResults: z.number().int().min(1).max(100).optional().default(10),
  query: z.string().optional().default(''),
  labelIds: z.array(z.string()).optional().default([]),
  includeSpamTrash: z.boolean().optional().default(false),
});

export const gmailListMessagesAction = defineAction({
  id: 'gmail.list_messages',
  name: 'List Emails',
  description:
    'Search and list emails from Gmail inbox (users.messages.list + users.messages.get). Use when the user wants to check their email, find messages, or search their inbox.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"messages": [{"id": "18e1a2b", "threadId": "18e1a2b", "from": "alice@example.com", "subject": "Hello", "snippet": "..."}], "totalEstimate": 42}\n' +
    '```',
  provider: GMAIL_PROVIDER,
  actionCategory: 'read',
  tags: [
    'gmail',
    'google',
    'email',
    'mail',
    'inbox',
    'list',
    'search',
    'messages',
    'read',
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
        name: 'maxResults',
        label: 'Max Results',
        type: 'number',
        defaultValue: 10,
        description: 'Maximum number of emails to return (1–100)',
        aiProvided: true,
      },
      {
        name: 'query',
        label: 'Search Query',
        type: 'text',
        placeholder: 'is:unread from:someone@example.com',
        description:
          "Gmail search query. Examples: 'from:user@example.com', 'subject:meeting', 'is:unread', 'has:attachment'",
        aiProvided: true,
      },
      {
        name: 'labelIds',
        label: 'Label Filter',
        type: 'json',
        defaultValue: [],
        description: 'Filter by label IDs (JSON array). Common: ["INBOX"], ["UNREAD"], ["STARRED"]',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'includeSpamTrash',
        label: 'Include Spam/Trash',
        type: 'boolean',
        defaultValue: false,
        description: 'Include messages from SPAM and TRASH folders',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  async execute(params, context) {
    const { credentialId, maxResults, query, labelIds, includeSpamTrash } = params;

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

    context.logger.debug('Executing Gmail list messages', {
      maxResults,
      hasQuery: !!query,
      labelIds,
    });

    try {
      // Build list URL
      const url = new URL(`${GMAIL_API_BASE}/messages`);
      url.searchParams.set('maxResults', String(Math.min(Math.max(1, maxResults), 100)));

      if (query?.trim()) {
        url.searchParams.set('q', query);
      }

      if (labelIds && labelIds.length > 0) {
        for (const labelId of labelIds) {
          url.searchParams.append('labelIds', labelId);
        }
      }

      if (includeSpamTrash) {
        url.searchParams.set('includeSpamTrash', 'true');
      }

      const listResponse = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      });

      if (!listResponse.ok) {
        const errorText = await listResponse.text();
        return {
          success: false,
          error: `Gmail API error (${listResponse.status}): ${listResponse.statusText} - ${errorText}`,
        };
      }

      const listData = (await listResponse.json()) as GmailListResponse;

      if (!listData.messages || listData.messages.length === 0) {
        return {
          success: true,
          output: {
            messages: [],
            totalEstimate: listData.resultSizeEstimate || 0,
            query: query || null,
            hasMore: false,
          },
        };
      }

      // Fetch metadata for each message
      const messageDetails = await Promise.all(
        listData.messages.map(async (msg) => {
          const msgUrl = new URL(`${GMAIL_API_BASE}/messages/${msg.id}`);
          msgUrl.searchParams.set('format', 'metadata');
          msgUrl.searchParams.set('metadataHeaders', 'From');
          msgUrl.searchParams.append('metadataHeaders', 'To');
          msgUrl.searchParams.append('metadataHeaders', 'Subject');
          msgUrl.searchParams.append('metadataHeaders', 'Date');

          const resp = await fetch(msgUrl.toString(), {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: 'application/json',
            },
          });

          return resp.ok ? ((await resp.json()) as GmailMessageResponse) : null;
        }),
      );

      const parsedMessages = messageDetails
        .filter((msg): msg is GmailMessageResponse => msg !== null)
        .map(parseMessage);

      return {
        success: true,
        output: {
          messages: parsedMessages,
          totalEstimate: listData.resultSizeEstimate || parsedMessages.length,
          query: query || null,
          hasMore: !!listData.nextPageToken,
        },
        metadata: {
          messageCount: parsedMessages.length,
          totalEstimate: listData.resultSizeEstimate,
          hasMore: !!listData.nextPageToken,
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Gmail operation failed: ${msg}` };
    }
  },
});
