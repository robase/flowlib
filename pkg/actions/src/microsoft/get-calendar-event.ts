/**
 * microsoft.get_calendar_event — Get a single calendar event
 *
 * Retrieves the full details of a specific calendar event by ID
 * via the Microsoft Graph API.
 * Requires a Microsoft 365 OAuth2 credential with Calendars.Read scope.
 */

import { defineAction } from '@flowlib/action-kit';
import { MICROSOFT_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Microsoft 365 credential is required'),
  eventId: z.string().min(1, 'Event ID is required'),
});

export const microsoftGetCalendarEventAction = defineAction({
  id: 'microsoft.get_calendar_event',
  name: 'Get Calendar Event',
  description:
    'Get the full details of a specific calendar event by its ID (GET /me/events/{id}). Use when you need attendee lists, meeting body, join URLs, or recurrence details for a specific event.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"id": "AAMkAGI1A...", "subject": "Budget Review", "start": {"dateTime": "2025-01-15T14:00:00", "timeZone": "UTC"}, "organizer": {"emailAddress": {"name": "Alice", "address": "alice@example.com"}}, "attendees": [{"emailAddress": {"name": "Bob"}, "type": "required"}]}\n' +
    '```',
  provider: MICROSOFT_PROVIDER,
  actionCategory: 'read',

  credential: {
    required: true,
    type: 'oauth2',
    oauth2Provider: 'microsoft',
    requiredScopes: ['Calendars.Read'],
    description: 'Microsoft 365 OAuth2 credential with Calendars.Read scope',
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
        name: 'eventId',
        label: 'Event ID',
        type: 'text',
        required: true,
        placeholder: 'AAMkAGI1A...',
        description: 'The event ID to retrieve (from list_calendar_events output)',
        aiProvided: true,
      },
    ],
  },

  tags: ['microsoft', 'outlook', 'calendar', 'event', 'read', 'graph', 'oauth2'],

  async execute(params, context) {
    const { credentialId, eventId } = params;

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

    context.logger.debug('Fetching Microsoft 365 calendar event', { eventId });

    try {
      const url = `${GRAPH_API_BASE}/me/events/${encodeURIComponent(eventId)}`;

      const response = await fetch(url, {
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

      const ev = (await response.json()) as Record<string, unknown>;

      const organizer = ev.organizer as
        | { emailAddress: { name: string; address: string } }
        | undefined;
      const attendees = ev.attendees as
        | Array<{
            emailAddress: { name: string; address: string };
            status?: { response: string };
            type: string;
          }>
        | undefined;
      const location = ev.location as { displayName: string } | undefined;
      const body = ev.body as { contentType: string; content: string } | undefined;
      const start = ev.start as { dateTime: string; timeZone: string } | undefined;
      const end = ev.end as { dateTime: string; timeZone: string } | undefined;
      const onlineMeeting = ev.onlineMeeting as { joinUrl: string } | undefined;

      return {
        success: true,
        output: {
          id: ev.id,
          subject: ev.subject,
          body: body ? { contentType: body.contentType, content: body.content } : null,
          bodyPreview: ev.bodyPreview,
          start,
          end,
          location: location?.displayName ?? null,
          organizer: organizer?.emailAddress ?? null,
          attendees: attendees?.map((a) => ({
            name: a.emailAddress.name,
            email: a.emailAddress.address,
            response: a.status?.response,
            type: a.type,
          })),
          isOnlineMeeting: ev.isOnlineMeeting,
          joinUrl: onlineMeeting?.joinUrl ?? (ev.onlineMeetingUrl as string) ?? null,
          webLink: ev.webLink,
          isCancelled: ev.isCancelled,
          isAllDay: ev.isAllDay,
          importance: ev.importance,
          sensitivity: ev.sensitivity,
          showAs: ev.showAs,
          categories: ev.categories,
          recurrence: ev.recurrence,
          createdDateTime: ev.createdDateTime,
          lastModifiedDateTime: ev.lastModifiedDateTime,
        },
        metadata: { eventId: ev.id as string },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Microsoft Graph operation failed: ${msg}` };
    }
  },
});
