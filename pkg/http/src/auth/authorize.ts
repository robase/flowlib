/**
 * Shared endpoint-authorization helper.
 *
 * Phase 2 of the shared-HTTP-adapter plan: every framework adapter currently
 * decides on its own whether/how to enforce permissions before invoking a
 * handler. Express has uniform middleware; NestJS and Next.js do it
 * inconsistently across routes.
 *
 * This helper centralises the decision and makes it consume the same
 * `flowlib.auth.authorize()` path that plugin `onAuthorize` hooks rely on.
 * Adapters call it after resolving identity but before invoking the handler.
 */

import type { FlowlibIdentity, FlowlibInstance } from '@flowlib/core';
import type { EndpointAuth, FlowlibHttpRequest } from '../types';

export type AuthorizeEndpointResult =
  | { kind: 'allow' }
  | { kind: 'unauthenticated'; reason: string }
  | { kind: 'forbidden'; reason: string };

/**
 * Decide whether `identity` may invoke an endpoint with the declared `auth`
 * config, given the request context. Returns one of:
 *
 * - `{ kind: 'allow' }` — handler may run.
 * - `{ kind: 'unauthenticated' }` — adapter should respond `401`.
 * - `{ kind: 'forbidden' }` — adapter should respond `403`.
 *
 * The helper does NOT itself shape the HTTP response — adapters have
 * different conventions (Express middleware throws, Next returns
 * `Response.json`, NestJS throws `HttpException`). Returning a discriminated
 * union keeps the response-writing logic in adapter code.
 *
 * Implementation routes through `flowlib.auth.authorize()` so plugin
 * `onAuthorize` hooks (e.g. RBAC's per-flow ACL checks) and the host's
 * `customAuthorize` callback are honoured.
 */
export async function authorizeEndpoint(
  flowlib: FlowlibInstance,
  identity: FlowlibIdentity | null,
  auth: EndpointAuth,
  request: FlowlibHttpRequest,
): Promise<AuthorizeEndpointResult> {
  if (auth.kind === 'public') {
    return { kind: 'allow' };
  }

  if (!identity) {
    return {
      kind: 'unauthenticated',
      reason: 'Authentication required',
    };
  }

  const resource = auth.getResource ? auth.getResource(request) : undefined;

  const result = await flowlib.auth.authorize({
    identity,
    action: auth.permission,
    ...(resource ? { resource } : {}),
  });

  if (result.allowed) {
    return { kind: 'allow' };
  }

  return {
    kind: 'forbidden',
    reason: result.reason ?? `Permission denied: ${auth.permission}`,
  };
}
