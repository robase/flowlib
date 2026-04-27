/**
 * facebook.create_page_post — Create a post on a Facebook page
 *
 * Publishes a new post to a Facebook page using the Graph API.
 * Requires a page access token (obtained from list-pages) or the
 * user access token with pages_manage_posts permission.
 */

import { defineAction } from '@flowlib/action-kit';
import { FACEBOOK_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const FACEBOOK_API = 'https://graph.facebook.com/v21.0';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Facebook credential is required'),
  pageId: z.string().min(1, 'Page ID is required'),
  message: z.string().min(1, 'Message is required'),
  link: z.string().url().optional(),
});

export const facebookCreatePagePostAction = defineAction({
  id: 'facebook.create_page_post',
  name: 'Create Page Post',
  description:
    'Create a new post on a Facebook page (POST /{page-id}/feed). Use when the user wants to publish content to a Facebook page they manage.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"id": "123456789_987654321"}\n' +
    '```',
  provider: FACEBOOK_PROVIDER,
  actionCategory: 'write',

  credential: {
    required: true,
    type: 'oauth2',
    oauth2Provider: 'facebook',
    requiredScopes: ['pages_manage_posts', 'pages_read_engagement', 'pages_show_list'],
    description:
      'Facebook OAuth2 credential with pages_manage_posts, pages_read_engagement, and pages_show_list scopes',
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
        description: 'The ID of the Facebook page to post to',
        aiProvided: true,
      },
      {
        name: 'message',
        label: 'Message',
        type: 'textarea',
        required: true,
        placeholder: 'Check out our latest update!',
        description: 'The text content of the post',
        aiProvided: true,
      },
      {
        name: 'link',
        label: 'Link',
        type: 'text',
        description: 'Optional URL to attach to the post',
        placeholder: 'https://example.com',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['facebook', 'page', 'post', 'create', 'publish', 'oauth2'],

  async execute(params, context) {
    const { credentialId, pageId, message, link } = params;

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

    context.logger.debug('Creating Facebook page post', { pageId });

    try {
      const body: Record<string, string> = { message };
      if (link) {
        body.link = link;
      }

      const response = await fetch(`${FACEBOOK_API}/${pageId}/feed`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const data = (await response.json()) as {
        id?: string;
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
        output: {
          postId: data.id,
          pageId,
          message,
          link: link ?? null,
          createdAt: new Date().toISOString(),
        },
      };
    } catch (err) {
      return {
        success: false,
        error: `Failed to create Facebook page post: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});
