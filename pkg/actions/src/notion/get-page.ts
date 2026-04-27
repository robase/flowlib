/**
 * notion.get_page — Retrieve a Notion page
 *
 * Retrieves a page object by ID including its properties, parent, icon, and cover.
 * Page content (blocks) is not included — use the block children API for that.
 * Requires a Notion OAuth2 credential.
 */

import { defineAction } from '@flowlib/action-kit';
import { NOTION_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const NOTION_API_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Notion credential is required'),
  pageId: z.string().min(1, 'Page ID is required'),
});

export const notionGetPageAction = defineAction({
  id: 'notion.get_page',
  name: 'Get Page',
  description:
    "Retrieve a Notion page by ID (GET /v1/pages/{page_id}). Use when the user wants to inspect a specific page's properties, parent, or metadata. " +
    'Call with `pageId` (UUID, dashes optional). Returns properties, icon, cover, parent, and timestamps — but not page content blocks (use notion.get_block_children for that).\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"id": "page-uuid", "object": "page", "url": "https://notion.so/...", "properties": {"Name": {"title": [{"plain_text": "My Page"}]}}, "parent": {"type": "workspace", "workspace": true}, "created_time": "2025-01-15T10:00:00Z"}\n' +
    '```',
  provider: NOTION_PROVIDER,
  actionCategory: 'read',
  tags: ['notion', 'page', 'get', 'retrieve', 'read', 'properties', 'oauth2'],

  credential: {
    required: true,
    type: 'oauth2',
    oauth2Provider: 'notion',
    description: 'Notion OAuth2 credential',
  },

  params: {
    schema: paramsSchema,
    fields: [
      {
        name: 'credentialId',
        label: 'Notion Credential',
        type: 'text',
        required: true,
        description: 'Notion OAuth2 credential for authentication',
        aiProvided: false,
      },
      {
        name: 'pageId',
        label: 'Page ID',
        type: 'text',
        required: true,
        placeholder: 'b55c9c91-384d-452b-81db-d1ef79372b75',
        description: 'The UUID of the Notion page to retrieve. Dashes are optional.',
        aiProvided: true,
      },
    ],
  },

  async execute(params, context) {
    const { credentialId, pageId } = params;

    let credential = context.credential;
    if (!credential && context.functions?.getCredential) {
      credential = await context.functions.getCredential(credentialId);
    }
    if (!credential) {
      return {
        success: false,
        error: `Credential not found: ${credentialId}. Please create a Notion OAuth2 credential.`,
      };
    }

    const accessToken =
      (credential.config?.accessToken as string) ?? (credential.config?.token as string);
    if (!accessToken) {
      return {
        success: false,
        error: 'No valid access token in credential. Please re-authorize the Notion credential.',
      };
    }

    context.logger.debug('Retrieving Notion page', { pageId });

    try {
      const response = await fetch(`${NOTION_API_BASE}/pages/${encodeURIComponent(pageId)}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Notion-Version': NOTION_VERSION,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Notion API error (${response.status}): ${errorText}`,
        };
      }

      const page = (await response.json()) as {
        id: string;
        object: string;
        created_time: string;
        last_edited_time: string;
        url: string;
        public_url: string | null;
        in_trash: boolean;
        archived: boolean;
        parent: Record<string, unknown>;
        properties: Record<string, unknown>;
        icon: { type: string; emoji?: string } | null;
        cover: { type: string; file?: { url: string } } | null;
      };

      return {
        success: true,
        output: {
          id: page.id,
          object: page.object,
          url: page.url,
          public_url: page.public_url,
          created_time: page.created_time,
          last_edited_time: page.last_edited_time,
          in_trash: page.in_trash,
          archived: page.archived,
          parent: page.parent,
          properties: page.properties,
          icon: page.icon,
          cover: page.cover,
        },
        metadata: { pageId: page.id, url: page.url },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Notion get page failed: ${msg}` };
    }
  },
});
