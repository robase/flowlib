/**
 * facebook.list_pages — List pages managed by the authenticated user
 *
 * Retrieves the Facebook pages that the authenticated user manages,
 * including each page's access token for posting.
 */

import { defineAction } from '@flowlib/action-kit';
import { FACEBOOK_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const FACEBOOK_API = 'https://graph.facebook.com/v21.0';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Facebook credential is required'),
});

export const facebookListPagesAction = defineAction({
  id: 'facebook.list_pages',
  name: 'List Pages',
  description:
    'List Facebook pages managed by the authenticated user (GET /me/accounts). Use when the user needs to find which pages they can post to or manage.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"data": [{"id": "123456789", "name": "My Page", "category": "Business", "fan_count": 1500}]}\n' +
    '```',
  actionCategory: 'read',
  provider: FACEBOOK_PROVIDER,

  credential: {
    required: true,
    type: 'oauth2',
    oauth2Provider: 'facebook',
    requiredScopes: ['pages_show_list'],
    description: 'Facebook OAuth2 credential with pages_show_list scope',
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

  tags: ['facebook', 'pages', 'list', 'oauth2'],

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

    context.logger.debug('Fetching Facebook pages');

    try {
      const response = await fetch(
        `${FACEBOOK_API}/me/accounts?fields=id,name,category,access_token,fan_count`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      );

      const data = (await response.json()) as {
        data?: Array<{
          id: string;
          name: string;
          category: string;
          access_token: string;
          fan_count: number;
        }>;
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
          pages: data.data ?? [],
          count: data.data?.length ?? 0,
        },
      };
    } catch (err) {
      return {
        success: false,
        error: `Failed to fetch Facebook pages: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});
