/**
 * segment.track — Track an analytics event
 *
 * Records an analytics event for a known user via the Segment HTTP
 * Tracking API.  Requires a Segment write key stored as an API-key
 * credential.
 */

import { defineAction } from '@flowlib/action-kit';
import { SEGMENT_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const SEGMENT_API = 'https://api.segment.io';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Segment credential is required'),
  userId: z.string().min(1, 'userId is required'),
  event: z.string().min(1, 'Event name is required'),
  properties: z.string().optional().default(''),
  timestamp: z.string().optional().default(''),
});

export const segmentTrackAction = defineAction({
  id: 'segment.track',
  name: 'Track Event',
  description:
    'Track an analytics event for a user via Segment (POST /v1/track). Use when the user wants to record a business event like a purchase, signup, or feature usage. ' +
    'Call with `userId`, `event` (e.g. "Order Completed"), and an optional `properties` JSON object with event-specific data. ' +
    'An optional ISO 8601 `timestamp` overrides the server default. Note: only `userId` is supported; `anonymousId`-only calls are not yet available.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"acknowledged": true, "userId": "user-123", "event": "Order Completed"}\n' +
    '```',
  provider: SEGMENT_PROVIDER,
  actionCategory: 'write',

  credential: {
    required: true,
    type: 'api_key',
    description: 'Segment write key for the HTTP Tracking API',
  },

  params: {
    schema: paramsSchema,
    fields: [
      {
        name: 'credentialId',
        label: 'Segment Credential',
        type: 'text',
        required: true,
        description: 'Segment write key credential for authentication',
        aiProvided: false,
      },
      {
        name: 'userId',
        label: 'User ID',
        type: 'text',
        required: true,
        placeholder: 'user-123',
        description: 'Unique identifier for the user',
        aiProvided: true,
      },
      {
        name: 'event',
        label: 'Event Name',
        type: 'text',
        required: true,
        placeholder: 'Order Completed',
        description: 'Name of the event to track',
        aiProvided: true,
      },
      {
        name: 'properties',
        label: 'Properties',
        type: 'code',
        placeholder: '{"revenue": 39.95, "currency": "USD"}',
        description: 'JSON object of event properties (optional)',
        aiProvided: true,
      },
      {
        name: 'timestamp',
        label: 'Timestamp',
        type: 'text',
        placeholder: '2024-01-01T00:00:00Z',
        description: 'ISO 8601 timestamp. Defaults to current time if omitted.',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['segment', 'analytics', 'tracking', 'event'],

  async execute(params, context) {
    const { credentialId, userId, event, properties, timestamp } = params;

    let credential = context.credential;
    if (!credential && context.functions?.getCredential) {
      credential = await context.functions.getCredential(credentialId);
    }
    if (!credential) {
      return {
        success: false,
        error: `Credential not found: ${credentialId}. Please create a Segment credential with your write key.`,
      };
    }

    const writeKey =
      (credential.config?.writeKey as string) ??
      (credential.config?.apiKey as string) ??
      (credential.config?.accessToken as string) ??
      (credential.config?.token as string);
    if (!writeKey) {
      return {
        success: false,
        error: 'No Segment write key found in credential.',
      };
    }

    context.logger.debug('Tracking Segment event', { userId, event });

    try {
      const body: Record<string, unknown> = { userId, event };

      if (properties) {
        try {
          body.properties = JSON.parse(properties);
        } catch {
          return { success: false, error: 'Properties must be valid JSON.' };
        }
      }

      if (timestamp) {
        body.timestamp = timestamp;
      }

      const response = await fetch(`${SEGMENT_API}/v1/track`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${btoa(`${writeKey}:`)}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Segment API error: ${response.status} ${response.statusText} — ${errorText}`,
        };
      }

      const data = (await response.json()) as { success: boolean };

      return {
        success: true,
        output: { acknowledged: data.success, userId, event },
        metadata: { sentAt: new Date().toISOString() },
      };
    } catch (err) {
      return {
        success: false,
        error: `Failed to track Segment event: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});
