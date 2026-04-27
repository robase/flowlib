/**
 * twitter.search_tweets — Search recent tweets
 *
 * Searches for recent tweets matching a query using the Twitter API v2
 * recent search endpoint. Returns tweet text, author ID, timestamps,
 * and public engagement metrics.
 * Requires a Twitter OAuth2 credential with tweet.read scope.
 */

import { defineAction } from '@flowlib/action-kit';
import { TWITTER_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const TWITTER_API = 'https://api.twitter.com/2';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Twitter credential is required'),
  query: z.string().min(1, 'Search query is required'),
  maxResults: z.number().int().min(10).max(100).optional().default(10),
});

export const twitterSearchTweetsAction = defineAction({
  id: 'twitter.search_tweets',
  name: 'Search Tweets',
  description:
    'Search recent tweets matching a query (GET /2/tweets/search/recent). Use when the user wants to find tweets about a topic, hashtag, or from a specific account.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"data": [{"id": "123", "text": "Hello", "author_id": "456", "public_metrics": {"like_count": 5}}], "meta": {"result_count": 10}}\n' +
    '```',
  provider: TWITTER_PROVIDER,
  actionCategory: 'read',

  credential: {
    required: true,
    type: 'oauth2',
    oauth2Provider: 'twitter',
    requiredScopes: ['tweet.read', 'offline.access'],
    description: 'Twitter OAuth2 credential with tweet.read scope',
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
        name: 'query',
        label: 'Search Query',
        type: 'text',
        required: true,
        placeholder: 'from:elonmusk OR #SpaceX',
        description:
          'Twitter search query. Supports operators like from:, to:, #hashtag, "exact phrase", etc.',
        aiProvided: true,
      },
      {
        name: 'maxResults',
        label: 'Max Results',
        type: 'number',
        defaultValue: 10,
        description: 'Maximum number of tweets to return (10–100)',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['twitter', 'x', 'search', 'tweets', 'social-media', 'oauth2'],

  async execute(params, context) {
    const { credentialId, query, maxResults } = params;

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

    context.logger.debug('Searching tweets', { query, maxResults });

    try {
      const searchParams = new URLSearchParams({
        query,
        max_results: String(maxResults),
        'tweet.fields': 'created_at,public_metrics,author_id',
      });

      const response = await fetch(
        `${TWITTER_API}/tweets/search/recent?${searchParams.toString()}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );

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
          author_id?: string;
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
          query,
          resultCount: data.meta?.result_count ?? 0,
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Twitter search tweets failed: ${msg}` };
    }
  },
});
