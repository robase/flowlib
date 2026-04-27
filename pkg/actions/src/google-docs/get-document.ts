/**
 * google_docs.get_document — Retrieve a Google Docs document
 *
 * Fetches document metadata and optionally text content from Google Docs.
 * Requires a Google Docs OAuth2 credential.
 */

import { defineAction } from '@flowlib/action-kit';
import { GOOGLE_DOCS_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const DOCS_API_BASE = 'https://docs.googleapis.com/v1/documents';

function extractTextFromBody(body: unknown): string {
  if (!body || typeof body !== 'object') {
    return '';
  }
  const content = (body as Record<string, unknown>).content;
  if (!Array.isArray(content)) {
    return '';
  }
  let text = '';
  for (const element of content) {
    if (element?.paragraph?.elements) {
      for (const el of element.paragraph.elements) {
        if (el?.textRun?.content) {
          text += el.textRun.content;
        }
      }
    }
  }
  return text;
}

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Google Docs credential is required'),
  documentId: z.string().min(1, 'Document ID is required'),
});

export const googleDocsGetDocumentAction = defineAction({
  id: 'google_docs.get_document',
  name: 'Get Document',
  description:
    'Retrieve a Google Docs document (documents.get). Call with `documentId` to fetch the document title, full plain-text content, and revision info. Use when the user wants to read or extract text from a Google Doc.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"documentId": "1abc...", "title": "My Doc", "textContent": "...", "revisionId": "ALm3..."}\n' +
    '```',
  provider: GOOGLE_DOCS_PROVIDER,
  actionCategory: 'read',

  credential: {
    required: true,
    type: 'oauth2',
    oauth2Provider: 'google',
    requiredScopes: [
      'https://www.googleapis.com/auth/documents.readonly',
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
        description: 'The ID of the Google Docs document to retrieve',
        aiProvided: true,
      },
    ],
  },

  tags: ['google', 'docs', 'document', 'read', 'oauth2'],

  async execute(params, context) {
    const { credentialId, documentId } = params;

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

    context.logger.debug('Fetching Google Doc', { documentId });

    try {
      const response = await fetch(`${DOCS_API_BASE}/${documentId}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Google Docs API error (${response.status}): ${errorText}`,
        };
      }

      const doc = (await response.json()) as Record<string, unknown>;
      const textContent = extractTextFromBody(doc.body);

      return {
        success: true,
        output: {
          documentId: doc.documentId,
          title: doc.title,
          textContent,
          url: `https://docs.google.com/document/d/${documentId}/edit`,
          revisionId: doc.revisionId,
        },
        metadata: { documentId, characterCount: textContent.length },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Google Docs operation failed: ${msg}` };
    }
  },
});
