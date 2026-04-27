/**
 * Notion provider barrel export.
 *
 * 5 actions covering the most-used Notion API operations:
 * search, page CRUD, and database querying.
 */

// ── Search ──────────────────────────────────────────────────────────────
export { notionSearchAction } from './search';

// ── Pages ───────────────────────────────────────────────────────────────
export { notionGetPageAction } from './get-page';
export { notionCreatePageAction } from './create-page';
export { notionUpdatePageAction } from './update-page';

// ── Databases ───────────────────────────────────────────────────────────
export { notionQueryDatabaseAction } from './query-database';

// ── Bulk array ──────────────────────────────────────────────────────────

import type { ActionDefinition } from '@flowlib/action-kit';

import { notionSearchAction } from './search';
import { notionGetPageAction } from './get-page';
import { notionCreatePageAction } from './create-page';
import { notionUpdatePageAction } from './update-page';
import { notionQueryDatabaseAction } from './query-database';

/** All Notion actions as an array (for bulk registration). */
export const notionActions: ActionDefinition[] = [
  notionSearchAction,
  notionGetPageAction,
  notionCreatePageAction,
  notionUpdatePageAction,
  notionQueryDatabaseAction,
];
