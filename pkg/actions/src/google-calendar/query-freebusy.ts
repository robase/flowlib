/**
 * google_calendar.query_freebusy — Check free/busy information
 *
 * Query free/busy information for one or more calendars.
 * Useful for finding available meeting times.
 * Requires a Google Calendar OAuth2 credential.
 */

import { defineAction } from '@flowlib/action-kit';
import { GOOGLE_CALENDAR_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Google Calendar credential is required'),
  timeMin: z.string().min(1, 'Start time is required'),
  timeMax: z.string().min(1, 'End time is required'),
  calendarIds: z.array(z.string()).optional().default(['primary']),
  timeZone: z.string().optional().default('UTC'),
});

export const googleCalendarQueryFreebusyAction = defineAction({
  id: 'google_calendar.query_freebusy',
  name: 'Query Free/Busy',
  description:
    'Check free/busy information for calendars (freebusy.query). Use when the user wants to find available meeting times or check if someone is free.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"calendars": [{"calendarId": "primary", "busySlots": [{"start": "2025-03-15T10:00:00Z", "end": "2025-03-15T11:00:00Z"}], "busyCount": 1}]}\n' +
    '```',
  provider: GOOGLE_CALENDAR_PROVIDER,
  actionCategory: 'read',

  credential: {
    required: true,
    type: 'oauth2',
    oauth2Provider: 'google',
    requiredScopes: ['https://www.googleapis.com/auth/calendar.readonly'],
    description: 'Google Calendar OAuth2 credential (read-only access)',
  },

  params: {
    schema: paramsSchema,
    fields: [
      {
        name: 'credentialId',
        label: 'Google Calendar Credential',
        type: 'text',
        required: true,
        description: 'Google Calendar OAuth2 credential for authentication',
        aiProvided: false,
      },
      {
        name: 'timeMin',
        label: 'Start',
        type: 'text',
        required: true,
        placeholder: '2025-03-15T09:00:00Z',
        description: 'Start of the period to check (ISO 8601)',
        aiProvided: true,
      },
      {
        name: 'timeMax',
        label: 'End',
        type: 'text',
        required: true,
        placeholder: '2025-03-15T17:00:00Z',
        description: 'End of the period to check (ISO 8601)',
        aiProvided: true,
      },
      {
        name: 'calendarIds',
        label: 'Calendar IDs',
        type: 'json',
        defaultValue: ['primary'],
        placeholder: '["primary", "team@example.com"]',
        description: 'JSON array of calendar IDs to check',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'timeZone',
        label: 'Time Zone',
        type: 'text',
        defaultValue: 'UTC',
        description: 'IANA time zone for the query',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['google', 'calendar', 'freebusy', 'availability', 'schedule', 'oauth2'],

  async execute(params, context) {
    const { credentialId, timeMin, timeMax, calendarIds, timeZone } = params;

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

    context.logger.debug('Querying free/busy', { timeMin, timeMax, calendarIds });

    try {
      const response = await fetch(`${CALENDAR_API_BASE}/freeBusy`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          timeMin,
          timeMax,
          timeZone,
          items: calendarIds.map((id: string) => ({ id })),
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Google Calendar API error: ${response.status} - ${errorText}`,
        };
      }

      const data = (await response.json()) as {
        calendars?: Record<
          string,
          { busy?: Array<{ start: string; end: string }>; errors?: unknown[] }
        >;
        timeMin?: string;
        timeMax?: string;
      };

      // Simplify the output
      const calendars = Object.entries(data.calendars ?? {}).map(([calId, info]) => ({
        calendarId: calId,
        busySlots: info.busy ?? [],
        busyCount: info.busy?.length ?? 0,
        errors: info.errors,
      }));

      return {
        success: true,
        output: {
          timeMin: data.timeMin,
          timeMax: data.timeMax,
          calendars,
        },
        metadata: {
          calendarCount: calendars.length,
          totalBusySlots: calendars.reduce((sum, c) => sum + c.busyCount, 0),
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Google Calendar operation failed: ${msg}` };
    }
  },
});
