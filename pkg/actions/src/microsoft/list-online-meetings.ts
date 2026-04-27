/**
 * microsoft.list_online_meetings — List recent online meetings
 *
 * Retrieves online meetings for the authenticated user via Microsoft Graph API.
 * Useful for finding meeting IDs to retrieve transcripts.
 * Requires a Microsoft 365 OAuth2 credential with OnlineMeetings.Read scope.
 */

import { defineAction } from '@flowlib/action-kit';
import { MICROSOFT_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0';

interface GraphOnlineMeeting {
  id: string;
  creationDateTime: string;
  startDateTime: string;
  endDateTime: string;
  subject: string;
  joinWebUrl: string;
  participants?: {
    organizer?: { identity?: { user?: { displayName: string; id: string } } };
    attendees?: Array<{
      identity?: { user?: { displayName: string; id: string } };
      role?: string;
    }>;
  };
  isBroadcast: boolean;
  recordingEnabled?: boolean;
  chatInfo?: { threadId: string };
}

interface GraphOnlineMeetingsResponse {
  value: GraphOnlineMeeting[];
  '@odata.nextLink'?: string;
}

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Microsoft 365 credential is required'),
  top: z.number().int().min(1).max(100).optional().default(25),
  filter: z.string().optional().default(''),
});

export const microsoftListOnlineMeetingsAction = defineAction({
  id: 'microsoft.list_online_meetings',
  name: 'List Online Meetings',
  description:
    'List recent Microsoft Teams online meetings (GET /me/onlineMeetings). Use when you need to find meeting IDs for retrieving transcripts or meeting details.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"id": "MSo1N2Y5...", "subject": "Weekly Standup", "startDateTime": "2025-01-15T09:00:00Z", "endDateTime": "2025-01-15T09:30:00Z", "joinWebUrl": "https://teams.microsoft.com/l/meetup-join/..."}\n' +
    '```',
  provider: MICROSOFT_PROVIDER,
  actionCategory: 'read',

  credential: {
    required: true,
    type: 'oauth2',
    oauth2Provider: 'microsoft',
    requiredScopes: ['OnlineMeetings.Read'],
    description: 'Microsoft 365 OAuth2 credential with OnlineMeetings.Read scope',
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
        description: 'Maximum number of meetings to return (1–100)',
        aiProvided: true,
      },
      {
        name: 'filter',
        label: 'OData Filter',
        type: 'text',
        placeholder: "subject eq 'Weekly Standup'",
        description: 'OData $filter expression for advanced filtering',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['microsoft', 'teams', 'meetings', 'online', 'graph', 'oauth2'],

  async execute(params, context) {
    const { credentialId, top, filter } = params;

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

    context.logger.debug('Listing Microsoft Teams online meetings', { top });

    try {
      const url = new URL(`${GRAPH_API_BASE}/me/onlineMeetings`);
      url.searchParams.set('$top', String(top));
      url.searchParams.set('$orderby', 'startDateTime desc');

      if (filter?.trim()) {
        url.searchParams.set('$filter', filter);
      }

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Microsoft Graph API error: ${response.status} - ${errorText}`,
        };
      }

      const data = (await response.json()) as GraphOnlineMeetingsResponse;

      const meetings = data.value.map((m) => ({
        id: m.id,
        subject: m.subject,
        startDateTime: m.startDateTime,
        endDateTime: m.endDateTime,
        joinUrl: m.joinWebUrl,
        organizer: m.participants?.organizer?.identity?.user?.displayName ?? null,
        attendeeCount: m.participants?.attendees?.length ?? 0,
        isBroadcast: m.isBroadcast,
        chatThreadId: m.chatInfo?.threadId ?? null,
        createdDateTime: m.creationDateTime,
      }));

      return {
        success: true,
        output: {
          meetings,
          meetingCount: meetings.length,
          hasMore: !!data['@odata.nextLink'],
        },
        metadata: { meetingCount: meetings.length },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Microsoft Graph operation failed: ${msg}` };
    }
  },
});
