/**
 * microsoft_teams.list_channels — List channels in a Team
 *
 * Lists channels within a specific Microsoft Team using the Microsoft Graph API.
 * Requires a Microsoft Teams OAuth2 credential with Channel.ReadBasic.All scope.
 */

import { defineAction } from '@flowlib/action-kit';
import { MICROSOFT_TEAMS_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const API_BASE = 'https://graph.microsoft.com/v1.0';

interface GraphChannel {
  id: string;
  displayName: string;
  description: string | null;
  membershipType: string;
}

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Teams credential is required'),
  teamId: z.string().min(1, 'Team ID is required'),
});

export const teamsListChannelsAction = defineAction({
  id: 'microsoft_teams.list_channels',
  name: 'List Channels',
  description:
    'List channels in a Microsoft Team (GET /teams/{team-id}/channels). Call with `teamId` to retrieve all channels including standard, private, and shared. Use when you need to find a channel ID before sending messages or reading channel history.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"channels": [{"id": "19:561fbdbbfca8...@thread.tacv2", "displayName": "General", "description": "Main channel", "membershipType": "standard"}], "count": 1}\n' +
    '```',
  provider: MICROSOFT_TEAMS_PROVIDER,
  actionCategory: 'read',

  credential: {
    required: true,
    type: 'oauth2',
    oauth2Provider: 'microsoft',
    requiredScopes: ['Channel.ReadBasic.All'],
    description: 'Microsoft Teams OAuth2 credential with Channel.ReadBasic.All scope',
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
        description: 'The ID of the team to list channels for',
        aiProvided: true,
      },
    ],
  },

  tags: ['microsoft', 'teams', 'channels', 'list', 'oauth2'],

  async execute(params, context) {
    const { credentialId, teamId } = params;

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

    context.logger.debug('Listing Teams channels', { teamId });

    try {
      const response = await fetch(`${API_BASE}/teams/${encodeURIComponent(teamId)}/channels`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        const errText = await response.text();
        return { success: false, error: `Teams API error (${response.status}): ${errText}` };
      }

      const data = (await response.json()) as { value: GraphChannel[] };

      const channels = data.value.map((ch) => ({
        id: ch.id,
        displayName: ch.displayName,
        description: ch.description,
        membershipType: ch.membershipType,
      }));

      return {
        success: true,
        output: { channels, count: channels.length },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Teams request failed: ${msg}` };
    }
  },
});
