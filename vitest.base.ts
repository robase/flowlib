/**
 * Shared Vitest base config for all @flowlib/* packages.
 *
 * Usage in package vitest.config.ts:
 *
 * ```ts
 * import { defineConfig, mergeConfig } from 'vitest/config';
 * import baseConfig from '../../vitest.base';
 *
 * export default mergeConfig(baseConfig, defineConfig({
 *   // package-specific overrides here
 * }));
 * ```
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: {
    target: 'node18',
  },
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        'tests/',
        'test/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/examples/**',
      ],
    },
  },
});
