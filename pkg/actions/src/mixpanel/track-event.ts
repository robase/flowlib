/**
 * mixpanel.track_event — Track an event via the Mixpanel Import API
 *
 * Sends one event to the Mixpanel Import API (`/import`), authenticated
 * with a service-account username + secret.  The project ID is read from
 * the credential config.
 */

import { defineAction } from '@flowlib/action-kit';
import { MIXPANEL_PROVIDER } from '../providers';
import { z } from 'zod/v4';
import { randomUUID } from 'node:crypto';

const MIXPANEL_API = 'https://api.mixpanel.com';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Mixpanel credential is required'),
  event: z.string().min(1, 'Event name is required'),
  distinctId: z.string().min(1, 'Distinct ID is required'),
  properties: z.string().optional().default(''),
  timestamp: z.string().optional().default(''),
});

export const mixpanelTrackEventAction = defineAction({
  id: 'mixpanel.track_event',
  name: 'Track Event',
  description:
    'Track an analytics event in Mixpanel (POST /import). Use when the user wants to record a server-side event like a signup, purchase, or feature interaction. Authenticated via service account.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"code": 200, "status": "OK", "numRecordsImported": 1}\n' +
    '```',
  provider: MIXPANEL_PROVIDER,
  actionCategory: 'write',

  credential: {
    required: true,
    type: 'api_key',
    description: 'Mixpanel service account (username + secret + project ID)',
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
        name: 'event',
        label: 'Event Name',
        type: 'text',
        required: true,
        placeholder: 'Sign Up',
        description: 'Name of the event to track',
        aiProvided: true,
      },
      {
        name: 'distinctId',
        label: 'Distinct ID',
        type: 'text',
        required: true,
        placeholder: 'user-123',
        description: 'Unique identifier for the user performing the event',
        aiProvided: true,
      },
      {
        name: 'properties',
        label: 'Properties',
        type: 'code',
        placeholder: '{"plan": "pro", "source": "web"}',
        description: 'JSON object of custom event properties (optional)',
        aiProvided: true,
      },
      {
        name: 'timestamp',
        label: 'Timestamp',
        type: 'text',
        placeholder: '2024-01-15T10:30:00Z',
        description: 'ISO 8601 timestamp. Defaults to current time if omitted.',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['mixpanel', 'analytics', 'tracking', 'event'],

  async execute(params, context) {
    const { credentialId, event, distinctId, properties, timestamp } = params;

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
    const projectId = credential.config?.projectId as string;

    if (!username || !secret) {
      return {
        success: false,
        error: 'Mixpanel service account username and secret are required in the credential.',
      };
    }

    context.logger.debug('Tracking Mixpanel event', { event, distinctId });

    try {
      const eventProperties: Record<string, unknown> = {
        distinct_id: distinctId,
        time: timestamp
          ? Math.floor(new Date(timestamp).getTime() / 1000)
          : Math.floor(Date.now() / 1000),
        $insert_id: randomUUID(),
      };

      if (properties) {
        try {
          const parsed = JSON.parse(properties) as Record<string, unknown>;
          Object.assign(eventProperties, parsed);
        } catch {
          return { success: false, error: 'Properties must be valid JSON.' };
        }
      }

      const url = projectId
        ? `${MIXPANEL_API}/import?strict=1&project_id=${encodeURIComponent(projectId)}`
        : `${MIXPANEL_API}/import?strict=1`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${btoa(`${username}:${secret}`)}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify([{ event, properties: eventProperties }]),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Mixpanel API error: ${response.status} ${response.statusText} — ${errorText}`,
        };
      }

      const data = (await response.json()) as {
        code: number;
        status: string;
        num_records_imported: number;
      };

      return {
        success: true,
        output: {
          code: data.code,
          status: data.status,
          numRecordsImported: data.num_records_imported,
          event,
          distinctId,
        },
        metadata: { sentAt: new Date().toISOString() },
      };
    } catch (err) {
      return {
        success: false,
        error: `Failed to track Mixpanel event: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});
