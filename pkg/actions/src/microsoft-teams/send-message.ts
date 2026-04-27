/**
 * microsoft_teams.send_message — Send a message to a Teams channel
 *
 * Posts a message to a Microsoft Teams channel using the Microsoft Graph API.
 * Supports HTML-formatted content.
 * Requires a Microsoft Teams OAuth2 credential with ChannelMessage.Send scope.
 */

import { defineAction } from '@flowlib/action-kit';
import { MICROSOFT_TEAMS_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const API_BASE = 'https://graph.microsoft.com/v1.0';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Teams credential is required'),
  teamId: z.string().min(1, 'Team ID is required'),
  channelId: z.string().min(1, 'Channel ID is required'),
  content: z.string().min(1, 'Message content is required'),
  contentType: z.string().optional().default('html'),
});

export const teamsSendMessageAction = defineAction({
  id: 'microsoft_teams.send_message',
  name: 'Send Message',
  description:
    'Send a message to a Microsoft Teams channel (POST /teams/{team-id}/channels/{channel-id}/messages). Call with `teamId`, `channelId`, and `content` (HTML by default, or set `contentType` to "text" for plain text). Use when you need to post a notification, update, or message to a Teams channel.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"id": "1616990032035", "createdDateTime": "2025-01-15T10:30:00Z", "from": {"user": {"displayName": "Bot"}}, "body": {"contentType": "html", "content": "Hello World"}}\n' +
    '```',
  provider: MICROSOFT_TEAMS_PROVIDER,
  actionCategory: 'write',

  credential: {
    required: true,
    type: 'oauth2',
    oauth2Provider: 'microsoft',
    requiredScopes: ['ChannelMessage.Send'],
    description: 'Microsoft Teams OAuth2 credential with ChannelMessage.Send scope',
  },

  params: {
    schema: paramsSchema,
    fields: [
      {
        name: 'credentialId',
        label: 'Teams Credential',
        type: 'text',
        required: true,
        description: 'Microsoft Teams OAuth2 credential for authentication',
        aiProvided: false,
      },
      {
        name: 'teamId',
        label: 'Team ID',
        type: 'text',
        required: true,
        placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
        description: 'The ID of the team containing the target channel',
        aiProvided: true,
      },
      {
        name: 'channelId',
        label: 'Channel ID',
        type: 'text',
        required: true,
        placeholder: '19:xxxxxxxxxx@thread.tacv2',
        description: 'The ID of the channel to send the message to',
        aiProvided: true,
      },
      {
        name: 'content',
        label: 'Message Content',
        type: 'textarea',
        required: true,
        placeholder: '<p>Hello from Invect!</p>',
        description: 'The message body. Supports HTML formatting by default.',
        aiProvided: true,
      },
      {
        name: 'contentType',
        label: 'Content Type',
        type: 'select',
        defaultValue: 'html',
        options: [
          { label: 'HTML', value: 'html' },
          { label: 'Plain Text', value: 'text' },
        ],
        description: 'Format of the message content',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['microsoft', 'teams', 'messaging', 'chat', 'communication', 'oauth2'],

  async execute(params, context) {
    const { credentialId, teamId, channelId, content, contentType } = params;

    let credential = context.credential;
    if (!credential && context.functions?.getCredential) {
      credential = await context.functions.getCredential(credentialId);
    }
    if (!credential) {
      return {
        success: false,
        error: `Credential not found: ${credentialId}. Please create a Microsoft Teams OAuth2 credential.`,
      };
    }

    const accessToken =
      (credential.config?.accessToken as string) ?? (credential.config?.token as string);
    if (!accessToken) {
      return {
        success: false,
        error: 'No valid access token in credential. Please re-authorize.',
      };
    }

    context.logger.debug('Sending Teams message', { teamId, channelId });

    try {
      const response = await fetch(
        `${API_BASE}/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            body: {
              contentType,
              content,
            },
          }),
        },
      );

      if (!response.ok) {
        const errText = await response.text();
        return { success: false, error: `Teams API error (${response.status}): ${errText}` };
      }

      const data = (await response.json()) as {
        id: string;
        createdDateTime: string;
        from?: { user?: { displayName: string } };
        body: { contentType: string; content: string };
      };

      return {
        success: true,
        output: {
          id: data.id,
          createdDateTime: data.createdDateTime,
          from: data.from,
          body: data.body,
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Teams request failed: ${msg}` };
    }
  },
});
