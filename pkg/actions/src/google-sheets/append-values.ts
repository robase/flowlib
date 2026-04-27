/**
 * google_sheets.append_values — Append rows to a Google Sheets spreadsheet
 *
 * Appends rows of data after the last row of data in a range.
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
  insertDataOption: z.enum(['OVERWRITE', 'INSERT_ROWS']).optional().default('INSERT_ROWS'),
});

export const googleSheetsAppendValuesAction = defineAction({
  id: 'google_sheets.append_values',
  name: 'Append Values',
  description:
    'Append rows after the last row in a Google Sheets range (spreadsheets.values.append). Use when the user wants to add new records to a table or log data.\n\n' +
    'Call with `spreadsheetId`, `range` (A1 notation, e.g. "Sheet1!A:D"), and `values` (2D JSON array, e.g. [["Alice", 30]]). Optionally set `valueInputOption` (USER_ENTERED or RAW) and `insertDataOption` (INSERT_ROWS or OVERWRITE).\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"updatedRange": "Sheet1!A4:C4", "updatedRows": 1, "updatedColumns": 3, "updatedCells": 3}\n' +
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
        description: 'The ID of the Google Sheets spreadsheet',
        aiProvided: true,
      },
      {
        name: 'range',
        label: 'Range',
        type: 'text',
        required: true,
        placeholder: 'Sheet1!A:D',
        description: "The A1 notation range to append to (e.g. 'Sheet1!A:D')",
        aiProvided: true,
      },
      {
        name: 'values',
        label: 'Values',
        type: 'json',
        required: true,
        placeholder: '[["Alice", 30, "alice@example.com"]]',
        description: '2D array of rows to append (JSON format)',
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
      {
        name: 'insertDataOption',
        label: 'Insert Mode',
        type: 'select',
        defaultValue: 'INSERT_ROWS',
        options: [
          { label: 'Insert Rows', value: 'INSERT_ROWS' },
          { label: 'Overwrite', value: 'OVERWRITE' },
        ],
        description: 'Whether to insert new rows or overwrite existing data',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['google', 'sheets', 'spreadsheet', 'append', 'write', 'values', 'oauth2'],

  async execute(params, context) {
    const { credentialId, spreadsheetId, range, values, valueInputOption, insertDataOption } =
      params;

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

    context.logger.debug('Appending to Google Sheets', {
      spreadsheetId,
      range,
      rowCount: values.length,
    });

    try {
      const url = new URL(
        `${SHEETS_API_BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}:append`,
      );
      url.searchParams.set('valueInputOption', valueInputOption);
      url.searchParams.set('insertDataOption', insertDataOption);

      const response = await fetch(url.toString(), {
        method: 'POST',
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
        updates?: {
          updatedRange?: string;
          updatedRows?: number;
          updatedColumns?: number;
          updatedCells?: number;
        };
      };

      return {
        success: true,
        output: {
          spreadsheetId,
          updatedRange: result.updates?.updatedRange,
          updatedRows: result.updates?.updatedRows,
          updatedColumns: result.updates?.updatedColumns,
          updatedCells: result.updates?.updatedCells,
        },
        metadata: { appendedRows: result.updates?.updatedRows },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Google Sheets operation failed: ${msg}` };
    }
  },
});
