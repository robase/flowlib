/**
 * Core actions barrel export.
 *
 * Import this module to register all core actions in the ActionRegistry.
 */

export { javascriptAction } from './javascript';
export { templateStringAction } from './template-string';
export { outputAction } from './output';
export { ifElseAction } from './if-else';
export { switchAction } from './switch';
export { modelAction } from './model';
export { agentAction, agentNodeParamsSchema, type AgentNodeParams } from './agent';
export { mathEvalAction } from './math-eval';

import type { ActionDefinition } from '@flowlib/action-kit';
import { javascriptAction } from './javascript';
import { templateStringAction } from './template-string';
import { outputAction } from './output';
import { ifElseAction } from './if-else';
import { switchAction } from './switch';
import { modelAction } from './model';
import { agentAction } from './agent';
import { mathEvalAction } from './math-eval';

// Lazy descriptors live in `./lazy` and are re-exported from the package
// root (`@flowlib/actions/core/lazy`). Re-exporting them here would defeat
// the dynamic-import chunking — consumers of the eager barrel statically
// import every action module, so the bundler can no longer split them.

/** All core actions as an array (for bulk registration). */
export const coreActions: ActionDefinition[] = [
  javascriptAction,
  templateStringAction,
  outputAction,
  ifElseAction,
  switchAction,
  modelAction,
  agentAction,
  mathEvalAction,
];
