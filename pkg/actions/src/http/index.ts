/**
 * HTTP provider barrel export.
 */

export { httpRequestAction } from './request';

import type { ActionDefinition } from '@flowlib/action-kit';
import { httpRequestAction } from './request';

// Lazy descriptors live in `./lazy` and are re-exported from the package
// root (`@flowlib/actions/http/lazy`). Re-exporting them here would defeat
// dynamic-import chunking — see `core/index.ts` for the same rationale.

/** All HTTP actions as an array (for bulk registration). */
export const httpActions: ActionDefinition[] = [httpRequestAction];
