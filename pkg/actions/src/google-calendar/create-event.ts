/**
 * google_calendar.create_event — Create a Google Calendar event
 *
 * Creates a new event on a Google Calendar with details like summary,
 * description, location, start/end times, and attendees.
 * Requires a Google Calendar OAuth2 credential.
 */

import { defineAction } from '@flowlib/action-kit';
import { GOOGLE_CALENDAR_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Google Calendar credential is required'),
  calendarId: z.string().optional().default('primary'),
  summary: z.string().min(1, 'Event title is required'),
  description: z.string().optional().default(''),
  location: z.string().optional().default(''),
  startDateTime: z.string().min(1, 'Start date/time is required'),
  endDateTime: z.string().min(1, 'End date/time is required'),
  timeZone: z.string().optional().default(''),
  attendees: z.array(z.string()).optional().default([]),
  sendUpdates: z.enum(['all', 'externalOnly', 'none']).optional().default('none'),
  recurrence: z.string().optional().default(''),
  reminderMinutes: z.number().int().min(0).optional(),
  visibility: z
    .enum(['default', 'public', 'private', 'confidential'])
    .optional()
    .default('default'),
});

export const googleCalendarCreateEventAction = defineAction({
  id: 'google_calendar.create_event',
  name: 'Create Event',
  description:
    'Create a new event on Google Calendar (events.insert). Use when the user wants to schedule a meeting, appointment, or reminder.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"id": "abc123", "summary": "Team Meeting", "start": {"dateTime": "2025-03-15T10:00:00Z"}, "htmlLink": "https://calendar.google.com/event?eid=abc"}\n' +
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
        name: 'summary',
        label: 'Title',
        type: 'text',
        required: true,
        placeholder: 'Team Meeting',
        description: 'Event title / summary',
        aiProvided: true,
      },
      {
        name: 'startDateTime',
        label: 'Start',
        type: 'text',
        required: true,
        placeholder: '2025-03-15T10:00:00',
        description: 'Start date/time in ISO 8601 format',
        aiProvided: true,
      },
      {
        name: 'endDateTime',
        label: 'End',
        type: 'text',
        required: true,
        placeholder: '2025-03-15T11:00:00',
        description: 'End date/time in ISO 8601 format',
        aiProvided: true,
      },
      {
        name: 'description',
        label: 'Description',
        type: 'textarea',
        placeholder: 'Discuss quarterly goals...',
        description: 'Event description',
        aiProvided: true,
      },
      {
        name: 'location',
        label: 'Location',
        type: 'text',
        placeholder: 'Conference Room A',
        description: 'Event location',
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
        description: 'IANA time zone (e.g. America/New_York, Europe/London)',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'attendees',
        label: 'Attendees',
        type: 'json',
        defaultValue: [],
        placeholder: '["alice@example.com", "bob@example.com"]',
        description: 'JSON array of attendee email addresses',
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
        description: 'Who to send email notifications to',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'recurrence',
        label: 'Recurrence Rule',
        type: 'text',
        placeholder: 'RRULE:FREQ=WEEKLY;COUNT=10',
        description: 'RRULE recurrence rule (RFC 5545)',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'reminderMinutes',
        label: 'Reminder (minutes)',
        type: 'number',
        placeholder: '10',
        description: 'Number of minutes before the event to trigger a popup reminder (0–40320)',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'visibility',
        label: 'Visibility',
        type: 'select',
        defaultValue: 'default',
        options: [
          { label: 'Default', value: 'default' },
          { label: 'Public', value: 'public' },
          { label: 'Private', value: 'private' },
          { label: 'Confidential', value: 'confidential' },
        ],
        description: 'Event visibility',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['google', 'calendar', 'event', 'create', 'schedule', 'meeting', 'oauth2'],

  async execute(params, context) {
    const {
      credentialId,
      calendarId,
      summary,
      description,
      location,
      startDateTime,
      endDateTime,
      timeZone,
      attendees,
      sendUpdates,
      recurrence,
      reminderMinutes,
      visibility,
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

    context.logger.debug('Creating Google Calendar event', { summary, calendarId });

    try {
      const event: Record<string, unknown> = {
        summary,
        start: { dateTime: startDateTime, ...(timeZone ? { timeZone } : {}) },
        end: { dateTime: endDateTime, ...(timeZone ? { timeZone } : {}) },
        visibility,
      };

      if (description?.trim()) {
        event.description = description;
      }
      if (location?.trim()) {
        event.location = location;
      }
      if (attendees && attendees.length > 0) {
        event.attendees = attendees.map((email: string) => ({ email }));
      }
      if (recurrence?.trim()) {
        event.recurrence = [recurrence];
      }
      if (reminderMinutes !== undefined) {
        event.reminders = {
          useDefault: false,
          overrides: [{ method: 'popup', minutes: reminderMinutes }],
        };
      }

      const url = new URL(
        `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events`,
      );
      url.searchParams.set('sendUpdates', sendUpdates);

      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(event),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Google Calendar API error: ${response.status} - ${errorText}`,
        };
      }

      const created = (await response.json()) as Record<string, unknown>;

      return {
        success: true,
        output: {
          eventId: created.id,
          summary: created.summary,
          htmlLink: created.htmlLink,
          start: created.start,
          end: created.end,
          status: created.status,
        },
        metadata: { eventId: created.id },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Google Calendar operation failed: ${msg}` };
    }
  },
});
