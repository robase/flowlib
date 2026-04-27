/**
 * google_sheets.get_values — Read values from a Google Sheets spreadsheet
 *
 * Retrieves cell values from a specified range in a spreadsheet.
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
  majorDimension: z.enum(['ROWS', 'COLUMNS']).optional().default('ROWS'),
  valueRenderOption: z
    .enum(['FORMATTED_VALUE', 'UNFORMATTED_VALUE', 'FORMULA'])
    .optional()
    .default('FORMATTED_VALUE'),
});

export const googleSheetsGetValuesAction = defineAction({
  id: 'google_sheets.get_values',
  name: 'Get Values',
  description:
    'Read values from a range in a Google Sheets spreadsheet (spreadsheets.values.get). Use when the user wants to retrieve cell data from a specific sheet range.\n\n' +
    'Call with `spreadsheetId` and `range` (A1 notation, e.g. "Sheet1!A1:D10"). Optionally set `majorDimension` (ROWS or COLUMNS) and `valueRenderOption` (FORMATTED_VALUE, UNFORMATTED_VALUE, or FORMULA).\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"range": "Sheet1!A1:D3", "values": [["Name", "Age"], ["Alice", 30]], "rowCount": 2, "columnCount": 2}\n' +
    '```',
  provider: GOOGLE_SHEETS_PROVIDER,
  actionCategory: 'read',

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
        description: "The A1 notation range to read (e.g. 'Sheet1!A1:D10')",
        aiProvided: true,
      },
      {
        name: 'majorDimension',
        label: 'Major Dimension',
        type: 'select',
        defaultValue: 'ROWS',
        options: [
          { label: 'Rows', value: 'ROWS' },
          { label: 'Columns', value: 'COLUMNS' },
        ],
        description: 'Whether to return data by rows or columns',
        extended: true,
        aiProvided: true,
      },
      {
        name: 'valueRenderOption',
        label: 'Value Render',
        type: 'select',
        defaultValue: 'FORMATTED_VALUE',
        options: [
          { label: 'Formatted', value: 'FORMATTED_VALUE' },
          { label: 'Unformatted', value: 'UNFORMATTED_VALUE' },
          { label: 'Formula', value: 'FORMULA' },
        ],
        description: 'How values should be rendered',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['google', 'sheets', 'spreadsheet', 'read', 'values', 'oauth2'],

  async execute(params, context) {
    const { credentialId, spreadsheetId, range, majorDimension, valueRenderOption } = params;

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

    context.logger.debug('Reading Google Sheets values', { spreadsheetId, range });

    try {
      const url = new URL(
        `${SHEETS_API_BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}`,
      );
      url.searchParams.set('majorDimension', majorDimension);
      url.searchParams.set('valueRenderOption', valueRenderOption);

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Google Sheets API error: ${response.status} - ${errorText}`,
        };
      }

      const data = (await response.json()) as {
        range?: string;
        majorDimension?: string;
        values?: unknown[][];
      };

      return {
        success: true,
        output: {
          range: data.range,
          majorDimension: data.majorDimension,
          values: data.values ?? [],
          rowCount: data.values?.length ?? 0,
          columnCount: data.values?.[0] ? (data.values[0] as unknown[]).length : 0,
        },
        metadata: {
          rowCount: data.values?.length ?? 0,
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Google Sheets operation failed: ${msg}` };
    }
  },
});
