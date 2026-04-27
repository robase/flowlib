/**
 * mixpanel.create_profile — Set user profile properties
 *
 * Creates or updates a user profile in Mixpanel via the Engage API
 * (`/engage`).  Uses the `$set` operation to set profile properties.
 */

import { defineAction } from '@flowlib/action-kit';
import { MIXPANEL_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const MIXPANEL_API = 'https://api.mixpanel.com';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Mixpanel credential is required'),
  distinctId: z.string().min(1, 'Distinct ID is required'),
  properties: z.string().min(1, 'Profile properties JSON is required'),
});

export const mixpanelCreateProfileAction = defineAction({
  id: 'mixpanel.create_profile',
  name: 'Create / Update Profile',
  description:
    'Set user profile properties in Mixpanel (POST /engage#profile-set). Use when the user wants to create or update a user profile with attributes like name, email, or plan.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"status": 1, "distinctId": "user-123"}\n' +
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
        name: 'distinctId',
        label: 'Distinct ID',
        type: 'text',
        required: true,
        placeholder: 'user-123',
        description: 'Unique identifier for the user profile',
        aiProvided: true,
      },
      {
        name: 'properties',
        label: 'Profile Properties',
        type: 'code',
        required: true,
        placeholder: '{"$name": "Jane Doe", "$email": "jane@example.com", "plan": "pro"}',
        description:
          'JSON object of profile properties to set. Use $name, $email, etc. for reserved props.',
        aiProvided: true,
      },
    ],
  },

  tags: ['mixpanel', 'analytics', 'profile', 'user', 'engage'],

  async execute(params, context) {
    const { credentialId, distinctId, properties } = params;

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
    const token = credential.config?.projectToken as string;

    if (!username || !secret) {
      return {
        success: false,
        error: 'Mixpanel service account username and secret are required in the credential.',
      };
    }

    context.logger.debug('Setting Mixpanel profile', { distinctId });

    try {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(properties) as Record<string, unknown>;
      } catch {
        return { success: false, error: 'Profile properties must be valid JSON.' };
      }

      const engageBody = [
        {
          $distinct_id: distinctId,
          ...(token ? { $token: token } : {}),
          $set: parsed,
        },
      ];

      const url = projectId
        ? `${MIXPANEL_API}/engage?project_id=${encodeURIComponent(projectId)}`
        : `${MIXPANEL_API}/engage`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${btoa(`${username}:${secret}`)}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(engageBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Mixpanel API error: ${response.status} ${response.statusText} — ${errorText}`,
        };
      }

      const data = (await response.json()) as { status: number } | number;
      const status = typeof data === 'number' ? data : data.status;

      return {
        success: status === 1,
        output: { status, distinctId },
        metadata: { sentAt: new Date().toISOString() },
        ...(status !== 1 ? { error: 'Mixpanel returned a non-success status.' } : {}),
      };
    } catch (err) {
      return {
        success: false,
        error: `Failed to set Mixpanel profile: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});
