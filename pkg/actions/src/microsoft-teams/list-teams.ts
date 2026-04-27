/**
 * microsoft_teams.list_teams — List joined Teams
 *
 * Lists the Microsoft Teams that the authenticated user is a member of
 * via the Microsoft Graph API.
 * Requires a Microsoft Teams OAuth2 credential with Team.ReadBasic.All scope.
 */

import { defineAction } from '@flowlib/action-kit';
import { MICROSOFT_TEAMS_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const API_BASE = 'https://graph.microsoft.com/v1.0';

interface GraphTeam {
  id: string;
  displayName: string;
  description: string | null;
}

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Teams credential is required'),
});

export const teamsListTeamsAction = defineAction({
  id: 'microsoft_teams.list_teams',
  name: 'List Teams',
  description:
    'List Microsoft Teams the authenticated user is a member of (GET /me/joinedTeams). Use when you need to discover available teams before listing channels or sending messages. Returns an array of teams with their IDs and display names.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"teams": [{"id": "172b0cce-e65d-44ce-9a49-91d9f2e8493a", "displayName": "Contoso Team", "description": "Engineering team"}], "count": 1}\n' +
    '```',
  provider: MICROSOFT_TEAMS_PROVIDER,
  actionCategory: 'read',

  credential: {
    required: true,
    type: 'oauth2',
    oauth2Provider: 'microsoft',
    requiredScopes: ['Team.ReadBasic.All'],
    description: 'Microsoft Teams OAuth2 credential with Team.ReadBasic.All scope',
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
    ],
  },

  tags: ['microsoft', 'teams', 'list', 'organization', 'oauth2'],

  async execute(params, context) {
    const { credentialId } = params;

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

    context.logger.debug('Listing joined Teams');

    try {
      const response = await fetch(`${API_BASE}/me/joinedTeams`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        const errText = await response.text();
        return { success: false, error: `Teams API error (${response.status}): ${errText}` };
      }

      const data = (await response.json()) as { value: GraphTeam[] };

      const teams = data.value.map((t) => ({
        id: t.id,
        displayName: t.displayName,
        description: t.description,
      }));

      return {
        success: true,
        output: { teams, count: teams.length },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Teams request failed: ${msg}` };
    }
  },
});
