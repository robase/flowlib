/**
 * google_sheets.create_spreadsheet — Create a new Google Sheets spreadsheet
 *
 * Creates a new spreadsheet in Google Sheets with optional sheet titles.
 * Requires a Google Sheets OAuth2 credential.
 */

import { defineAction } from '@flowlib/action-kit';
import { GOOGLE_SHEETS_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

const paramsSchema = z.object({
  credentialId: z.string().min(1, 'Google Sheets credential is required'),
  title: z.string().min(1, 'Spreadsheet title is required'),
  sheetTitles: z.array(z.string()).optional().default([]),
});

export const googleSheetsCreateSpreadsheetAction = defineAction({
  id: 'google_sheets.create_spreadsheet',
  name: 'Create Spreadsheet',
  description:
    'Create a new Google Sheets spreadsheet (spreadsheets.create). Use when the user wants to create a fresh spreadsheet, optionally with named sheet tabs.\n\n' +
    'Call with `title` (spreadsheet name). Optionally pass `sheetTitles` (JSON array of tab names, e.g. ["Sheet1", "Data", "Summary"]).\n\n' +
    'Example response:\n' +
    '```json\n' +
    '{"spreadsheetId": "1abc...", "title": "My Sheet", "url": "https://docs.google.com/spreadsheets/d/1abc...", "sheets": [{"sheetId": 0, "title": "Sheet1"}]}\n' +
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
        name: 'title',
        label: 'Title',
        type: 'text',
        required: true,
        placeholder: 'My Spreadsheet',
        description: 'Title of the new spreadsheet',
        aiProvided: true,
      },
      {
        name: 'sheetTitles',
        label: 'Sheet Names',
        type: 'json',
        defaultValue: [],
        placeholder: '["Sheet1", "Data", "Summary"]',
        description: 'Optional JSON array of sheet tab names to create',
        extended: true,
        aiProvided: true,
      },
    ],
  },

  tags: ['google', 'sheets', 'spreadsheet', 'create', 'oauth2'],

  async execute(params, context) {
    const { credentialId, title, sheetTitles } = params;

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

    context.logger.debug('Creating Google Sheets spreadsheet', { title });

    try {
      const sheets =
        sheetTitles && sheetTitles.length > 0
          ? sheetTitles.map((sheetTitle: string) => ({
              properties: { title: sheetTitle },
            }))
          : undefined;

      const response = await fetch(SHEETS_API_BASE, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          properties: { title },
          ...(sheets ? { sheets } : {}),
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
        spreadsheetId?: string;
        properties?: { title?: string };
        spreadsheetUrl?: string;
        sheets?: Array<{ properties?: { sheetId?: number; title?: string } }>;
      };

      return {
        success: true,
        output: {
          spreadsheetId: result.spreadsheetId,
          title: result.properties?.title,
          url: result.spreadsheetUrl,
          sheets: result.sheets?.map((s) => ({
            sheetId: s.properties?.sheetId,
            title: s.properties?.title,
          })),
        },
        metadata: { spreadsheetId: result.spreadsheetId },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Google Sheets operation failed: ${msg}` };
    }
  },
});
