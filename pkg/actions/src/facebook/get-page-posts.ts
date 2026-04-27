/**
 * facebook.get_page_posts — Get posts from a Facebook page
 *
 * Retrieves recent posts from a Facebook page including message text,
 * timestamps, permalink URLs, share counts, and like summaries.
 */

import { defineAction } from '@flowlib/action-kit';
import { FACEBOOK_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const FACEBOOK_API = 'https://graph.facebook.com/v21.0';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Facebook credential is required'),
  pageId: z.string().min(1, 'Page ID is required'),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
});

export const facebookGetPagePostsAction = defineAction({
  id: 'facebook.get_page_posts',
  name: 'Get Page Posts',
  description:
    'Get recent posts from a Facebook page (GET /{page-id}/posts). Use when the user wants to review content and engagement on a Facebook page.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"data": [{"id": "123_456", "message": "Hello world!", "created_time": "2024-01-01T00:00:00+0000", "likes": {"summary": {"total_count": 42}}}]}\n' +
    '```',
  actionCategory: 'read',
  provider: FACEBOOK_PROVIDER,

  credential: {
    required: true,
    type: 'oauth2',
    oauth2Provider: 'facebook',
    requiredScopes: ['pages_read_engagement', 'pages_read_user_content'],
    description:
      'Facebook OAuth2 credential with pages_read_engagement and pages_read_user_content scopes',
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
      {
        name: 'pageId',
        label: 'Page ID',
        type: 'text',
        required: true,
        placeholder: '123456789012345',
        description: 'The ID of the Facebook page',
        aiProvided: true,
      },
      {
        name: 'limit',
        label: 'Limit',
        type: 'number',
        description: 'Maximum number of posts to return (1-100, default 25)',
        defaultValue: 25,
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['facebook', 'page', 'posts', 'feed', 'engagement', 'oauth2'],

  async execute(params, context) {
    const { credentialId, pageId, limit } = params;

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

    context.logger.debug('Fetching Facebook page posts', { pageId, limit });

    try {
      const fields = 'id,message,created_time,permalink_url,shares,likes.summary(true)';
      const url = `${FACEBOOK_API}/${pageId}/posts?fields=${encodeURIComponent(fields)}&limit=${limit}`;

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      const data = (await response.json()) as {
        data?: Array<{
          id: string;
          message?: string;
          created_time: string;
          permalink_url?: string;
          shares?: { count: number };
          likes?: { summary: { total_count: number } };
        }>;
        paging?: { next?: string };
        error?: { message: string; type: string; code: number };
      };

      if (data.error) {
        return {
          success: false,
          error: `Facebook API error: ${data.error.message}`,
        };
      }

      const posts = (data.data ?? []).map((post) => ({
        id: post.id,
        message: post.message ?? '',
        createdTime: post.created_time,
        permalinkUrl: post.permalink_url ?? null,
        shares: post.shares?.count ?? 0,
        likes: post.likes?.summary?.total_count ?? 0,
      }));

      return {
        success: true,
        output: {
          posts,
          count: posts.length,
          hasMore: !!data.paging?.next,
        },
      };
    } catch (err) {
      return {
        success: false,
        error: `Failed to fetch Facebook page posts: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});
