/**
 * microsoft.list_calendar_events — List events from a Microsoft 365 calendar
 *
 * Retrieves upcoming or past events from a calendar via the Microsoft Graph API.
 * Requires a Microsoft 365 OAuth2 credential with Calendars.Read scope.
 */

import { defineAction } from '@flowlib/action-kit';
import { MICROSOFT_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0';

interface GraphEvent {
  id: string;
  subject: string;
  bodyPreview: string;
  body?: { contentType: string; content: string };
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  location?: { displayName: string; locationType?: string };
  organizer?: { emailAddress: { name: string; address: string } };
  attendees?: Array<{
    emailAddress: { name: string; address: string };
    status?: { response: string };
    type: string;
  }>;
  isOnlineMeeting: boolean;
  onlineMeetingUrl?: string;
  onlineMeeting?: { joinUrl: string };
  webLink: string;
  isCancelled: boolean;
  isAllDay: boolean;
  importance: string;
  showAs: string;
  categories: string[];
  createdDateTime: string;
  lastModifiedDateTime: string;
}

interface GraphEventsResponse {
  value: GraphEvent[];
  '@odata.nextLink'?: string;
}

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Microsoft 365 credential is required'),
  calendarId: z.string().optional().default(''),
  top: z.number().int().min(1).max(1000).optional().default(25),
  startDateTime: z.string().optional().default(''),
  endDateTime: z.string().optional().default(''),
  filter: z.string().optional().default(''),
  search: z.string().optional().default(''),
  orderBy: z.string().optional().default('start/dateTime'),
});

export const microsoftListCalendarEventsAction = defineAction({
  id: 'microsoft.list_calendar_events',
  name: 'List Calendar Events',
  description:
    'List events from a Microsoft 365 calendar (GET /me/events or /me/calendarView). Use when you need to retrieve upcoming meetings, check schedules, or search calendar events.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"id": "AAMkAGI1A...", "subject": "Team Standup", "start": {"dateTime": "2025-01-15T09:00:00", "timeZone": "UTC"}, "end": {"dateTime": "2025-01-15T09:30:00", "timeZone": "UTC"}, "isOnlineMeeting": true}\n' +
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
        name: 'calendarId',
        label: 'Calendar ID',
        type: 'text',
        description: 'Calendar ID from list_calendars. Leave empty for the default calendar.',
        placeholder: 'Leave empty for default calendar',
        aiProvided: true,
      },
      {
        name: 'top',
        label: 'Max Results',
        type: 'number',
        defaultValue: 25,
        description: 'Maximum number of events to return (1–1000)',
        aiProvided: true,
      },
      {
        name: 'startDateTime',
        label: 'Start Date/Time',
        type: 'text',
        placeholder: '2025-01-01T00:00:00Z',
        description:
          'Lower bound for events (ISO 8601). When set with End Date, uses calendarView for expanded recurring events.',
        aiProvided: true,
      },
      {
        name: 'endDateTime',
        label: 'End Date/Time',
        type: 'text',
        placeholder: '2025-12-31T23:59:59Z',
        description: 'Upper bound for events (ISO 8601)',
        aiProvided: true,
      },
      {
        name: 'filter',
        label: 'OData Filter',
        type: 'text',
        placeholder: "sensitivity eq 'normal'",
        description: 'OData $filter expression for advanced filtering',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'search',
        label: 'Search',
        type: 'text',
        placeholder: 'quarterly review',
        description: 'Free-text search across event subject and body',
        aiProvided: true,
      },
      {
        name: 'orderBy',
        label: 'Order By',
        type: 'text',
        defaultValue: 'start/dateTime',
        description: 'OData $orderby expression (e.g. "start/dateTime", "subject")',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['microsoft', 'outlook', 'calendar', 'events', 'schedule', 'graph', 'oauth2'],

  async execute(params, context) {
    const { credentialId, calendarId, top, startDateTime, endDateTime, filter, search, orderBy } =
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

    context.logger.debug('Listing Microsoft 365 calendar events', { calendarId, top });

    try {
      // Determine the base path — specific calendar or default
      const calBase = calendarId?.trim()
        ? `${GRAPH_API_BASE}/me/calendars/${encodeURIComponent(calendarId)}`
        : `${GRAPH_API_BASE}/me`;

      // If both start and end dates are provided, use calendarView (expands recurring events)
      const useCalendarView = !!startDateTime?.trim() && !!endDateTime?.trim();

      let url: URL;
      if (useCalendarView) {
        url = new URL(`${calBase}/calendarView`);
        url.searchParams.set('startDateTime', startDateTime);
        url.searchParams.set('endDateTime', endDateTime);
      } else {
        url = new URL(`${calBase}/events`);
      }

      url.searchParams.set('$top', String(top));

      if (!useCalendarView && orderBy?.trim()) {
        url.searchParams.set('$orderby', orderBy);
      }
      if (filter?.trim()) {
        url.searchParams.set('$filter', filter);
      }
      if (search?.trim()) {
        url.searchParams.set('$search', `"${search}"`);
      }

      // Select relevant fields to keep response manageable
      url.searchParams.set(
        '$select',
        'id,subject,bodyPreview,start,end,location,organizer,attendees,isOnlineMeeting,onlineMeetingUrl,onlineMeeting,webLink,isCancelled,isAllDay,importance,showAs,categories,createdDateTime,lastModifiedDateTime',
      );

      const headers: Record<string, string> = {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      };

      // Prefer header needed for $search and calendarView timezone handling
      if (search?.trim()) {
        headers['ConsistencyLevel'] = 'eventual';
      }

      const response = await fetch(url.toString(), { headers });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Microsoft Graph API error: ${response.status} - ${errorText}`,
        };
      }

      const data = (await response.json()) as GraphEventsResponse;

      const events = data.value.map((ev) => ({
        id: ev.id,
        subject: ev.subject,
        bodyPreview: ev.bodyPreview,
        start: ev.start,
        end: ev.end,
        location: ev.location?.displayName ?? null,
        organizer: ev.organizer?.emailAddress ?? null,
        attendees: ev.attendees?.map((a) => ({
          name: a.emailAddress.name,
          email: a.emailAddress.address,
          response: a.status?.response,
          type: a.type,
        })),
        isOnlineMeeting: ev.isOnlineMeeting,
        joinUrl: ev.onlineMeeting?.joinUrl ?? ev.onlineMeetingUrl ?? null,
        webLink: ev.webLink,
        isCancelled: ev.isCancelled,
        isAllDay: ev.isAllDay,
        importance: ev.importance,
        showAs: ev.showAs,
        categories: ev.categories,
      }));

      return {
        success: true,
        output: {
          events,
          eventCount: events.length,
          hasMore: !!data['@odata.nextLink'],
        },
        metadata: { eventCount: events.length },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Microsoft Graph operation failed: ${msg}` };
    }
  },
});
