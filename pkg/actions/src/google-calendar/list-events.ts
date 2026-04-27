/**
 * google_calendar.list_events — List events from Google Calendar
 *
 * Retrieves upcoming or past events from a Google Calendar.
 * Requires a Google Calendar OAuth2 credential.
 */

import { defineAction } from '@flowlib/action-kit';
import { GOOGLE_CALENDAR_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Google Calendar credential is required'),
  calendarId: z.string().optional().default('primary'),
  maxResults: z.number().int().min(1).max(2500).optional().default(10),
  timeMin: z.string().optional().default(''),
  timeMax: z.string().optional().default(''),
  query: z.string().optional().default(''),
  singleEvents: z.boolean().optional().default(true),
  orderBy: z.enum(['startTime', 'updated']).optional().default('startTime'),
});

export const googleCalendarListEventsAction = defineAction({
  id: 'google_calendar.list_events',
  name: 'List Events',
  description:
    'List events from a Google Calendar (events.list). Use when the user wants to see upcoming meetings, check their schedule, or search for events.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"events": [{"id": "abc123", "summary": "Team Meeting", "start": {"dateTime": "2025-03-15T10:00:00Z"}, "status": "confirmed"}], "eventCount": 1}\n' +
    '```',
  provider: GOOGLE_CALENDAR_PROVIDER,
  actionCategory: 'read',

  credential: {
    required: true,
    type: 'oauth2',
    oauth2Provider: 'google',
    requiredScopes: [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/calendar.events',
    ],
    description: 'Google Calendar OAuth2 credential',
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
        name: 'calendarId',
        label: 'Calendar ID',
        type: 'text',
        defaultValue: 'primary',
        description: "Calendar ID (use 'primary' for the default calendar)",
        aiProvided: true,
      },
      {
        name: 'maxResults',
        label: 'Max Results',
        type: 'number',
        defaultValue: 10,
        description: 'Maximum number of events to return',
        aiProvided: true,
      },
      {
        name: 'timeMin',
        label: 'Start Date',
        type: 'text',
        placeholder: '2025-01-01T00:00:00Z',
        description: 'Lower bound for event start time (ISO 8601 format)',
        aiProvided: true,
      },
      {
        name: 'timeMax',
        label: 'End Date',
        type: 'text',
        placeholder: '2025-12-31T23:59:59Z',
        description: 'Upper bound for event start time (ISO 8601 format)',
        aiProvided: true,
      },
      {
        name: 'query',
        label: 'Search Query',
        type: 'text',
        placeholder: 'meeting',
        description: 'Free-text search for events',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'singleEvents',
        label: 'Expand Recurring',
        type: 'boolean',
        defaultValue: true,
        description: 'Expand recurring events into individual instances',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'orderBy',
        label: 'Order By',
        type: 'select',
        defaultValue: 'startTime',
        options: [
          { label: 'Start Time', value: 'startTime' },
          { label: 'Updated', value: 'updated' },
        ],
        description: 'Sort order for results',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['google', 'calendar', 'events', 'list', 'schedule', 'oauth2'],

  async execute(params, context) {
    const { credentialId, calendarId, maxResults, timeMin, timeMax, query, singleEvents, orderBy } =
      params;

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

    context.logger.debug('Listing Google Calendar events', { calendarId, maxResults });

    try {
      const url = new URL(
        `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events`,
      );
      url.searchParams.set('maxResults', String(maxResults));
      url.searchParams.set('singleEvents', String(singleEvents));
      url.searchParams.set('orderBy', orderBy);

      if (timeMin?.trim()) {
        url.searchParams.set('timeMin', timeMin);
      } else {
        url.searchParams.set('timeMin', new Date().toISOString());
      }
      if (timeMax?.trim()) {
        url.searchParams.set('timeMax', timeMax);
      }
      if (query?.trim()) {
        url.searchParams.set('q', query);
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
          error: `Google Calendar API error: ${response.status} - ${errorText}`,
        };
      }

      const data = (await response.json()) as {
        items?: Array<Record<string, unknown>>;
        summary?: string;
        nextPageToken?: string;
      };

      const events = (data.items ?? []).map((event) => ({
        id: event.id,
        summary: event.summary,
        description: event.description,
        location: event.location,
        start: event.start,
        end: event.end,
        status: event.status,
        htmlLink: event.htmlLink,
        organizer: event.organizer,
        attendees: event.attendees,
        created: event.created,
        updated: event.updated,
      }));

      return {
        success: true,
        output: {
          calendarName: data.summary,
          events,
          eventCount: events.length,
          hasMore: !!data.nextPageToken,
        },
        metadata: { eventCount: events.length },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Google Calendar operation failed: ${msg}` };
    }
  },
});
