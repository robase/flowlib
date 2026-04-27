/**
 * intercom.list_conversations — List conversations in Intercom
 *
 * Lists recent conversations with pagination support.
 * Requires an Intercom OAuth2 credential.
 */

import { defineAction } from '@flowlib/action-kit';
import { INTERCOM_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const INTERCOM_API = 'https://api.intercom.io';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Intercom credential is required'),
  perPage: z.number().int().min(1).max(150).optional().default(20),
});

export const intercomListConversationsAction = defineAction({
  id: 'intercom.list_conversations',
  name: 'List Conversations',
  description:
    'List recent conversations in Intercom (GET /conversations). Use when the user wants to browse all recent conversations. Returns conversations ordered by most recent, with pagination via `perPage` (1–150, default 20). Does not support filtering by state.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"conversations": [{"id": "123", "title": "Help needed", "state": "open", "open": true, "read": true}], "count": 20, "totalCount": 25, "hasMore": true}\n' +
    '```',
  provider: INTERCOM_PROVIDER,
  actionCategory: 'read',

  credential: {
    required: true,
    type: 'oauth2',
    oauth2Provider: 'intercom',
    description: 'Intercom OAuth2 credential',
  },

  params: {
    schema: paramsSchema,
    fields: [
      {
        name: 'credentialId',
        label: 'Intercom Credential',
        type: 'text',
        required: true,
        description: 'Intercom OAuth2 credential for authentication',
        aiProvided: false,
      },
      {
        name: 'perPage',
        label: 'Per Page',
        type: 'number',
        defaultValue: 20,
        description: 'Number of conversations per page (1–150)',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['intercom', 'conversations', 'list', 'messaging', 'oauth2'],

  async execute(params, context) {
    const { credentialId, perPage } = params;

    let credential = context.credential;
    if (!credential && context.functions?.getCredential) {
      credential = await context.functions.getCredential(credentialId);
    }
    if (!credential) {
      return {
        success: false,
        error: `Credential not found: ${credentialId}. Please create an Intercom OAuth2 credential.`,
      };
    }

    const accessToken =
      (credential.config?.accessToken as string) ?? (credential.config?.token as string);
    if (!accessToken) {
      return {
        success: false,
        error: 'No valid access token in credential. Please re-authorize the Intercom credential.',
      };
    }

    context.logger.debug('Listing Intercom conversations', { perPage });

    try {
      const url = new URL(`${INTERCOM_API}/conversations`);
      url.searchParams.set('per_page', String(Math.min(Math.max(1, perPage), 150)));

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
          'Intercom-Version': '2.12',
        },
      });

      if (!response.ok) {
        const errorBody = await response.text();
        return {
          success: false,
          error: `Intercom API error (${response.status}): ${errorBody}`,
        };
      }

      const data = (await response.json()) as {
        type: string;
        conversations: Array<{
          id: string;
          type: string;
          title: string | null;
          state: string;
          open: boolean;
          read: boolean;
          created_at: number;
          updated_at: number;
          waiting_since: number | null;
          source: { type: string; delivered_as?: string } | null;
          contacts: { contacts: Array<{ id: string; type: string }> } | null;
          teammates: { admins: Array<{ id: string; name: string }> } | null;
        }>;
        total_count: number;
        pages?: { next?: string; total_pages?: number };
      };

      const conversations = (data.conversations ?? []).map((c) => ({
        id: c.id,
        title: c.title,
        state: c.state,
        open: c.open,
        read: c.read,
        createdAt: c.created_at,
        updatedAt: c.updated_at,
        waitingSince: c.waiting_since,
        sourceType: c.source?.type ?? null,
        contactIds: c.contacts?.contacts?.map((ct) => ct.id) ?? [],
        assignees: c.teammates?.admins?.map((a) => ({ id: a.id, name: a.name })) ?? [],
      }));

      return {
        success: true,
        output: {
          conversations,
          count: conversations.length,
          totalCount: data.total_count,
          hasMore: !!data.pages?.next,
        },
        metadata: {
          conversationCount: conversations.length,
          totalCount: data.total_count,
          hasMore: !!data.pages?.next,
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Intercom list conversations failed: ${msg}` };
    }
  },
});
