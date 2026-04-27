/**
 * twitter.get_user_tweets — Get recent tweets by a user
 *
 * Retrieves recent tweets posted by a specific user, identified by their
 * user ID. Returns tweet text, creation time, and public engagement metrics.
 * Requires a Twitter OAuth2 credential with tweet.read and users.read scopes.
 */

import { defineAction } from '@flowlib/action-kit';
import { TWITTER_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const TWITTER_API = 'https://api.twitter.com/2';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Twitter credential is required'),
  userId: z.string().min(1, 'User ID is required'),
  maxResults: z.number().int().min(1).max(100).optional().default(10),
});

export const twitterGetUserTweetsAction = defineAction({
  id: 'twitter.get_user_tweets',
  name: 'Get User Tweets',
  description:
    'Get recent tweets posted by a Twitter/X user (GET /2/users/:id/tweets). Use when the user wants to see what a specific account has been posting.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"data": [{"id": "123", "text": "Hello", "created_at": "2024-01-01T00:00:00Z", "public_metrics": {"like_count": 10, "retweet_count": 2}}], "meta": {"result_count": 5}}\n' +
    '```',
  provider: TWITTER_PROVIDER,
  actionCategory: 'read',

  credential: {
    required: true,
    type: 'oauth2',
    oauth2Provider: 'twitter',
    requiredScopes: ['tweet.read', 'users.read', 'offline.access'],
    description: 'Twitter OAuth2 credential with tweet.read and users.read scopes',
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
        name: 'userId',
        label: 'User ID',
        type: 'text',
        required: true,
        placeholder: '44196397',
        description: 'The numeric Twitter user ID. Use Get User to find a user ID from a username.',
        aiProvided: true,
      },
      {
        name: 'maxResults',
        label: 'Max Results',
        type: 'number',
        defaultValue: 10,
        description: 'Maximum number of tweets to return (1–100)',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['twitter', 'x', 'tweets', 'timeline', 'social-media', 'oauth2'],

  async execute(params, context) {
    const { credentialId, userId, maxResults } = params;

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

    context.logger.debug('Fetching user tweets', { userId, maxResults });

    try {
      const url = `${TWITTER_API}/users/${encodeURIComponent(userId)}/tweets?max_results=${maxResults}&tweet.fields=created_at,public_metrics,text`;

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
        data?: Array<{
          id: string;
          text: string;
          created_at?: string;
          public_metrics?: {
            retweet_count: number;
            reply_count: number;
            like_count: number;
            quote_count: number;
          };
        }>;
        meta?: { result_count: number; newest_id?: string; oldest_id?: string };
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
        output: {
          tweets: data.data ?? [],
          meta: data.meta,
        },
        metadata: {
          userId,
          resultCount: data.meta?.result_count ?? 0,
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Twitter get user tweets failed: ${msg}` };
    }
  },
});
