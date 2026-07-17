/**
 * Node vitest config for the eval harness self-tests.
 *
 * Deliberately separate from the plugin's root `vitest.config.ts`, which
 * runs in the Cloudflare `workerd` pool. The harness runs in Node (real
 * timers, `node:fs`, dynamic `import()` of the AI SDK), so its tests need
 * the plain Node environment.
 *
 * Run with: pnpm --filter @flowlib/agents eval:test
 */
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { defineConfig } from 'vitest/config';

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  test: {
    include: ['__tests__/**/*.test.ts'],
    environment: 'node',
    // Self-tests use the scripted provider — fast, no network.
    testTimeout: 20_000,
  },
});
