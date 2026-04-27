/**
 * Auth helpers for the MCP plugin.
 *
 * Handles identity extraction from MCP request context and RBAC enforcement.
 */

import type { InvectIdentity, InvectInstance } from '@flowlib/core';

/**
 * Maps the MCP SDK's `authInfo` (from `ctx.http.authInfo`) to an InvectIdentity.
 * The authInfo is populated by the framework adapter's middleware which resolves
 * the session/API key before routing to the MCP plugin endpoint.
 */
export function mapAuthInfoToIdentity(authInfo: unknown): InvectIdentity | null {
  if (!authInfo || typeof authInfo !== 'object') {
    return null;
  }
  const info = authInfo as Record<string, unknown>;

  // The Express adapter attaches the resolved identity directly
  if (info.userId && typeof info.userId === 'string') {
    return authInfo as InvectIdentity;
  }

  return null;
}

/**
 * Requires that the identity is present. Throws McpError if not.
 */
export function requireAuth(identity: InvectIdentity | null): InvectIdentity {
  if (!identity) {
    throw new Error('Authentication required. Provide a valid API key or session.');
  }
  return identity;
}

/**
 * Extracts identity if available, returns null otherwise.
 * Used by tool handlers — the underlying client (HttpClient/DirectClient)
 * handles auth at its own layer, so a null identity is acceptable for
 * transports like stdio where auth is pre-established.
 */
export function resolveIdentity(authInfo: unknown): InvectIdentity | null {
  return mapAuthInfoToIdentity(authInfo);
}

/**
 * Authorize a specific action on a resource.
 * Returns true if authorized, throws if denied.
 */
export async function authorizeAction(
  flowlib: InvectInstance,
  identity: InvectIdentity,
  action: string,
  resource?: { type: string; id?: string },
): Promise<void> {
  const result = await flowlib.auth.authorize({
    identity,
    action: action as Parameters<InvectInstance['auth']['authorize']>[0]['action'],
    ...(resource
      ? { resource: resource as Parameters<InvectInstance['auth']['authorize']>[0]['resource'] }
      : {}),
  });

  if (!result.allowed) {
    throw new Error(
      `Permission denied: ${action}${resource?.id ? ` on ${resource.type}/${resource.id}` : ''}`,
    );
  }
}
