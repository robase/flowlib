/**
 * intercom.reply_to_conversation — Reply to an Intercom conversation
 *
 * Posts an admin reply (comment) to an existing conversation.
 * Requires an Intercom OAuth2 credential.
 */

import { defineAction } from '@flowlib/action-kit';
import { INTERCOM_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const INTERCOM_API = 'https://api.intercom.io';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Intercom credential is required'),
  conversationId: z.string().min(1, 'Conversation ID is required'),
  adminId: z.string().min(1, 'Admin ID is required'),
  message: z.string().min(1, 'Message body is required'),
});

export const intercomReplyToConversationAction = defineAction({
  id: 'intercom.reply_to_conversation',
  name: 'Reply to Conversation',
  description:
    'Reply to an Intercom conversation as an admin (POST /conversations/{id}/reply). Use when the user wants to send a response on an existing conversation thread.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"type": "conversation_part", "id": "456", "conversation_id": "123", "body": "Thanks!", "created_at": 1700000000}\n' +
    '```',
  provider: INTERCOM_PROVIDER,
  actionCategory: 'write',

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
        name: 'conversationId',
        label: 'Conversation ID',
        type: 'text',
        required: true,
        placeholder: '123456789',
        description: 'The ID of the conversation to reply to',
        aiProvided: true,
      },
      {
        name: 'adminId',
        label: 'Admin ID',
        type: 'text',
        required: true,
        placeholder: '987654',
        description: 'The ID of the admin sending the reply',
        aiProvided: true,
      },
      {
        name: 'message',
        label: 'Message',
        type: 'textarea',
        required: true,
        placeholder: 'Thanks for reaching out! Let me help you with that.',
        description: 'The reply message body (supports HTML)',
        aiProvided: true,
      },
    ],
  },

  tags: ['intercom', 'conversations', 'reply', 'messaging', 'oauth2'],

  async execute(params, context) {
    const { credentialId, conversationId, adminId, message } = params;

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

    context.logger.debug('Replying to Intercom conversation', { conversationId, adminId });

    try {
      const response = await fetch(
        `${INTERCOM_API}/conversations/${encodeURIComponent(conversationId)}/reply`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'Intercom-Version': '2.12',
          },
          body: JSON.stringify({
            message_type: 'comment',
            type: 'admin',
            admin_id: adminId,
            body: message,
          }),
        },
      );

      if (!response.ok) {
        const errorBody = await response.text();
        return {
          success: false,
          error: `Intercom API error (${response.status}): ${errorBody}`,
        };
      }

      const data = (await response.json()) as {
        type: string;
        id: string;
        conversation_id: string;
        body: string;
        author: { type: string; id: string; name?: string };
        created_at: number;
      };

      return {
        success: true,
        output: {
          id: data.id,
          conversationId: data.conversation_id,
          body: data.body,
          author: data.author,
          createdAt: data.created_at,
        },
        metadata: {
          conversationId: data.conversation_id,
          replyId: data.id,
          sentAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Intercom reply failed: ${msg}` };
    }
  },
});
