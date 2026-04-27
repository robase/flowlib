/**
 * google_calendar.update_event — Update a Google Calendar event
 *
 * Updates an existing event's details (title, description, times, etc.).
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
  summary: z.string().optional(),
  description: z.string().optional(),
  location: z.string().optional(),
  startDateTime: z.string().optional(),
  endDateTime: z.string().optional(),
  timeZone: z.string().optional().default(''),
  attendees: z.array(z.string()).optional().default([]),
  sendUpdates: z.enum(['all', 'externalOnly', 'none']).optional().default('none'),
});

export const googleCalendarUpdateEventAction = defineAction({
  id: 'google_calendar.update_event',
  name: 'Update Event',
  description:
    'Update an existing Google Calendar event (events.patch). Use when the user wants to reschedule, rename, or change details of an event.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"id": "abc123", "summary": "Updated Meeting", "start": {"dateTime": "2025-03-15T14:00:00Z"}, "status": "confirmed"}\n' +
    '```',
  provider: GOOGLE_CALENDAR_PROVIDER,
  actionCategory: 'write',

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
        description: 'The ID of the event to update',
        aiProvided: true,
      },
      {
        name: 'summary',
        label: 'Title',
        type: 'text',
        placeholder: 'Updated Meeting Title',
        description: 'New event title',
        aiProvided: true,
      },
      {
        name: 'startDateTime',
        label: 'Start',
        type: 'text',
        placeholder: '2025-03-15T14:00:00',
        description: 'New start date/time in ISO 8601 format',
        aiProvided: true,
      },
      {
        name: 'endDateTime',
        label: 'End',
        type: 'text',
        placeholder: '2025-03-15T15:00:00',
        description: 'New end date/time in ISO 8601 format',
        aiProvided: true,
      },
      {
        name: 'description',
        label: 'Description',
        type: 'textarea',
        description: 'New event description',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'location',
        label: 'Location',
        type: 'text',
        description: 'New event location',
        extended: true,
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
      {
        name: 'timeZone',
        label: 'Time Zone',
        type: 'text',
        placeholder: 'America/New_York',
        description: 'IANA time zone',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'sendUpdates',
        label: 'Send Updates',
        type: 'select',
        defaultValue: 'none',
        options: [
          { label: 'None', value: 'none' },
          { label: 'All', value: 'all' },
          { label: 'External Only', value: 'externalOnly' },
        ],
        description: 'Who to send notification emails to',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'attendees',
        label: 'Attendees',
        type: 'text',
        placeholder: 'user@example.com, other@example.com',
        description:
          'Comma-separated list of attendee email addresses. Replaces existing attendees.',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['google', 'calendar', 'event', 'update', 'edit', 'oauth2'],

  async execute(params, context) {
    const {
      credentialId,
      calendarId,
      eventId,
      summary,
      description,
      location,
      startDateTime,
      endDateTime,
      timeZone,
      attendees,
      sendUpdates,
    } = params;

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

    context.logger.debug('Updating Google Calendar event', { eventId, calendarId });

    try {
      const patch: Record<string, unknown> = {};
      if (summary !== undefined) {
        patch.summary = summary;
      }
      if (description !== undefined) {
        patch.description = description;
      }
      if (location !== undefined) {
        patch.location = location;
      }
      if (startDateTime) {
        patch.start = { dateTime: startDateTime, ...(timeZone ? { timeZone } : {}) };
      }
      if (endDateTime) {
        patch.end = { dateTime: endDateTime, ...(timeZone ? { timeZone } : {}) };
      }
      if (attendees && attendees.length > 0) {
        patch.attendees = attendees.map((email) => ({ email: email.trim() }));
      }

      const url = new URL(
        `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      );
      url.searchParams.set('sendUpdates', sendUpdates);

      const response = await fetch(url.toString(), {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(patch),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Google Calendar API error: ${response.status} - ${errorText}`,
        };
      }

      const updated = (await response.json()) as Record<string, unknown>;

      return {
        success: true,
        output: {
          eventId: updated.id,
          summary: updated.summary,
          htmlLink: updated.htmlLink,
          start: updated.start,
          end: updated.end,
          updated: updated.updated,
        },
        metadata: { eventId: updated.id },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Google Calendar operation failed: ${msg}` };
    }
  },
});
