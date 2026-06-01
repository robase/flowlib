/// <reference types="@cloudflare/workers-types" />
/**
 * Tenant-scoped Durable Object id helpers.
 *
 * Every DO this plugin owns is addressed by a name that is **prefixed
 * with the caller's `orgId`**. Two requests from different orgs that
 * happen to share a session id therefore land on different DO
 * instances — the WebSocket fan-out, hot-state SQLite, and DO storage
 * are all structurally isolated.
 *
 * Naming scheme:
 *
 *     org:${orgId}/kind:${kind}/${suffix}
 *
 * `kind` is open-ended so future DOs (e.g. workspace-coordinator,
 * sandbox-runner) can share the helper without colliding on suffixes.
 *
 * Callers always go through this helper rather than computing names
 * inline so the prefix scheme can evolve in one place.
 */

import type { AgentsAuthContext } from '../../shared/auth-context';

/**
 * Minimal env shape this helper needs. Consumers pass through their
 * own `Env` interface that has at least an `AgentChatDO` Durable Object
 * binding. Other DO bindings can be added by widening this shape in
 * the call site.
 */
export interface AgentChatEnvBindings {
  AgentChatDO: DurableObjectNamespace;
}

/** Logical category of DO instances this name addresses. */
export type TenantScopedDoKind = 'chat' | 'workspace' | (string & {});

/**
 * Build a tenant-scoped Durable Object id.
 *
 * @param env - The Worker env carrying the `AgentChatDO` binding.
 * @param kind - Logical category. `'chat'` for session DOs, `'workspace'`
 *   for sandbox-coordinator DOs, etc.
 * @param authCtx - Resolved auth context. **Must** carry a non-empty
 *   `orgId`; the helper rejects empty values to prevent cross-tenant
 *   leaks via accidental fall-throughs.
 * @param suffix - Stable per-instance suffix (typically the session id
 *   or workspace id).
 * @returns A `DurableObjectId` derived deterministically from the name.
 *
 * @throws if `authCtx.orgId` is empty or only whitespace.
 */
export function tenantScopedId(
  env: AgentChatEnvBindings,
  kind: TenantScopedDoKind,
  authCtx: AgentsAuthContext,
  suffix: string,
): DurableObjectId {
  if (!authCtx.orgId || authCtx.orgId.trim().length === 0) {
    throw new Error('[agents] tenantScopedId: orgId required for tenant-scoped DO id');
  }
  if (!suffix || suffix.trim().length === 0) {
    throw new Error('[agents] tenantScopedId: suffix required');
  }
  const name = tenantScopedName(kind, authCtx.orgId, suffix);
  return env.AgentChatDO.idFromName(name);
}

/**
 * Build the *string* name used to derive a DO id, without requiring
 * an env binding. Useful for endpoints that need to return the
 * `doAgentName` to clients (Stream I) so the frontend can call
 * `useAgent({ agent: 'AgentChatDO', name: doAgentName })` directly.
 *
 * Pure — no DO binding access, no I/O. Same validation rules as
 * `tenantScopedId`.
 *
 * **URL safety.** The frontend's `useAgent` interpolates this name
 * into a URL path segment (`/agents/<kebab-class>/<name>`) without
 * encoding it. `partyserver`'s router then splits on `/`, takes
 * `parts[2]` as the room, and ignores the rest — so any slash inside
 * the name silently truncates the DO id and routes the WebSocket to
 * the wrong DO instance. We use `__` as the separator: it is path-safe,
 * doesn't appear in UUID v4 suffixes (which use `-`), doesn't appear
 * in the Better Auth org id format (alphanumeric), and round-trips
 * unchanged through every URL layer.
 */
export function tenantScopedName(kind: TenantScopedDoKind, orgId: string, suffix: string): string {
  if (!orgId || orgId.trim().length === 0) {
    throw new Error('[agents] tenantScopedName: orgId required');
  }
  if (!suffix || suffix.trim().length === 0) {
    throw new Error('[agents] tenantScopedName: suffix required');
  }
  return `org__${orgId}__${kind}__${suffix}`;
}
