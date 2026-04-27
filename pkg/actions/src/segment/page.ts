/**
 * segment.page — Record a page view
 *
 * Records a page view for a known user via the Segment HTTP Tracking
 * API.  Requires a Segment write key stored as an API-key credential.
 */

import { defineAction } from '@flowlib/action-kit';
import { SEGMENT_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const SEGMENT_API = 'https://api.segment.io';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Segment credential is required'),
  userId: z.string().min(1, 'userId is required'),
  name: z.string().min(1, 'Page name is required'),
  properties: z.string().optional().default(''),
});

export const segmentPageAction = defineAction({
  id: 'segment.page',
  name: 'Page View',
  description:
    'Record a page view for a user via Segment (POST /v1/page). Use when the user wants to track which pages a user visits along with page metadata. ' +
    'Call with `userId`, `name` (page name, e.g. "Home"), and an optional `properties` JSON object (e.g. `{"url": "...", "referrer": "..."}`). ' +
    'Note: only `userId` is supported; `anonymousId`-only calls are not yet available.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"acknowledged": true, "userId": "user-123", "name": "Home"}\n' +
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
        name: 'name',
        label: 'Page Name',
        type: 'text',
        required: true,
        placeholder: 'Home',
        description: 'Name of the page viewed',
        aiProvided: true,
      },
      {
        name: 'properties',
        label: 'Properties',
        type: 'code',
        placeholder: '{"url": "https://example.com/home", "referrer": "https://google.com"}',
        description: 'JSON object of page properties (optional)',
        aiProvided: true,
      },
    ],
  },

  tags: ['segment', 'analytics', 'page', 'pageview'],

  async execute(params, context) {
    const { credentialId, userId, name, properties } = params;

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

    context.logger.debug('Recording Segment page view', { userId, name });

    try {
      const body: Record<string, unknown> = { userId, name };

      if (properties) {
        try {
          body.properties = JSON.parse(properties);
        } catch {
          return { success: false, error: 'Properties must be valid JSON.' };
        }
      }

      const response = await fetch(`${SEGMENT_API}/v1/page`, {
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
        output: { acknowledged: data.success, userId, name },
        metadata: { sentAt: new Date().toISOString() },
      };
    } catch (err) {
      return {
        success: false,
        error: `Failed to record Segment page view: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});
