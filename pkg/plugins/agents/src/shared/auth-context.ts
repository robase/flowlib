/**
 * Shared, browser-safe DTO for the resolved auth context the plugin uses
 * throughout the backend (and quotes back to the frontend in DO names).
 *
 * Pure types — no runtime imports, safe to bundle into UI code.
 *
 * The resolution rules live in `backend/auth/resolve-auth-context.ts`.
 */

/**
 * Resolved auth context for one request to the agents plugin.
 *
 * `orgId` is **always populated** — the resolver falls back to a configured
 * `staticOrgId` (default `'default-org'`) when the host's auth wiring
 * doesn't set `identity.metadata.orgId`. This means tenant-scoped queries
 * never need to handle `orgId === undefined`; they can `WHERE orgId = $authCtx.orgId`
 * unconditionally.
 *
 * In single-tenant deployments every row gets the same `orgId` and isolation
 * collapses to a no-op. In multi-tenant deployments the host's auth plugin
 * (typically Better Auth's organization plugin) populates `metadata.orgId`
 * per request and isolation is structural.
 */
export interface AgentsAuthContext {
  /** Stable user identifier (matches `FlowlibIdentity.id`). */
  userId: string;
  /**
   * Tenant id. Always populated. Sources, in priority order:
   * 1. `identity.metadata.orgId`
   * 2. Plugin's `staticOrgId` option
   * 3. Literal `'default-org'`
   */
  orgId: string;
  /**
   * Resolved Flowlib role for the user. Free-form string so custom roles
   * (e.g. `'reviewer'`) work, but the well-known set is enumerated below
   * for ergonomics.
   */
  role: 'user' | 'admin' | 'superadmin' | (string & {});
  /** Team memberships from `FlowlibIdentity.teamIds`. */
  teamIds: string[];
}
