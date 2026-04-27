/**
 * twitter.create_tweet — Post a tweet
 *
 * Creates a new tweet on the authenticated user's timeline using the
 * Twitter API v2. Text is limited to 280 characters.
 * Requires a Twitter OAuth2 credential with tweet.write scope.
 */

import { defineAction } from '@flowlib/action-kit';
import { TWITTER_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const TWITTER_API = 'https://api.twitter.com/2';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Twitter credential is required'),
  text: z
    .string()
    .min(1, 'Tweet text is required')
    .max(280, 'Tweet text must be 280 characters or fewer'),
});

export const twitterCreateTweetAction = defineAction({
  id: 'twitter.create_tweet',
  name: 'Create Tweet',
  description:
    "Post a new tweet to the authenticated user's timeline (POST /2/tweets). Use when the user wants to publish a tweet or status update on X/Twitter. Text is limited to 280 characters.\n\n" +
    'Example response:\n' +
    '```json\n' +
    '{"data": {"id": "1346889436626259968", "text": "Hello world!"}}\n' +
    '```',
  provider: TWITTER_PROVIDER,
  actionCategory: 'write',

  credential: {
    required: true,
    type: 'oauth2',
    oauth2Provider: 'twitter',
    requiredScopes: ['tweet.write', 'users.read', 'offline.access'],
    description: 'Twitter OAuth2 credential with tweet.write scope',
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
        name: 'text',
        label: 'Tweet Text',
        type: 'textarea',
        required: true,
        placeholder: 'What is happening?!',
        description: 'The text content of the tweet (max 280 characters)',
        aiProvided: true,
      },
    ],
  },

  tags: ['twitter', 'x', 'tweet', 'post', 'social-media', 'oauth2'],

  async execute(params, context) {
    const { credentialId, text } = params;

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

    context.logger.debug('Creating tweet', { textLength: text.length });

    try {
      const response = await fetch(`${TWITTER_API}/tweets`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        return {
          success: false,
          error: `Twitter API error (${response.status}): ${errorBody}`,
        };
      }

      const data = (await response.json()) as {
        data?: { id: string; text: string };
      };

      return {
        success: true,
        output: data.data,
        metadata: {
          tweetId: data.data?.id,
          createdAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Twitter create tweet failed: ${msg}` };
    }
  },
});
