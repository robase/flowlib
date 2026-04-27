/**
 * google_calendar.delete_event — Delete a Google Calendar event
 *
 * Deletes an event from a Google Calendar by its ID.
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
  sendUpdates: z.enum(['all', 'externalOnly', 'none']).optional().default('none'),
});

export const googleCalendarDeleteEventAction = defineAction({
  id: 'google_calendar.delete_event',
  name: 'Delete Event',
  description:
    'Delete an event from Google Calendar (events.delete). Use when the user wants to cancel or remove an event from their calendar.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"eventId": "abc123", "deleted": true, "calendarId": "primary"}\n' +
    '```',
  provider: GOOGLE_CALENDAR_PROVIDER,
  actionCategory: 'delete',

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
        description: 'The ID of the event to delete',
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
        name: 'sendUpdates',
        label: 'Send Updates',
        type: 'select',
        defaultValue: 'none',
        options: [
          { label: 'None', value: 'none' },
          { label: 'All', value: 'all' },
          { label: 'External Only', value: 'externalOnly' },
        ],
        description: 'Who to notify about the cancellation',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['google', 'calendar', 'event', 'delete', 'cancel', 'oauth2'],

  async execute(params, context) {
    const { credentialId, calendarId, eventId, sendUpdates } = params;

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

    context.logger.debug('Deleting Google Calendar event', { eventId, calendarId });

    try {
      const url = new URL(
        `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      );
      url.searchParams.set('sendUpdates', sendUpdates);

      const response = await fetch(url.toString(), {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Google Calendar API error: ${response.status} - ${errorText}`,
        };
      }

      return {
        success: true,
        output: { eventId, deleted: true, calendarId },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Google Calendar operation failed: ${msg}` };
    }
  },
});
