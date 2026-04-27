/**
 * google_calendar.get_event — Get a specific Google Calendar event
 *
 * Retrieves full details of a single event by its ID.
 * Requires a Google Calendar OAuth2 credential.
 */

import { defineAction } from '@flowlib/action-kit';
import { GOOGLE_CALENDAR_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Google Calendar credential is required'),
  calendarId: z.string().optional().default('primary'),
  eventId: z.string().min(1, 'Event ID is required'),
});

export const googleCalendarGetEventAction = defineAction({
  id: 'google_calendar.get_event',
  name: 'Get Event',
  description:
    'Retrieve full details of a Google Calendar event by ID (events.get). Use when the user wants to see all details of a specific event.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"id": "abc123", "summary": "Team Meeting", "start": {"dateTime": "2025-03-15T10:00:00Z"}, "attendees": [{"email": "alice@example.com"}], "htmlLink": "https://calendar.google.com/event?eid=abc"}\n' +
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
        name: 'eventId',
        label: 'Event ID',
        type: 'text',
        required: true,
        description: 'The ID of the event to retrieve',
        aiProvided: true,
      },
      {
        name: 'calendarId',
        label: 'Calendar ID',
        type: 'text',
        defaultValue: 'primary',
        description: "Calendar ID (use 'primary' for the default calendar)",
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['google', 'calendar', 'event', 'get', 'read', 'oauth2'],

  async execute(params, context) {
    const { credentialId, calendarId, eventId } = params;

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

    context.logger.debug('Getting Google Calendar event', { eventId, calendarId });

    try {
      const response = await fetch(
        `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
          },
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Google Calendar API error: ${response.status} - ${errorText}`,
        };
      }

      const event = (await response.json()) as Record<string, unknown>;

      return {
        success: true,
        output: {
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
          recurrence: event.recurrence,
          created: event.created,
          updated: event.updated,
        },
        metadata: { eventId: event.id },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Google Calendar operation failed: ${msg}` };
    }
  },
});
