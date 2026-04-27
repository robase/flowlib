/**
 * notion.update_page — Update a Notion page
 *
 * Updates a page's properties, icon, cover, archived/trash status, or lock state.
 * Does not update page content blocks — use the block children API for that.
 * Requires a Notion OAuth2 credential with update content capabilities.
 */

import { defineAction } from '@flowlib/action-kit';
import { NOTION_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const NOTION_API_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Notion credential is required'),
  pageId: z.string().min(1, 'Page ID is required'),
  properties: z.string().optional().default(''),
  icon: z.string().optional().default(''),
  archived: z.boolean().optional(),
});

export const notionUpdatePageAction = defineAction({
  id: 'notion.update_page',
  name: 'Update Page',
  description:
    "Update a Notion page's properties or metadata (PATCH /v1/pages/{page_id}). Use when the user wants to rename a page, change its properties, icon, or archive/un-archive it. " +
    "Call with `pageId` and at least one of: `properties` (JSON matching the page's property schema), `icon` (emoji string), or `archived` (boolean). Does not update page content blocks.\n\n" +
    'Example response:\n' +
    '```json\n' +
    '{"id": "page-uuid", "object": "page", "url": "https://notion.so/...", "last_edited_time": "2025-04-07T12:00:00Z", "archived": false}\n' +
    '```',
  provider: NOTION_PROVIDER,
  actionCategory: 'write',
  tags: ['notion', 'page', 'update', 'edit', 'modify', 'properties', 'archive', 'oauth2'],

  credential: {
    required: true,
    type: 'oauth2',
    oauth2Provider: 'notion',
    description: 'Notion OAuth2 credential with update content capabilities',
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
        description: 'The UUID of the Notion page to update.',
        aiProvided: true,
      },
      {
        name: 'properties',
        label: 'Properties (JSON)',
        type: 'json',
        placeholder: '{"Name": {"title": [{"text": {"content": "Updated Title"}}]}}',
        description:
          'Page properties to update as JSON. Format must match the Notion property schema.',
        aiProvided: true,
      },
      {
        name: 'icon',
        label: 'Icon Emoji',
        type: 'text',
        placeholder: '📝',
        description: 'Set a new emoji icon for the page. Leave empty to skip.',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'archived',
        label: 'Archived',
        type: 'boolean',
        description: 'Set to true to archive the page, false to un-archive.',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  async execute(params, context) {
    const { credentialId, pageId, properties, icon, archived } = params;

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

    context.logger.debug('Updating Notion page', { pageId });

    try {
      const body: Record<string, unknown> = {};

      if (properties?.trim()) {
        try {
          body.properties = JSON.parse(properties);
        } catch {
          return { success: false, error: 'Invalid JSON in properties field.' };
        }
      }

      if (icon?.trim()) {
        body.icon = { type: 'emoji', emoji: icon.trim() };
      }

      if (archived !== undefined) {
        body.archived = archived;
      }

      if (Object.keys(body).length === 0) {
        return {
          success: false,
          error: 'No fields to update. Provide properties, icon, or archived status.',
        };
      }

      const response = await fetch(`${NOTION_API_BASE}/pages/${encodeURIComponent(pageId)}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Notion-Version': NOTION_VERSION,
        },
        body: JSON.stringify(body),
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
        url: string;
        created_time: string;
        last_edited_time: string;
        archived: boolean;
        properties: Record<string, unknown>;
        icon: { type: string; emoji?: string } | null;
      };

      return {
        success: true,
        output: {
          id: page.id,
          object: page.object,
          url: page.url,
          last_edited_time: page.last_edited_time,
          archived: page.archived,
          properties: page.properties,
          icon: page.icon,
        },
        metadata: {
          pageId: page.id,
          url: page.url,
          updatedFields: Object.keys(body),
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Notion update page failed: ${msg}` };
    }
  },
});
