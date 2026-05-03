/**
 * Better Auth client factory.
 *
 * Creates a per-baseURL React client wired with the plugins this auth plugin
 * exposes server-side: 2FA + admin. Memoised in the AuthProvider so the same
 * client instance is reused across renders.
 *
 * The client's full type pulls in zod-internal types that are not portable
 * across declaration-emit boundaries, so we widen it to a structural shape
 * via `AuthClient`.  Per-method types are still inferred at the call site
 * through the React Query option factories.
 */

import { createAuthClient } from 'better-auth/react';
import { adminClient, magicLinkClient, twoFactorClient } from 'better-auth/client/plugins';

// eslint-disable-next-line typescript/no-explicit-any -- opaque widening avoids declaration-emit issues with zod internal types
export type AuthClient = any;

export function createFlowlibAuthClient(baseURL: string): AuthClient {
  return createAuthClient({
    // Better Auth's `createAuthClient` parses baseURL with `new URL(...)`,
    // which rejects relative paths like `/api/flowlib/...`. Resolve against
    // `window.location.origin` when running in the browser so hosts can pass
    // either an absolute URL or a relative path.
    baseURL: resolveBaseURL(baseURL),
    plugins: [twoFactorClient(), adminClient(), magicLinkClient()],
  });
}

function resolveBaseURL(baseURL: string): string {
  if (/^https?:\/\//i.test(baseURL)) {
    return baseURL;
  }
  if (typeof window === 'undefined') {
    return baseURL;
  }
  const path = baseURL.startsWith('/') ? baseURL : `/${baseURL}`;
  return `${window.location.origin}${path}`;
}
