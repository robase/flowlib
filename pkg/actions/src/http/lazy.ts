/**
 * Lazy descriptors for HTTP actions. See `core/lazy.ts` for rationale.
 */

import type { LazyActionDefinition } from '@flowlib/action-kit';

const httpProvider = { id: 'http' };

export const lazyHttpActions: LazyActionDefinition[] = [
  {
    id: 'http.request',
    provider: httpProvider,
    load: async () => (await import('./request')).httpRequestAction,
  },
];
