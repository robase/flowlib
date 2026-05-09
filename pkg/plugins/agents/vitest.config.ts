/**
 * Vitest config for `@flowlib/agents`.
 *
 * Tests run in the Cloudflare Workers runtime via
 * `@cloudflare/vitest-pool-workers`. The pool boots a real `workerd`
 * isolate per test file, so any code that imports `cloudflare:workers`,
 * accesses Durable Objects, or otherwise touches Workers-only globals
 * (`crypto.subtle`, `caches`, `WebSocketPair`, …) is exercised in the
 * same environment it runs in production.
 *
 * Run with: `pnpm --filter @flowlib/agents test`
 */
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        // Latest compatibility date supporting modern bindings + DO migrations.
        compatibilityDate: '2025-01-01',
        compatibilityFlags: ['nodejs_compat'],
      },
    }),
  ],
  test: {
    include: ['src/**/*.test.ts', 'src/**/__tests__/**/*.test.ts'],
  },
});
