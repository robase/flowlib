/**
 * Shared helpers for the agents-plugin REST endpoints.
 *
 * Every handler resolves an `AgentsAuthContext` from the request
 * identity, materialises a fresh `Repositories` bag bound to the
 * per-request `PluginDatabaseApi`, and applies tenant-scoped reads.
 *
 * Handlers return 404 (not 403) when a row exists but lives in a
 * different `orgId`, so existence is never leaked across tenants.
 */

import type { PluginEndpointContext, PluginEndpointResponse } from '@flowlib/core';
import type { PluginContext, ResolvedAgentsOptions } from '../plugin-context';
import {
  resolveAuthContext,
  type ResolveAuthContextOptions,
} from '../auth/resolve-auth-context';
import type { AgentsAuthContext } from '../../shared/auth-context';
import type { Repositories, RepositoriesFactory } from '../repositories/register';

/** Bag of dependencies an endpoint handler needs at request time. */
export interface EndpointDeps {
  auth: AgentsAuthContext;
  repos: Repositories;
  pluginCtx: PluginContext;
  endpointCtx: PluginEndpointContext;
}

/**
 * Resolve a `PluginEndpointContext` into the per-request dependencies
 * an endpoint handler uses.
 *
 * @throws if `repositories` is missing from the registries (Stream F
 *   must run before endpoints — order is enforced in `plugin.ts`).
 */
export function resolveDeps(
  pluginCtx: PluginContext,
  endpointCtx: PluginEndpointContext,
): EndpointDeps {
  const factory = pluginCtx.registries.repositories as
    | RepositoriesFactory
    | undefined;
  if (!factory) {
    throw new Error(
      '[agents] endpoints: repositories factory missing on registries — ' +
        'registerRepositories must run before registerEndpoints',
    );
  }

  const authOptions: ResolveAuthContextOptions = {
    staticOrgId: pluginCtx.options.staticOrgId,
    orgScope: pluginCtx.options.orgScope,
  };
  const auth = resolveAuthContext(endpointCtx.identity, authOptions);
  const repos = factory(endpointCtx.database);

  return { auth, repos, pluginCtx, endpointCtx };
}

/**
 * 404 response shape. Never leaks whether the row exists in another org.
 */
export function notFound(message: string): PluginEndpointResponse {
  return { status: 404, body: { error: message } };
}

/**
 * 400 response shape used when a request body is invalid.
 */
export function badRequest(
  message: string,
  details?: Record<string, unknown>,
): PluginEndpointResponse {
  const body: Record<string, unknown> = { error: message };
  if (details) body.details = details;
  return { status: 400, body };
}

/**
 * 501 response — used by the `POST /sessions/:id/prompt` placeholder
 * (v1 prompts go via WebSocket, not HTTP).
 */
export function notImplemented(
  message: string,
  hint?: Record<string, unknown>,
): PluginEndpointResponse {
  const body: Record<string, unknown> = { error: message };
  if (hint) body.hint = hint;
  return { status: 501, body };
}

/**
 * Wrap an async handler so unexpected throws become structured 500s
 * with a tenant-safe error message (we never serialise the full stack
 * to the response body).
 */
export function safeHandler(
  pluginCtx: PluginContext,
  fn: (
    deps: EndpointDeps,
  ) => Promise<PluginEndpointResponse>,
): (endpointCtx: PluginEndpointContext) => Promise<PluginEndpointResponse> {
  return async (endpointCtx) => {
    try {
      const deps = resolveDeps(pluginCtx, endpointCtx);
      return await fn(deps);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      pluginCtx.logger.error('[agents] endpoint error', { error: message });
      return { status: 500, body: { error: 'Internal error', message } };
    }
  };
}

/**
 * Read a string param from a `Record<string, unknown>` body without
 * forcing the caller to repeat type guards.
 */
export function bodyString(
  body: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  if (!body) return undefined;
  const v = body[key];
  return typeof v === 'string' ? v : undefined;
}

/**
 * Helper that mirrors the plugin options surface some tests need.
 * Useful when wiring tests that don't have a real `PluginContext`.
 */
export function readResolvedOptions(
  pluginCtx: PluginContext,
): ResolvedAgentsOptions {
  return pluginCtx.options;
}
