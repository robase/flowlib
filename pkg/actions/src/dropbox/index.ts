/**
 * Dropbox provider barrel export.
 */

export { dropboxListFolderAction } from './list-folder';
export { dropboxGetMetadataAction } from './get-metadata';
export { dropboxCreateFolderAction } from './create-folder';
export { dropboxSearchAction } from './search';
export { dropboxDeleteAction } from './delete';

import type { ActionDefinition } from '@flowlib/action-kit';
import { dropboxListFolderAction } from './list-folder';
import { dropboxGetMetadataAction } from './get-metadata';
import { dropboxCreateFolderAction } from './create-folder';
import { dropboxSearchAction } from './search';
import { dropboxDeleteAction } from './delete';

/** All Dropbox actions as an array (for bulk registration). */
export const dropboxActions: ActionDefinition[] = [
  dropboxListFolderAction,
  dropboxGetMetadataAction,
  dropboxCreateFolderAction,
  dropboxSearchAction,
  dropboxDeleteAction,
];
