/**
 * gmail.modify_labels — Add or remove labels on a Gmail message
 *
 * Modifies the label set on a single message. Common uses:
 *   - Mark as read/unread (add/remove UNREAD label)
 *   - Star/unstar (add/remove STARRED label)
 *   - Archive (remove INBOX label)
 *   - Move to trash (add TRASH label)
 *   - Apply custom labels
 *
 * Requires a Google Gmail OAuth2 credential.
 */

import { defineAction } from '@flowlib/action-kit';
import { GMAIL_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Gmail credential is required'),
  messageId: z.string().min(1, 'Message ID is required'),
  addLabelIds: z.array(z.string()).optional().default([]),
  removeLabelIds: z.array(z.string()).optional().default([]),
});

export const gmailModifyLabelsAction = defineAction({
  id: 'gmail.modify_labels',
  name: 'Modify Labels',
  description:
    'Add or remove labels on a Gmail message (users.messages.modify). Use when the user wants to mark emails read/unread, star/unstar, archive, trash, or organize with labels.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"messageId": "18e1a2b", "threadId": "18e1a2b", "currentLabels": ["INBOX", "STARRED"]}\n' +
    '```',
  provider: GMAIL_PROVIDER,
  actionCategory: 'manage',
  tags: [
    'gmail',
    'google',
    'email',
    'mail',
    'labels',
    'tag',
    'organize',
    'archive',
    'read',
    'unread',
    'star',
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
    description: 'Gmail OAuth2 credential with modify permissions',
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
        description: 'The Gmail message ID to modify',
        aiProvided: true,
      },
      {
        name: 'addLabelIds',
        label: 'Add Labels',
        type: 'json',
        defaultValue: [],
        description:
          'Label IDs to add (JSON array). Common: "STARRED", "IMPORTANT", "UNREAD", "TRASH"',
        aiProvided: true,
      },
      {
        name: 'removeLabelIds',
        label: 'Remove Labels',
        type: 'json',
        defaultValue: [],
        description:
          'Label IDs to remove (JSON array). Common: "UNREAD" (mark read), "INBOX" (archive), "STARRED"',
        aiProvided: true,
      },
    ],
  },

  async execute(params, context) {
    const { credentialId, messageId, addLabelIds, removeLabelIds } = params;

    if (addLabelIds.length === 0 && removeLabelIds.length === 0) {
      return {
        success: false,
        error: 'At least one label must be added or removed.',
      };
    }

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

    context.logger.debug('Modifying Gmail message labels', {
      messageId,
      addLabelIds,
      removeLabelIds,
    });

    try {
      const url = `${GMAIL_API_BASE}/messages/${encodeURIComponent(messageId)}/modify`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          addLabelIds,
          removeLabelIds,
        }),
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
          currentLabels: result.labelIds,
          added: addLabelIds,
          removed: removeLabelIds,
        },
        metadata: {
          messageId: result.id,
          labelsAdded: addLabelIds,
          labelsRemoved: removeLabelIds,
          resultingLabels: result.labelIds,
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Gmail API error: ${msg}` };
    }
  },
});
