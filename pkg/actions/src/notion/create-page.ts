/**
 * notion.create_page — Create a new page in Notion
 *
 * Creates a page as a child of an existing page or database.
 * Supports setting title, properties, and optional markdown content.
 * Requires a Notion OAuth2 credential with insert content capabilities.
 */

import { defineAction } from '@flowlib/action-kit';
import { NOTION_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const NOTION_API_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Notion credential is required'),
  parentType: z.enum(['page_id', 'database_id']).default('page_id'),
  parentId: z.string().min(1, 'Parent ID is required'),
  title: z.string().min(1, 'Page title is required'),
  content: z.string().optional().default(''),
  properties: z.string().optional().default(''),
  icon: z.string().optional().default(''),
});

export const notionCreatePageAction = defineAction({
  id: 'notion.create_page',
  name: 'Create Page',
  description:
    'Create a new page in Notion (POST /v1/pages). Use when the user wants to add a new page under an existing page or database. ' +
    'Call with `parentType` ("page_id" or "database_id"), `parentId` (UUID), and `title`. Optionally pass `content` as plain text (added as a single paragraph block), ' +
    '`properties` as JSON for database-parent pages, and an `icon` emoji.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"id": "new-page-uuid", "object": "page", "url": "https://notion.so/...", "created_time": "2025-04-07T10:00:00Z", "parent": {"page_id": "parent-uuid"}}\n' +
    '```',
  provider: NOTION_PROVIDER,
  actionCategory: 'write',
  tags: ['notion', 'page', 'create', 'add', 'write', 'new', 'oauth2'],

  credential: {
    required: true,
    type: 'oauth2',
    oauth2Provider: 'notion',
    description: 'Notion OAuth2 credential with insert content capabilities',
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
        name: 'parentType',
        label: 'Parent Type',
        type: 'select',
        required: true,
        defaultValue: 'page_id',
        options: [
          { label: 'Page', value: 'page_id' },
          { label: 'Database', value: 'database_id' },
        ],
        description: 'Whether the parent is a page or a database.',
        aiProvided: true,
      },
      {
        name: 'parentId',
        label: 'Parent ID',
        type: 'text',
        required: true,
        placeholder: 'b55c9c91-384d-452b-81db-d1ef79372b75',
        description: 'UUID of the parent page or database.',
        aiProvided: true,
      },
      {
        name: 'title',
        label: 'Title',
        type: 'text',
        required: true,
        placeholder: 'Meeting Notes — April 2025',
        description: 'Title for the new page.',
        aiProvided: true,
      },
      {
        name: 'content',
        label: 'Content (Markdown)',
        type: 'textarea',
        placeholder: '# Heading\n\nParagraph text here...',
        description:
          'Optional plain-text content for the page body. Added as a single paragraph block. For richer content (headings, lists, etc.), use notion.append_block_children after creation.',

        extended: true,
        aiProvided: true,
      },
      {
        name: 'properties',
        label: 'Properties (JSON)',
        type: 'json',
        placeholder: '{}',
        description:
          'Additional database properties as JSON. Only used when parent is a database. The title property is set automatically.',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'icon',
        label: 'Icon Emoji',
        type: 'text',
        placeholder: '📝',
        description: 'Optional emoji icon for the page.',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  async execute(params, context) {
    const { credentialId, parentType, parentId, title, content, properties, icon } = params;

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

    context.logger.debug('Creating Notion page', { parentType, parentId, title });

    try {
      const body: Record<string, unknown> = {
        parent: { [parentType]: parentId },
        properties: {
          title: {
            title: [{ text: { content: title } }],
          },
        },
      };

      // Merge additional properties for database parents
      if (properties?.trim()) {
        try {
          const extraProps = JSON.parse(properties);
          body.properties = { ...(body.properties as Record<string, unknown>), ...extraProps };
        } catch {
          return { success: false, error: 'Invalid JSON in properties field.' };
        }
      }

      if (icon?.trim()) {
        body.icon = { type: 'emoji', emoji: icon.trim() };
      }

      if (content?.trim()) {
        body.children = [
          {
            object: 'block',
            type: 'paragraph',
            paragraph: {
              rich_text: [{ type: 'text', text: { content } }],
            },
          },
        ];
      }

      const response = await fetch(`${NOTION_API_BASE}/pages`, {
        method: 'POST',
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
        parent: Record<string, unknown>;
      };

      return {
        success: true,
        output: {
          id: page.id,
          object: page.object,
          url: page.url,
          created_time: page.created_time,
          last_edited_time: page.last_edited_time,
          parent: page.parent,
        },
        metadata: { pageId: page.id, url: page.url },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Notion create page failed: ${msg}` };
    }
  },
});
