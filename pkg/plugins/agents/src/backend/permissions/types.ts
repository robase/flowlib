/**
 * Permissions resolver — see Stream J (Phase 1) for the implementation.
 * Computes the **effective deny list** for a tool call by combining:
 *  1. Role-derived denies from `agent_role_permissions`
 *  2. Per-session `extraDenied` overrides
 *  3. Per-session `enabledTools` whitelist (when set, anything outside
 *     the whitelist is denied)
 *  4. Superadmin bypass
 */

import type { AgentsAuthContext } from '../../shared/auth-context';

/**
 * Resolver query input — everything the resolver needs to compute the
 * effective deny list for one user/session pair.
 */
export interface ResolveDenyListInput {
  auth: AgentsAuthContext;
  sessionId: string;
  /** Per-session overrides loaded from `agent_sessions`. */
  sessionEnabledTools?: ReadonlyArray<string> | null;
  sessionExtraDenied?: ReadonlyArray<string> | null;
  /** Per-agent overrides loaded from the session config. */
  agentEnabledTools?: ReadonlyArray<string> | null;
  agentDenyList?: ReadonlyArray<string> | null;
}

/**
 * The resolver surface. Stream J ships the implementation; v1 default
 * is the no-op resolver below.
 */
export interface PermissionsResolver {
  /**
   * Compute the effective deny set. A tool name appearing in the
   * returned set MUST be blocked at the MCP-bridge layer (Stream G).
   *
   * Returns a `Set` (not an array) so callers can `.has()` cheaply.
   */
  getEffectiveDenyList(input: ResolveDenyListInput): Promise<Set<string>>;
  /** Convenience: true if the user can use the tool right now. */
  isToolAllowed(input: ResolveDenyListInput & { toolName: string }): Promise<boolean>;
}

/**
 * No-op resolver — every tool is allowed. Used in P0 stubs and tests
 * where the deny list isn't relevant.
 */
export const allowAllResolver: PermissionsResolver = {
  async getEffectiveDenyList() {
    return new Set();
  },
  async isToolAllowed() {
    return true;
  },
};
