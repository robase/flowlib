/**
 * google_docs.create_document — Create a new Google Docs document
 *
 * Creates a new document in Google Docs with optional initial content.
 * Requires a Google Docs OAuth2 credential.
 */

import { defineAction } from '@flowlib/action-kit';
import { GOOGLE_DOCS_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const DOCS_API_BASE = 'https://docs.googleapis.com/v1/documents';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Google Docs credential is required'),
  title: z.string().min(1, 'Document title is required'),
  body: z.string().optional().default(''),
});

export const googleDocsCreateDocumentAction = defineAction({
  id: 'google_docs.create_document',
  name: 'Create Document',
  description:
    'Create a new Google Docs document (documents.create + documents.batchUpdate). Call with `title` and an optional `body` for initial text content. Use when the user wants to create a new doc.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"documentId": "1abc...", "title": "My Doc", "url": "https://docs.google.com/document/d/1abc.../edit"}\n' +
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
        name: 'title',
        label: 'Title',
        type: 'text',
        required: true,
        placeholder: 'My Document',
        description: 'Title of the new document',
        aiProvided: true,
      },
      {
        name: 'body',
        label: 'Initial Content',
        type: 'textarea',
        placeholder: 'Enter initial text content...',
        description: 'Optional text content to insert into the document',
        aiProvided: true,
      },
    ],
  },

  tags: ['google', 'docs', 'document', 'create', 'oauth2'],

  async execute(params, context) {
    const { credentialId, title, body } = params;

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

    context.logger.debug('Creating Google Doc', { title, hasBody: !!body });

    try {
      // Step 1: Create the document
      const createResponse = await fetch(DOCS_API_BASE, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title }),
      });

      if (!createResponse.ok) {
        const errorText = await createResponse.text();
        return {
          success: false,
          error: `Google Docs API error (${createResponse.status}): ${errorText}`,
        };
      }

      const doc = (await createResponse.json()) as { documentId: string; title: string };

      // Step 2: Insert text if provided
      if (body?.trim()) {
        const updateResponse = await fetch(`${DOCS_API_BASE}/${doc.documentId}:batchUpdate`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            requests: [
              {
                insertText: {
                  location: { index: 1 },
                  text: body,
                },
              },
            ],
          }),
        });

        if (!updateResponse.ok) {
          const errorText = await updateResponse.text();
          context.logger.warn('Failed to insert initial content', { error: errorText });
        }
      }

      return {
        success: true,
        output: {
          documentId: doc.documentId,
          title: doc.title,
          url: `https://docs.google.com/document/d/${doc.documentId}/edit`,
        },
        metadata: { documentId: doc.documentId },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Google Docs operation failed: ${msg}` };
    }
  },
});
