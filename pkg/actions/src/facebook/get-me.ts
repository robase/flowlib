/**
 * facebook.get_me — Get authenticated user profile
 *
 * Retrieves the profile of the currently authenticated Facebook user
 * using the Graph API /me endpoint.
 */

import { defineAction } from '@flowlib/action-kit';
import { FACEBOOK_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const FACEBOOK_API = 'https://graph.facebook.com/v21.0';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Facebook credential is required'),
});

export const facebookGetMeAction = defineAction({
  id: 'facebook.get_me',
  name: 'Get Me',
  description:
    'Get the authenticated Facebook user profile (GET /me). Use when the user wants to verify their Facebook identity or retrieve their account info.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"id": "10158012345678901", "name": "John Doe", "email": "john@example.com"}\n' +
    '```',
  actionCategory: 'read',
  provider: FACEBOOK_PROVIDER,

  credential: {
    required: true,
    type: 'oauth2',
    oauth2Provider: 'facebook',
    requiredScopes: ['public_profile', 'email'],
    description: 'Facebook OAuth2 credential with public_profile and email scopes',
  },

  params: {
    schema: paramsSchema,
    fields: [
      {
        name: 'credentialId',
        label: 'Facebook Credential',
        type: 'text',
        required: true,
        description: 'Facebook OAuth2 credential for authentication',
        aiProvided: false,
      },
    ],
  },

  tags: ['facebook', 'profile', 'user', 'oauth2'],

  async execute(params, context) {
    const { credentialId } = params;

    let credential = context.credential;
    if (!credential && context.functions?.getCredential) {
      credential = await context.functions.getCredential(credentialId);
    }
    if (!credential) {
      return { success: false, error: `Credential not found: ${credentialId}` };
    }

    const accessToken =
      (credential.config?.accessToken as string) ?? (credential.config?.token as string);
    if (!accessToken) {
      return { success: false, error: 'No valid access token.' };
    }

    context.logger.debug('Fetching Facebook user profile');

    try {
      const response = await fetch(`${FACEBOOK_API}/me?fields=id,name,email`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      const data = (await response.json()) as {
        id?: string;
        name?: string;
        email?: string;
        error?: { message: string; type: string; code: number };
      };

      if (data.error) {
        return {
          success: false,
          error: `Facebook API error: ${data.error.message}`,
        };
      }

      return {
        success: true,
        output: data,
      };
    } catch (err) {
      return {
        success: false,
        error: `Failed to fetch Facebook profile: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});
