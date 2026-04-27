/**
 * google_sheets.clear_values — Clear cell values in a Google Sheets spreadsheet
 *
 * Clears all values in a specified range without removing formatting.
 * Requires a Google Sheets OAuth2 credential.
 */

import { defineAction } from '@flowlib/action-kit';
import { GOOGLE_SHEETS_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Google Sheets credential is required'),
  spreadsheetId: z.string().min(1, 'Spreadsheet ID is required'),
  range: z.string().min(1, 'Range is required'),
});

export const googleSheetsClearValuesAction = defineAction({
  id: 'google_sheets.clear_values',
  name: 'Clear Values',
  description:
    'Clear all cell values in a range of a Google Sheets spreadsheet (spreadsheets.values.clear). Use when the user wants to erase data while keeping formatting and data validation intact.\n\n' +
    'Call with `spreadsheetId` and `range` (A1 notation, e.g. "Sheet1!A1:D10"). Only values are cleared; formatting, conditional formatting, and data validation are preserved.\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"spreadsheetId": "1abc...", "clearedRange": "Sheet1!A1:D10"}\n' +
    '```',
  provider: GOOGLE_SHEETS_PROVIDER,
  actionCategory: 'delete',

  credential: {
    required: true,
    type: 'oauth2',
    oauth2Provider: 'google',
    requiredScopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.file',
    ],
    description: 'Google Sheets OAuth2 credential',
  },

  params: {
    schema: paramsSchema,
    fields: [
      {
        name: 'credentialId',
        label: 'Google Sheets Credential',
        type: 'text',
        required: true,
        description: 'Google Sheets OAuth2 credential for authentication',
        aiProvided: false,
      },
      {
        name: 'spreadsheetId',
        label: 'Spreadsheet ID',
        type: 'text',
        required: true,
        placeholder: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms',
        description: 'The ID of the Google Sheets spreadsheet',
        aiProvided: true,
      },
      {
        name: 'range',
        label: 'Range',
        type: 'text',
        required: true,
        placeholder: 'Sheet1!A1:D10',
        description: 'The A1 notation range to clear',
        aiProvided: true,
      },
    ],
  },

  tags: ['google', 'sheets', 'spreadsheet', 'clear', 'delete', 'oauth2'],

  async execute(params, context) {
    const { credentialId, spreadsheetId, range } = params;

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

    context.logger.debug('Clearing Google Sheets values', { spreadsheetId, range });

    try {
      const response = await fetch(
        `${SHEETS_API_BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}:clear`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Google Sheets API error: ${response.status} - ${errorText}`,
        };
      }

      const result = (await response.json()) as { clearedRange?: string };

      return {
        success: true,
        output: {
          spreadsheetId,
          clearedRange: result.clearedRange,
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Google Sheets operation failed: ${msg}` };
    }
  },
});
