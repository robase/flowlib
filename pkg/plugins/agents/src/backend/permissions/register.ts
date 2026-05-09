/**
 * `registerPermissions` — Stream J's subsystem registrar.
 *
 * Wires a `PermissionsResolver` onto `ctx.registries.permissions`.
 * Called once during plugin init by INT (see `plugin.ts`).
 *
 * The resolver depends on a `RolePermissionsRepository` from
 * `ctx.registries.repositories`. Stream F populates that bag; if it
 * isn't ready yet (P0 stub or test bootstraps without the repos),
 * we fall back to the no-op `allowAllResolver` so dependent
 * subsystems (Stream A's hook pipeline, Stream G's MCP bridge) keep
 * working without crashing on undefined access.
 */

import type { PluginContext } from '../plugin-context';
import {
  createResolver,
  type PermissionsResolverDeps,
  type RolePermissionsRepository,
} from './resolver';
import { allowAllResolver } from './types';

/**
 * Loose shape of the repositories bag the resolver consumes. Kept
 * narrow + optional so we don't import Stream F's wider type — they
 * own that surface.
 */
interface RepositoriesLike {
  rolePermissions?: RolePermissionsRepository;
}

/**
 * Build the `PermissionsResolver` from the plugin context and store
 * it on `ctx.registries.permissions`.
 *
 * Returns the registered resolver for callers (and tests) that want
 * to assert on the result without round-tripping through the
 * registry slot.
 */
export function registerPermissions(ctx: PluginContext) {
  const repos = ctx.registries.repositories as RepositoriesLike | undefined;
  const rolePermissions = repos?.rolePermissions;

  let resolver;
  if (!rolePermissions) {
    ctx.logger.warn(
      '[agents] registerPermissions: no rolePermissions repository on ctx.registries.repositories — ' +
        'falling back to allowAllResolver. Stream F populates this bag during init; if you see this ' +
        'in production, the repositories registrar did not run before registerPermissions.',
    );
    resolver = allowAllResolver;
  } else {
    resolver = createPermissionsResolver({ rolePermissions });
  }

  ctx.registries.permissions = resolver;
  ctx.logger.info('[agents] permissions resolver initialised', {
    fallback: !rolePermissions,
  });
  return resolver;
}

/**
 * Functional factory exposed for callers that already hold the deps
 * directly (tests, alternative wiring). Equivalent to `createResolver`
 * but kept under the `register*` module so the public surface stays
 * tidy.
 */
export function createPermissionsResolver(deps: PermissionsResolverDeps) {
  return createResolver(deps);
}
