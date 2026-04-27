/**
 * google_docs.append_text — Append text to the end of a Google Docs document
 *
 * Appends text content at the end of an existing document.
 * Requires a Google Docs OAuth2 credential.
 */

import { defineAction } from '@flowlib/action-kit';
import { GOOGLE_DOCS_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const DOCS_API_BASE = 'https://docs.googleapis.com/v1/documents';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Google Docs credential is required'),
  documentId: z.string().min(1, 'Document ID is required'),
  text: z.string().min(1, 'Text content is required'),
});

export const googleDocsAppendTextAction = defineAction({
  id: 'google_docs.append_text',
  name: 'Append Text',
  description:
    'Append text to the end of a Google Docs document (documents.batchUpdate with insertText). Call with `documentId` and `text` to add content at the end of an existing doc.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"documentId": "1abc...", "appendedAt": 42, "textLength": 156}\n' +
    '```',
  provider: GOOGLE_DOCS_PROVIDER,
  actionCategory: 'write',

  credential: {
    required: true,
    type: 'oauth2',
    oauth2Provider: 'google',
    requiredScopes: [
      'https://www.googleapis.com/auth/documents',
      'https://www.googleapis.com/auth/drive.file',
    ],
    description: 'Google Docs OAuth2 credential',
  },

  params: {
    schema: paramsSchema,
    fields: [
      {
        name: 'credentialId',
        label: 'Google Docs Credential',
        type: 'text',
        required: true,
        description: 'Google Docs OAuth2 credential for authentication',
        aiProvided: false,
      },
      {
        name: 'documentId',
        label: 'Document ID',
        type: 'text',
        required: true,
        placeholder: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms',
        description: 'The ID of the Google Docs document to append text to',
        aiProvided: true,
      },
      {
        name: 'text',
        label: 'Text',
        type: 'textarea',
        required: true,
        placeholder: 'Enter text to append...',
        description: 'The text content to append at the end',
        aiProvided: true,
      },
    ],
  },

  tags: ['google', 'docs', 'document', 'append', 'text', 'write', 'oauth2'],

  async execute(params, context) {
    const { credentialId, documentId, text } = params;

    let credential = context.credential;
    if (!credential && context.functions?.getCredential) {
      credential = await context.functions.getCredential(credentialId);
    }
    if (!credential) {
      return { success: false, error: `Credential not found: ${credentialId}` };
    }

    const accessToken = credential.config?.accessToken as string;
    if (!accessToken) {
      return { success: false, error: 'No valid access token. Please re-authorize.' };
    }

    context.logger.debug('Appending text to Google Doc', { documentId, textLength: text.length });

    try {
      // First, get the document to find the end index
      const docResponse = await fetch(`${DOCS_API_BASE}/${documentId}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      });

      if (!docResponse.ok) {
        const errorText = await docResponse.text();
        return {
          success: false,
          error: `Google Docs API error (${docResponse.status}): ${errorText}`,
        };
      }

      const doc = (await docResponse.json()) as {
        body?: { content?: Array<{ endIndex?: number }> };
      };
      const content = doc.body?.content;
      const endIndex =
        content && content.length > 0 ? (content[content.length - 1].endIndex ?? 1) - 1 : 1;

      // Insert text at the end
      const response = await fetch(`${DOCS_API_BASE}/${documentId}:batchUpdate`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requests: [
            {
              insertText: {
                location: { index: Math.max(1, endIndex) },
                text,
              },
            },
          ],
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Google Docs API error (${response.status}): ${errorText}`,
        };
      }

      return {
        success: true,
        output: {
          documentId,
          appendedAt: endIndex,
          textLength: text.length,
          url: `https://docs.google.com/document/d/${documentId}/edit`,
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Google Docs operation failed: ${msg}` };
    }
  },
});
