/**
 * segment.identify — Identify a user with traits
 *
 * Associates a user with their traits (email, name, plan, etc.) via
 * the Segment HTTP Tracking API.  Requires a Segment write key stored
 * as an API-key credential.
 */

import { defineAction } from '@flowlib/action-kit';
import { SEGMENT_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const SEGMENT_API = 'https://api.segment.io';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Segment credential is required'),
  userId: z.string().min(1, 'userId is required'),
  traits: z.string().optional().default(''),
  timestamp: z.string().optional().default(''),
});

export const segmentIdentifyAction = defineAction({
  id: 'segment.identify',
  name: 'Identify User',
  description:
    'Identify a user and set traits via Segment (POST /v1/identify). Use when the user wants to associate profile attributes like email, name, or plan with a user ID. ' +
    'Call with `userId` and an optional `traits` JSON object (e.g. `{"email": "...", "plan": "pro"}`). ' +
    'An optional ISO 8601 `timestamp` overrides the server default. Note: only `userId` is supported; `anonymousId`-only calls are not yet available.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"acknowledged": true, "userId": "user-123"}\n' +
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
        name: 'traits',
        label: 'Traits',
        type: 'code',
        placeholder: '{"email": "user@example.com", "name": "Jane Doe"}',
        description: 'JSON object of user traits (optional)',
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

  tags: ['segment', 'analytics', 'identify', 'user', 'traits'],

  async execute(params, context) {
    const { credentialId, userId, traits, timestamp } = params;

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

    context.logger.debug('Identifying Segment user', { userId });

    try {
      const body: Record<string, unknown> = { userId };

      if (traits) {
        try {
          body.traits = JSON.parse(traits);
        } catch {
          return { success: false, error: 'Traits must be valid JSON.' };
        }
      }

      if (timestamp) {
        body.timestamp = timestamp;
      }

      const response = await fetch(`${SEGMENT_API}/v1/identify`, {
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
        output: { acknowledged: data.success, userId },
        metadata: { sentAt: new Date().toISOString() },
      };
    } catch (err) {
      return {
        success: false,
        error: `Failed to identify Segment user: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});
