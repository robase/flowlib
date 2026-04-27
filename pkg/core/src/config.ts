/**
 * @flowlib/core/config — Browser-safe configuration entry point.
 *
 * This module is safe to import in browser bundles (Vite, webpack, Next.js client).
 * It contains only the `defineConfig` identity function and type re-exports.
 * No Zod schemas, no Node.js APIs, no runtime dependencies.
 *
 * @example
 * ```ts
 * import { defineConfig } from '@flowlib/core/config';
 *
 * export default defineConfig({
 *   apiPath: '/api/flowlib',
 *   frontendPath: '/flowlib',
 *   theme: 'dark',
 *   plugins: [auth(), rbac()],
 *   database: { type: 'sqlite', connectionString: 'file:./dev.db' },
 *   encryptionKey: process.env.FLOWLIB_ENCRYPTION_KEY!,
 * });
 * ```
 */

// Re-export types only — no runtime code from these modules
export type {
  FlowlibConfig,
  FlowlibDatabaseConfig,
  ExecutionConfig,
  LoggingConfig,
} from './schemas/flowlib-config';
export type { FlowlibPluginDefinition } from './types/plugin.types';

/**
 * Identity function that provides TypeScript type inference and
 * autocompletion for Flowlib configuration objects.
 *
 * Works identically in Node.js and browser environments.
 * No runtime validation — same pattern as Vite's `defineConfig`.
 */
export function defineConfig<T extends Record<string, unknown>>(config: T): T {
  return config;
}
