/**
 * mixpanel.export_events — Export raw event data
 *
 * Fetches raw event data from the Mixpanel Data Export API for a given
 * date range.  The API returns newline-delimited JSON (JSONL); this
 * action parses it and returns an array of event objects.
 */

import { defineAction } from '@flowlib/action-kit';
import { MIXPANEL_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const MIXPANEL_DATA_API = 'https://data.mixpanel.com/api/2.0';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Mixpanel credential is required'),
  fromDate: z
    .string()
    .min(1, 'from_date is required')
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'fromDate must be YYYY-MM-DD'),
  toDate: z
    .string()
    .min(1, 'to_date is required')
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'toDate must be YYYY-MM-DD'),
  event: z.string().optional().default(''),
  limit: z.string().optional().default(''),
});

export const mixpanelExportEventsAction = defineAction({
  id: 'mixpanel.export_events',
  name: 'Export Events',
  description:
    'Export raw event data from Mixpanel (GET /api/2.0/export). Use when the user wants to download event data for a date range, optionally filtered by event name. Returns JSONL parsed into an array.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"events": [{"event": "Sign Up", "properties": {"distinct_id": "user-1", "time": 1618716477}}], "count": 1, "fromDate": "2025-03-01", "toDate": "2025-03-31"}\n' +
    '```',
  provider: MIXPANEL_PROVIDER,
  actionCategory: 'read',

  credential: {
    required: true,
    type: 'api_key',
    description: 'Mixpanel service account (username + secret)',
  },

  params: {
    schema: paramsSchema,
    fields: [
      {
        name: 'credentialId',
        label: 'Mixpanel Credential',
        type: 'text',
        required: true,
        description: 'Mixpanel service account credential',
        aiProvided: false,
      },
      {
        name: 'fromDate',
        label: 'From Date',
        type: 'text',
        required: true,
        placeholder: '2024-01-01',
        description: 'Start date for export (YYYY-MM-DD)',
        aiProvided: true,
      },
      {
        name: 'toDate',
        label: 'To Date',
        type: 'text',
        required: true,
        placeholder: '2024-01-31',
        description: 'End date for export (YYYY-MM-DD)',
        aiProvided: true,
      },
      {
        name: 'event',
        label: 'Event Name',
        type: 'text',
        placeholder: 'Sign Up',
        description: 'Filter to a specific event name (optional)',
        aiProvided: true,
      },
      {
        name: 'limit',
        label: 'Limit',
        type: 'text',
        placeholder: '1000',
        description:
          'Maximum number of events to return (optional, default: all). The API caps at 100,000.',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['mixpanel', 'analytics', 'export', 'events', 'data'],

  async execute(params, context) {
    const { credentialId, fromDate, toDate, event, limit } = params;

    let credential = context.credential;
    if (!credential && context.functions?.getCredential) {
      credential = await context.functions.getCredential(credentialId);
    }
    if (!credential) {
      return {
        success: false,
        error: `Credential not found: ${credentialId}. Please create a Mixpanel service account credential.`,
      };
    }

    const username =
      (credential.config?.username as string) ?? (credential.config?.apiKey as string);
    const secret =
      (credential.config?.secret as string) ??
      (credential.config?.apiSecret as string) ??
      (credential.config?.token as string);

    if (!username || !secret) {
      return {
        success: false,
        error: 'Mixpanel service account username and secret are required in the credential.',
      };
    }

    const projectId = credential.config?.projectId as string;

    context.logger.debug('Exporting Mixpanel events', { fromDate, toDate, event });

    try {
      const queryParams = new URLSearchParams({
        from_date: fromDate,
        to_date: toDate,
      });

      if (projectId) {
        queryParams.set('project_id', projectId);
      }

      if (event) {
        queryParams.set('event', JSON.stringify([event]));
      }

      const response = await fetch(`${MIXPANEL_DATA_API}/export?${queryParams.toString()}`, {
        method: 'GET',
        headers: {
          Authorization: `Basic ${btoa(`${username}:${secret}`)}`,
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Mixpanel Export API error: ${response.status} ${response.statusText} — ${errorText}`,
        };
      }

      const text = await response.text();

      // Mixpanel export returns newline-delimited JSON (JSONL)
      const lines = text.split('\n').filter((line) => line.trim().length > 0);

      let events: unknown[] = [];
      for (const line of lines) {
        try {
          events.push(JSON.parse(line));
        } catch {
          // Skip malformed lines
        }
      }

      const maxEvents = limit ? parseInt(limit, 10) : 0;
      if (maxEvents > 0) {
        events = events.slice(0, maxEvents);
      }

      return {
        success: true,
        output: { events, count: events.length, fromDate, toDate },
        metadata: { exportedAt: new Date().toISOString() },
      };
    } catch (err) {
      return {
        success: false,
        error: `Failed to export Mixpanel events: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});
