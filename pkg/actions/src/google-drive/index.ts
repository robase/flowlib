/**
 * Google Drive provider barrel export.
 */

export { googleDriveListFilesAction } from './list-files';
export { googleDriveGetFileAction } from './get-file';
export { googleDriveCreateFileAction } from './create-file';
export { googleDriveDeleteFileAction } from './delete-file';
export { googleDriveCreateFolderAction } from './create-folder';
export { googleDriveSearchFilesAction } from './search-files';
export { googleDriveShareFileAction } from './share-file';

import type { ActionDefinition } from '@flowlib/action-kit';
import { googleDriveListFilesAction } from './list-files';
import { googleDriveGetFileAction } from './get-file';
import { googleDriveCreateFileAction } from './create-file';
import { googleDriveDeleteFileAction } from './delete-file';
import { googleDriveCreateFolderAction } from './create-folder';
import { googleDriveSearchFilesAction } from './search-files';
import { googleDriveShareFileAction } from './share-file';

/** All Google Drive actions as an array (for bulk registration). */
export const googleDriveActions: ActionDefinition[] = [
  googleDriveListFilesAction,
  googleDriveGetFileAction,
  googleDriveCreateFileAction,
  googleDriveDeleteFileAction,
  googleDriveCreateFolderAction,
  googleDriveSearchFilesAction,
  googleDriveShareFileAction,
];
