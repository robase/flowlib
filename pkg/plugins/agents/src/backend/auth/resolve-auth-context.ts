/**
 * `resolveAuthContext` — turn a `FlowlibIdentity` into an
 * `AgentsAuthContext` with `orgId` always populated.
 *
 * Resolution order for `orgId`:
 *  1. `identity.metadata.orgId` if set (host's auth wiring)
 *  2. `options.staticOrgId` from `agents({ staticOrgId: '...' })`
 *  3. Default literal `'default-org'`
 *
 * The plugin also runs a one-shot pre-flight check at init: when
 * `orgScope: 'required'` is set and the host has neither an auth plugin
 * supplying `metadata.orgId` nor a `staticOrgId`, a warning is logged but
 * the plugin still boots — see `plugin.ts`.
 */

import type { FlowlibIdentity } from '@flowlib/core';
import type { AgentsAuthContext } from '../../shared/auth-context';

/** Reserved literal used when no static or dynamic org id is supplied. */
export const DEFAULT_ORG_ID = 'default-org';

/** Options influencing the resolution. */
export interface ResolveAuthContextOptions {
  /** Static fallback org id. */
  staticOrgId?: string;
  /** When `'required'`, a missing identity throws. @default 'optional' */
  orgScope?: 'optional' | 'required';
}

/**
 * Extract `orgId` from `identity.metadata.orgId` if present. Permissive —
 * accepts strings, numbers (coerced), but rejects empty / non-truthy.
 */
function extractMetadataOrgId(identity: FlowlibIdentity): string | null {
  const meta = identity.metadata;
  if (!meta || typeof meta !== 'object') {return null;}
  const raw = (meta as { orgId?: unknown }).orgId;
  if (typeof raw === 'string' && raw.length > 0) {return raw;}
  if (typeof raw === 'number' && Number.isFinite(raw)) {return String(raw);}
  return null;
}

/**
 * Resolve a `FlowlibIdentity` plus plugin options into the structured
 * `AgentsAuthContext` the rest of the plugin uses.
 *
 * Throws when `identity` is null and `orgScope: 'required'`. Otherwise
 * a missing identity is treated as anonymous and the resolver still
 * returns a populated context with `orgId === staticOrgId ?? 'default-org'`
 * (used by webhooks and other public endpoints that have no caller).
 */
export function resolveAuthContext(
  identity: FlowlibIdentity | null,
  options: ResolveAuthContextOptions = {},
): AgentsAuthContext {
  const fallbackOrgId = options.staticOrgId ?? DEFAULT_ORG_ID;

  if (!identity) {
    if (options.orgScope === 'required') {
      throw new Error(
        '[agents] orgScope: "required" but no identity present on the request',
      );
    }
    return {
      userId: 'anonymous',
      orgId: fallbackOrgId,
      role: 'user',
      teamIds: [],
    };
  }

  const orgId = extractMetadataOrgId(identity) ?? fallbackOrgId;

  return {
    userId: identity.id,
    orgId,
    role: identity.role ?? 'user',
    teamIds: identity.teamIds ?? [],
  };
}
