/**
 * Asana provider barrel export.
 */

export { asanaListWorkspacesAction } from './list-workspaces';
export { asanaListProjectsAction } from './list-projects';
export { asanaListTasksAction } from './list-tasks';
export { asanaGetTaskAction } from './get-task';
export { asanaCreateTaskAction } from './create-task';
export { asanaUpdateTaskAction } from './update-task';

import type { ActionDefinition } from '@flowlib/action-kit';
import { asanaListWorkspacesAction } from './list-workspaces';
import { asanaListProjectsAction } from './list-projects';
import { asanaListTasksAction } from './list-tasks';
import { asanaGetTaskAction } from './get-task';
import { asanaCreateTaskAction } from './create-task';
import { asanaUpdateTaskAction } from './update-task';

/** All Asana actions as an array (for bulk registration). */
export const asanaActions: ActionDefinition[] = [
  asanaListWorkspacesAction,
  asanaListProjectsAction,
  asanaListTasksAction,
  asanaGetTaskAction,
  asanaCreateTaskAction,
  asanaUpdateTaskAction,
];
