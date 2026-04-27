/**
 * @flowlib/user-auth — Browser Entry Point
 *
 * Resolved via the `browser` condition in package.json exports when
 * `@flowlib/user-auth` is imported in a browser context (Vite, webpack, etc.).
 *
 * Returns only the frontend plugin — no server-side code is bundled.
 *
 * @example
 * ```ts
 * // flowlib.config.ts (shared between backend and frontend)
 * import { auth } from '@flowlib/user-auth';
 *
 * export default defineConfig({
 *   plugins: [auth()],
 * });
 *
 * // Frontend: Vite resolves to this browser entry
 * // Backend: Node.js resolves to the full backend entry
 * ```
 */
import { authFrontend } from './frontend/index';

interface FlowlibPluginDefinition {
  id: string;
  name?: string;
  backend?: unknown;
  frontend?: unknown;
}

/**
 * Browser-safe auth plugin factory.
 *
 * Accepts any options for type compatibility with the Node.js entry
 * but ignores them in the browser. Returns only the frontend plugin.
 */
export function auth(_options?: Record<string, unknown>): FlowlibPluginDefinition {
  return {
    id: 'user-auth',
    name: 'User Authentication',
    frontend: authFrontend,
  };
}

// Re-export types
export type {
  AuthenticationPluginOptions,
  ApiKeyPluginOptions,
  TwoFactorPluginOptions,
  BetterAuthPassthroughOptions,
} from './backend/types';
