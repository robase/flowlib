/**
 * google_docs.replace_text — Find and replace text in a Google Docs document
 *
 * Replaces all occurrences of a text string in the document.
 * Requires a Google Docs OAuth2 credential.
 */

import { defineAction } from '@flowlib/action-kit';
import { GOOGLE_DOCS_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const DOCS_API_BASE = 'https://docs.googleapis.com/v1/documents';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Google Docs credential is required'),
  documentId: z.string().min(1, 'Document ID is required'),
  findText: z.string().min(1, 'Find text is required'),
  replaceText: z.string(),
  matchCase: z.boolean().optional().default(false),
});

export const googleDocsReplaceTextAction = defineAction({
  id: 'google_docs.replace_text',
  name: 'Replace Text',
  description:
    'Find and replace text in a Google Docs document (documents.batchUpdate with replaceAllText). Call with `documentId`, `findText`, and `replaceText`; optional `matchCase` for case-sensitive search. Replaces all occurrences in the document.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"documentId": "1abc...", "findText": "old", "replaceText": "new", "occurrencesChanged": 3}\n' +
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
        description: 'The ID of the Google Docs document to find and replace text in',
        aiProvided: true,
      },
      {
        name: 'findText',
        label: 'Find Text',
        type: 'text',
        required: true,
        placeholder: 'old text',
        description: 'The text to search for',
        aiProvided: true,
      },
      {
        name: 'replaceText',
        label: 'Replace With',
        type: 'text',
        required: true,
        placeholder: 'new text',
        description: 'The replacement text',
        aiProvided: true,
      },
      {
        name: 'matchCase',
        label: 'Match Case',
        type: 'boolean',
        defaultValue: false,
        description: 'Whether the search should be case-sensitive',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['google', 'docs', 'document', 'replace', 'find', 'text', 'oauth2'],

  async execute(params, context) {
    const { credentialId, documentId, findText, replaceText, matchCase } = params;

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

    context.logger.debug('Replacing text in Google Doc', { documentId, findText, matchCase });

    try {
      const response = await fetch(`${DOCS_API_BASE}/${documentId}:batchUpdate`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requests: [
            {
              replaceAllText: {
                containsText: {
                  text: findText,
                  matchCase,
                },
                replaceText,
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

      const result = (await response.json()) as {
        replies?: Array<{ replaceAllText?: { occurrencesChanged?: number } }>;
      };
      const occurrences = result.replies?.[0]?.replaceAllText?.occurrencesChanged ?? 0;

      return {
        success: true,
        output: {
          documentId,
          findText,
          replaceText,
          occurrencesChanged: occurrences,
          url: `https://docs.google.com/document/d/${documentId}/edit`,
        },
        metadata: { occurrencesChanged: occurrences },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Google Docs operation failed: ${msg}` };
    }
  },
});
