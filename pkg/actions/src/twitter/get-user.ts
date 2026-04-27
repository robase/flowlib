/**
 * twitter.get_user — Get a user profile by username
 *
 * Retrieves a Twitter user's profile information including description,
 * public metrics, profile image, and account creation date.
 * Requires a Twitter OAuth2 credential with users.read scope.
 */

import { defineAction } from '@flowlib/action-kit';
import { TWITTER_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const TWITTER_API = 'https://api.twitter.com/2';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Twitter credential is required'),
  username: z.string().min(1, 'Username is required'),
});

export const twitterGetUserAction = defineAction({
  id: 'twitter.get_user',
  name: 'Get User',
  description:
    'Look up a Twitter/X user profile by username (GET /2/users/by/username/:username). Use when the user wants to find information about a specific Twitter account.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"data": {"id": "2244994945", "name": "X Developers", "username": "XDevelopers", "description": "The voice of the X developer community", "public_metrics": {"followers_count": 583423}}}\n' +
    '```',
  provider: TWITTER_PROVIDER,
  actionCategory: 'read',

  credential: {
    required: true,
    type: 'oauth2',
    oauth2Provider: 'twitter',
    requiredScopes: ['users.read', 'offline.access'],
    description: 'Twitter OAuth2 credential with users.read scope',
  },

  params: {
    schema: paramsSchema,
    fields: [
      {
        name: 'credentialId',
        label: 'Twitter Credential',
        type: 'text',
        required: true,
        description: 'Twitter OAuth2 credential for authentication',
        aiProvided: false,
      },
      {
        name: 'username',
        label: 'Username',
        type: 'text',
        required: true,
        placeholder: 'elonmusk',
        description: 'Twitter username (without the @ symbol)',
        aiProvided: true,
      },
    ],
  },

  tags: ['twitter', 'x', 'user', 'profile', 'social-media', 'oauth2'],

  async execute(params, context) {
    const { credentialId, username } = params;

    let credential = context.credential;
    if (!credential && context.functions?.getCredential) {
      credential = await context.functions.getCredential(credentialId);
    }
    if (!credential) {
      return {
        success: false,
        error: `Credential not found: ${credentialId}. Please create a Twitter OAuth2 credential.`,
      };
    }

    const accessToken =
      (credential.config?.accessToken as string) ?? (credential.config?.token as string);
    if (!accessToken) {
      return {
        success: false,
        error: 'No valid access token in credential. Please re-authorize the Twitter credential.',
      };
    }

    context.logger.debug('Fetching Twitter user profile', { username });

    try {
      const url = `${TWITTER_API}/users/by/username/${encodeURIComponent(username)}?user.fields=description,public_metrics,profile_image_url,created_at`;

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        const errorBody = await response.text();
        return {
          success: false,
          error: `Twitter API error (${response.status}): ${errorBody}`,
        };
      }

      const data = (await response.json()) as {
        data?: {
          id: string;
          name: string;
          username: string;
          description?: string;
          profile_image_url?: string;
          created_at?: string;
          public_metrics?: {
            followers_count: number;
            following_count: number;
            tweet_count: number;
            listed_count: number;
          };
        };
        errors?: Array<{ detail: string }>;
      };

      if (data.errors?.length) {
        return {
          success: false,
          error: `Twitter API error: ${data.errors[0].detail}`,
        };
      }

      return {
        success: true,
        output: data.data,
        metadata: {
          username: data.data?.username,
          userId: data.data?.id,
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Twitter get user failed: ${msg}` };
    }
  },
});
