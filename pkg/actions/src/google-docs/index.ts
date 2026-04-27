/**
 * Google Docs provider barrel export.
 */

export { googleDocsCreateDocumentAction } from './create-document';
export { googleDocsGetDocumentAction } from './get-document';
export { googleDocsInsertTextAction } from './insert-text';
export { googleDocsReplaceTextAction } from './replace-text';
export { googleDocsAppendTextAction } from './append-text';

import type { ActionDefinition } from '@flowlib/action-kit';
import { googleDocsCreateDocumentAction } from './create-document';
import { googleDocsGetDocumentAction } from './get-document';
import { googleDocsInsertTextAction } from './insert-text';
import { googleDocsReplaceTextAction } from './replace-text';
import { googleDocsAppendTextAction } from './append-text';

/** All Google Docs actions as an array (for bulk registration). */
export const googleDocsActions: ActionDefinition[] = [
  googleDocsCreateDocumentAction,
  googleDocsGetDocumentAction,
  googleDocsInsertTextAction,
  googleDocsReplaceTextAction,
  googleDocsAppendTextAction,
];
