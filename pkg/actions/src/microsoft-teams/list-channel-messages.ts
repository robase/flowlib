/**
 * microsoft_teams.list_channel_messages — List recent channel messages
 *
 * Retrieves recent messages from a Microsoft Teams channel using the
 * Microsoft Graph API.
 * Requires a Microsoft Teams OAuth2 credential with ChannelMessage.Read.All scope.
 */

import { defineAction } from '@flowlib/action-kit';
import { MICROSOFT_TEAMS_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const API_BASE = 'https://graph.microsoft.com/v1.0';

interface GraphChannelMessage {
  id: string;
  createdDateTime: string;
  body: { contentType: string; content: string };
  from?: { user?: { displayName: string; id: string } };
}

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Teams credential is required'),
  teamId: z.string().min(1, 'Team ID is required'),
  channelId: z.string().min(1, 'Channel ID is required'),
  top: z.number().int().min(1).max(50).optional().default(25),
});

export const teamsListChannelMessagesAction = defineAction({
  id: 'microsoft_teams.list_channel_messages',
  name: 'List Channel Messages',
  description:
    'List recent messages from a Microsoft Teams channel (GET /teams/{team-id}/channels/{channel-id}/messages). Call with `teamId`, `channelId`, and optional `top` (1–50, default 25) to control page size. Use when you need to read channel history or find specific messages.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"messages": [{"id": "1616965872395", "createdDateTime": "2025-01-15T10:30:00Z", "from": {"user": {"displayName": "Alice"}}, "body": {"contentType": "html", "content": "Hello"}}], "count": 1}\n' +
    '```',
  provider: MICROSOFT_TEAMS_PROVIDER,
  actionCategory: 'read',

  credential: {
    required: true,
    type: 'oauth2',
    oauth2Provider: 'microsoft',
    requiredScopes: ['ChannelMessage.Read.All'],
    description: 'Microsoft Teams OAuth2 credential with ChannelMessage.Read.All scope',
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
        description: 'The ID of the team containing the channel',
        aiProvided: true,
      },
      {
        name: 'channelId',
        label: 'Channel ID',
        type: 'text',
        required: true,
        placeholder: '19:xxxxxxxxxx@thread.tacv2',
        description: 'The ID of the channel to list messages from',
        aiProvided: true,
      },
      {
        name: 'top',
        label: 'Max Results',
        type: 'number',
        defaultValue: 25,
        description: 'Maximum number of messages to return (1–50)',
        aiProvided: true,
        extended: true,
      },
    ],
  },

  tags: ['microsoft', 'teams', 'messages', 'channels', 'list', 'oauth2'],

  async execute(params, context) {
    const { credentialId, teamId, channelId, top } = params;

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

    context.logger.debug('Listing Teams channel messages', { teamId, channelId, top });

    try {
      const url = new URL(
        `${API_BASE}/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/messages`,
      );
      url.searchParams.set('$top', String(Math.min(Math.max(1, top), 50)));

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        const errText = await response.text();
        return { success: false, error: `Teams API error (${response.status}): ${errText}` };
      }

      const data = (await response.json()) as { value: GraphChannelMessage[] };

      const messages = data.value.map((m) => ({
        id: m.id,
        body: m.body,
        from: m.from,
        createdDateTime: m.createdDateTime,
      }));

      return {
        success: true,
        output: { messages, count: messages.length },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Teams request failed: ${msg}` };
    }
  },
});
