/**
 * @flowlib/user-auth — Backend Entry Point
 *
 * Wraps a [better-auth](https://better-auth.com) instance as an Flowlib plugin,
 * providing:
 * - Session-based identity resolution
 * - Proxied auth routes (sign-in, sign-up, OAuth, etc.)
 * - Authorization hook integration
 * - Express/NestJS middleware helpers
 *
 * @example
 * ```ts
 * // Simple — no separate auth setup needed:
 * import { auth } from '@flowlib/user-auth';
 *
 * defineConfig({
 *   plugins: [auth()],
 * });
 * ```
 *
 * @example
 * ```ts
 * // With frontend UI:
 * import { auth } from '@flowlib/user-auth';
 * import { authFrontend } from '@flowlib/user-auth/ui';
 *
 * defineConfig({
 *   plugins: [auth({ frontend: authFrontend })],
 * });
 * ```
 *
 * @packageDocumentation
 */
export { authentication, USER_AUTH_SCHEMA } from './plugin';
export type {
  AuthenticationPluginOptions,
  ApiKeyPluginOptions,
  TwoFactorPluginOptions,
  BetterAuthPassthroughOptions,
  BetterAuthInstance,
  BetterAuthUser,
  BetterAuthSession,
  BetterAuthSessionResult,
} from './types';

import type { FlowlibPluginDefinition } from '@flowlib/core';
import type { AuthenticationPluginOptions } from './types';
import { authentication } from './plugin';

/**
 * Create the auth plugin definition for Flowlib config.
 *
 * @example
 * ```ts
 * // Express (backend only):
 * auth({ adminEmail: '...' })
 *
 * // Next.js (with frontend):
 * import { authFrontend } from '@flowlib/user-auth/ui';
 * auth({ adminEmail: '...', frontend: authFrontend })
 * ```
 */
export function auth(options: AuthenticationPluginOptions = {}): FlowlibPluginDefinition {
  return {
    id: 'user-auth',
    name: 'User Authentication',
    backend: authentication(options),
    frontend: options.frontend,
  };
}
