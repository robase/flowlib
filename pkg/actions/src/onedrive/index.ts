/**
 * OneDrive provider barrel export.
 */

export { onedriveListFilesAction } from './list-files';
export { onedriveGetItemAction } from './get-item';
export { onedriveSearchAction } from './search';
export { onedriveCreateFolderAction } from './create-folder';
export { onedriveDeleteItemAction } from './delete-item';

import type { ActionDefinition } from '@flowlib/action-kit';
import { onedriveListFilesAction } from './list-files';
import { onedriveGetItemAction } from './get-item';
import { onedriveSearchAction } from './search';
import { onedriveCreateFolderAction } from './create-folder';
import { onedriveDeleteItemAction } from './delete-item';

/** All OneDrive actions as an array (for bulk registration). */
export const onedriveActions: ActionDefinition[] = [
  onedriveListFilesAction,
  onedriveGetItemAction,
  onedriveSearchAction,
  onedriveCreateFolderAction,
  onedriveDeleteItemAction,
];
