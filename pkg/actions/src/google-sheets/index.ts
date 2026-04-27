/**
 * Google Sheets provider barrel export.
 */

export { googleSheetsGetValuesAction } from './get-values';
export { googleSheetsUpdateValuesAction } from './update-values';
export { googleSheetsAppendValuesAction } from './append-values';
export { googleSheetsClearValuesAction } from './clear-values';
export { googleSheetsCreateSpreadsheetAction } from './create-spreadsheet';

import type { ActionDefinition } from '@flowlib/action-kit';
import { googleSheetsGetValuesAction } from './get-values';
import { googleSheetsUpdateValuesAction } from './update-values';
import { googleSheetsAppendValuesAction } from './append-values';
import { googleSheetsClearValuesAction } from './clear-values';
import { googleSheetsCreateSpreadsheetAction } from './create-spreadsheet';

/** All Google Sheets actions as an array (for bulk registration). */
export const googleSheetsActions: ActionDefinition[] = [
  googleSheetsGetValuesAction,
  googleSheetsUpdateValuesAction,
  googleSheetsAppendValuesAction,
  googleSheetsClearValuesAction,
  googleSheetsCreateSpreadsheetAction,
];
