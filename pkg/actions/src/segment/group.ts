/**
 * segment.group — Associate a user with a group
 *
 * Links a user to a group (company, team, account) and optionally
 * sets group-level traits via the Segment HTTP Tracking API.
 * Requires a Segment write key stored as an API-key credential.
 */

import { defineAction } from '@flowlib/action-kit';
import { SEGMENT_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const SEGMENT_API = 'https://api.segment.io';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Segment credential is required'),
  userId: z.string().min(1, 'userId is required'),
  groupId: z.string().min(1, 'groupId is required'),
  traits: z.string().optional().default(''),
});

export const segmentGroupAction = defineAction({
  id: 'segment.group',
  name: 'Group User',
  description:
    'Associate a user with a group via Segment (POST /v1/group). Use when the user wants to link a user to a company, team, or account and set group-level traits. ' +
    'Call with `userId`, `groupId`, and an optional `traits` JSON object (e.g. `{"name": "Acme Corp", "plan": "enterprise"}`). ' +
    'Note: only `userId` is supported; `anonymousId`-only calls are not yet available.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"acknowledged": true, "userId": "user-123", "groupId": "group-456"}\n' +
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
        name: 'groupId',
        label: 'Group ID',
        type: 'text',
        required: true,
        placeholder: 'group-456',
        description: 'Unique identifier for the group or company',
        aiProvided: true,
      },
      {
        name: 'traits',
        label: 'Traits',
        type: 'code',
        placeholder: '{"name": "Acme Corp", "plan": "enterprise"}',
        description: 'JSON object of group traits (optional)',
        aiProvided: true,
      },
    ],
  },

  tags: ['segment', 'analytics', 'group', 'company', 'organization'],

  async execute(params, context) {
    const { credentialId, userId, groupId, traits } = params;

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

    context.logger.debug('Grouping Segment user', { userId, groupId });

    try {
      const body: Record<string, unknown> = { userId, groupId };

      if (traits) {
        try {
          body.traits = JSON.parse(traits);
        } catch {
          return { success: false, error: 'Traits must be valid JSON.' };
        }
      }

      const response = await fetch(`${SEGMENT_API}/v1/group`, {
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
        output: { acknowledged: data.success, userId, groupId },
        metadata: { sentAt: new Date().toISOString() },
      };
    } catch (err) {
      return {
        success: false,
        error: `Failed to group Segment user: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});
