/**
 * Permissions resolver — Stream J implementation.
 *
 * Computes the **effective deny list** for a tool call by combining
 * inputs from four sources:
 *
 *   1. Role-derived denies pulled from `agent_role_permissions` rows
 *      where `enabled=false` for the user's current role.
 *   2. Per-agent `denyList` overrides supplied by the caller (loaded
 *      from `agent_sessions.denyList`).
 *   3. Per-session `extraDenied` overrides supplied by the caller
 *      (loaded from `agent_sessions.extraDenied`).
 *   4. Per-session `enabledTools` whitelist (loaded from
 *      `agent_sessions.enabledTools`). When set (non-null and
 *      non-empty), anything outside the whitelist is denied; the
 *      resolver computes this against the **agent's tool universe**
 *      (`agentEnabledTools`) when one is supplied, otherwise against
 *      the union of every input list and any role-permission rows for
 *      this user.
 *
 * Resolution short-circuits to an empty set for `superadmin` users.
 *
 * The schema for `agent_role_permissions` is currently a placeholder
 * — see `plans/agents/open-questions.md` Q42/Q42b. The resolver works
 * against the four columns declared today (`roleId`, `toolName`,
 * `enabled`, `reason`). If/when the schema settles into a different
 * shape (per-statement permission strings, per-instance ACLs, …)
 * we'll adapt the repository surface; the resolver's input contract
 * (`ResolveDenyListInput`) is stable and downstream consumers
 * (Stream A's hook pipeline, Stream G's MCP bridge) won't need to
 * move with us.
 */

import type { PermissionsResolver, ResolveDenyListInput } from './types';

/**
 * Minimal repository surface the resolver needs. Stream F populates
 * `ctx.registries.repositories` with a real implementation; tests
 * mock this directly. Keeping the surface narrow (one method) lets
 * Stream J ship without coupling to the wider repositories bag.
 *
 * A row represents a single (role, tool) entry. Rows where
 * `enabled === false` contribute to the role's deny set. Rows where
 * `enabled === true` are explicit allows — they do NOT subtract from
 * other deny sources, since denies from per-agent / per-session /
 * whitelist layers are intentional caller decisions.
 */
export interface RolePermissionsRepository {
  /**
   * Returns every `agent_role_permissions` row for the given role.
   * Implementations should return rows in any order; the resolver
   * does not depend on ordering.
   */
  listByRole(roleId: string): Promise<ReadonlyArray<RolePermissionRow>>;
}

/**
 * A single `agent_role_permissions` row, narrowed to the columns the
 * resolver consumes. Persistence layers may carry additional columns
 * (`reason`, `updatedAt`, …) — the resolver ignores them.
 */
export interface RolePermissionRow {
  roleId: string;
  toolName: string;
  enabled: boolean;
}

/**
 * Anything that can supply the resolver with its repository
 * dependency. The plugin-context-backed factory (`createPermissionsResolver`)
 * uses `ctx.registries.repositories` (populated by Stream F);
 * tests pass a literal `{ rolePermissions: mockRepo }`.
 */
export interface PermissionsResolverDeps {
  rolePermissions: RolePermissionsRepository;
}

/**
 * Build a `PermissionsResolver` from explicit dependencies.
 *
 * The resolver is stateless — it does not cache role lookups. Stream
 * A's session-bound caching layer is responsible for memoizing
 * results per `(userId, sessionId)`; the resolver's job is to be a
 * pure function of its inputs.
 */
export function createResolver(deps: PermissionsResolverDeps): PermissionsResolver {
  async function getEffectiveDenyList(input: ResolveDenyListInput): Promise<Set<string>> {
    // Step 6 (early): superadmin bypass. Returning an empty set here
    // means **no tool is ever denied** for superadmins, even if the
    // caller passed an explicit `agentDenyList` or `sessionExtraDenied`.
    // This matches the contract in `rbac-and-visibility.md`.
    if (input.auth.role === 'superadmin') {
      return new Set();
    }

    const deny = new Set<string>();

    // Step 2: role-derived denies. Pull every row for this role and
    // add any with `enabled === false` to the deny set.
    const roleRows = await deps.rolePermissions.listByRole(input.auth.role);
    for (const row of roleRows) {
      if (row.enabled === false) {
        deny.add(row.toolName);
      }
    }

    // Step 3: per-agent denies.
    if (input.agentDenyList) {
      for (const tool of input.agentDenyList) {
        deny.add(tool);
      }
    }

    // Step 4: per-session extra denies.
    if (input.sessionExtraDenied) {
      for (const tool of input.sessionExtraDenied) {
        deny.add(tool);
      }
    }

    // Step 5: per-session whitelist (intersect-mode). When a session
    // enables an explicit list of tools, anything *outside* that list
    // is denied. We need a tool universe to subtract against — there
    // are three sources, in priority order:
    //
    //   a. The agent's `enabledTools` (the tools the agent itself
    //      makes available — supplied by the caller as
    //      `agentEnabledTools`).
    //   b. The role's permission rows (every tool name we've seen
    //      for this role, regardless of enabled state).
    //   c. The current `deny` set + the whitelist itself.
    //
    // Whichever sources the caller has at hand contribute. Tools
    // never seen by the resolver are *not* added to the deny set
    // here — that's the MCP bridge's job (Stream G filters the live
    // tool catalogue by both `deny.has(name)` and "is in
    // `enabledTools` if set"). The resolver's whitelist subtraction
    // is best-effort: it surfaces tools we already know about and
    // denies them; the bridge handles the universe of tools the
    // resolver hasn't seen.
    const whitelist = input.sessionEnabledTools;
    if (whitelist && whitelist.length > 0) {
      const allowed = new Set(whitelist);
      const knownTools = new Set<string>();
      if (input.agentEnabledTools) {
        for (const tool of input.agentEnabledTools) {
          knownTools.add(tool);
        }
      }
      for (const row of roleRows) {
        knownTools.add(row.toolName);
      }
      for (const tool of deny) {
        knownTools.add(tool);
      }
      // The whitelist itself is part of the universe; tools in the
      // whitelist obviously shouldn't be denied.
      for (const tool of whitelist) {
        knownTools.add(tool);
      }

      for (const tool of knownTools) {
        if (!allowed.has(tool)) {
          deny.add(tool);
        }
      }
    }

    return deny;
  }

  async function isToolAllowed(
    input: ResolveDenyListInput & { toolName: string },
  ): Promise<boolean> {
    const deny = await getEffectiveDenyList(input);
    return !deny.has(input.toolName);
  }

  return { getEffectiveDenyList, isToolAllowed };
}
