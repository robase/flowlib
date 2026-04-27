/**
 * google_sheets.update_values — Write values to a Google Sheets spreadsheet
 *
 * Updates cell values in a specified range.
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
  values: z.array(z.array(z.unknown())).min(1, 'Values array is required'),
  valueInputOption: z.enum(['RAW', 'USER_ENTERED']).optional().default('USER_ENTERED'),
});

export const googleSheetsUpdateValuesAction = defineAction({
  id: 'google_sheets.update_values',
  name: 'Update Values',
  description:
    'Write values to a range in a Google Sheets spreadsheet (spreadsheets.values.update). Use when the user wants to overwrite existing cells with new data.\n\n' +
    'Call with `spreadsheetId`, `range` (A1 notation, e.g. "Sheet1!A1:B2"), and `values` (2D JSON array, e.g. [["Name", "Age"], ["Alice", 30]]). Optionally set `valueInputOption` (USER_ENTERED to parse formulas, or RAW for literal values).\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"updatedRange": "Sheet1!A1:B2", "updatedRows": 2, "updatedColumns": 2, "updatedCells": 4}\n' +
    '```',
  provider: GOOGLE_SHEETS_PROVIDER,
  actionCategory: 'write',

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
        description: 'The A1 notation range to write to',
        aiProvided: true,
      },
      {
        name: 'values',
        label: 'Values',
        type: 'json',
        required: true,
        placeholder: '[["Name", "Age"], ["Alice", 30]]',
        description: '2D array of values to write (JSON format)',
        aiProvided: true,
      },
      {
        name: 'valueInputOption',
        label: 'Input Option',
        type: 'select',
        defaultValue: 'USER_ENTERED',
        options: [
          { label: 'User Entered (parse formulas)', value: 'USER_ENTERED' },
          { label: 'Raw (as-is)', value: 'RAW' },
        ],
        description: 'How input data should be interpreted',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['google', 'sheets', 'spreadsheet', 'write', 'update', 'values', 'oauth2'],

  async execute(params, context) {
    const { credentialId, spreadsheetId, range, values, valueInputOption } = params;

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

    context.logger.debug('Updating Google Sheets values', {
      spreadsheetId,
      range,
      rowCount: values.length,
    });

    try {
      const url = new URL(
        `${SHEETS_API_BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}`,
      );
      url.searchParams.set('valueInputOption', valueInputOption);

      const response = await fetch(url.toString(), {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          range,
          majorDimension: 'ROWS',
          values,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Google Sheets API error: ${response.status} - ${errorText}`,
        };
      }

      const result = (await response.json()) as {
        updatedRange?: string;
        updatedRows?: number;
        updatedColumns?: number;
        updatedCells?: number;
      };

      return {
        success: true,
        output: {
          spreadsheetId,
          updatedRange: result.updatedRange,
          updatedRows: result.updatedRows,
          updatedColumns: result.updatedColumns,
          updatedCells: result.updatedCells,
        },
        metadata: { updatedCells: result.updatedCells },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Google Sheets operation failed: ${msg}` };
    }
  },
});
