/**
 * HTTP provider barrel export.
 */

export { httpRequestAction } from './request';

import type { ActionDefinition } from '@flowlib/action-kit';
import { httpRequestAction } from './request';

// Lazy descriptors (edge-runtime bundle size — see ../LAZY_ACTIONS_MIGRATION.md)
export { lazyHttpActions } from './lazy';

/** All HTTP actions as an array (for bulk registration). */
export const httpActions: ActionDefinition[] = [httpRequestAction];
