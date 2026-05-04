/**
 * Shared plugin-endpoint dispatcher.
 *
 * Plugin route matching, auth enforcement, and handler invocation were
 * previously duplicated across all three framework adapters. The dispatcher
 * here owns that pipeline; the adapter is reduced to:
 *   1. Resolve identity (their existing global `onRequest` middleware)
 *   2. Build a `FlowlibHttpRequest` from the host request
 *   3. Call `dispatchPluginEndpoint(...)`
 *   4. Translate the returned `FlowlibHttpResult` into their native response
 *
 * The dispatcher does NOT itself run plugin `onRequest` hooks — Express and
 * NestJS already run those in global middleware before reaching this path,
 * and Next.js runs them inline in its handler. Centralising hook-running
 * here would change observable timing for the Express middleware chain.
 */

import type {
  FlowlibInstance,
  FlowlibPermission,
  FlowlibPluginEndpoint,
  PluginDatabaseApi,
  PluginEndpointContext,
  PluginEndpointResponse,
} from '@flowlib/core';
import type { FlowlibHttpMethod, FlowlibHttpRequest, FlowlibHttpResult } from '../types';
import { matchPluginEndpoint } from './match';

export interface DispatchPluginEndpointInput {
  flowlib: FlowlibInstance;
  /** The path under `/plugins/` (leading slash, no `/plugins` prefix). */
  pluginPath: string;
  method: FlowlibHttpMethod;
  request: FlowlibHttpRequest;
  /**
   * Pre-built `PluginDatabaseApi`. Adapters call
   * `createPluginDatabaseApi(flowlib.plugins.getDatabaseConnection())` and
   * pass it in. The dispatcher doesn't construct it itself because the
   * Next.js adapter loads `@flowlib/core` lazily.
   */
  database: PluginDatabaseApi;
}

/**
 * Run a plugin-endpoint request through match → authorize → handle.
 *
 * Returns one of:
 *   - `{ kind: 'json', status: 404, ... }` — no endpoint matched
 *   - `{ kind: 'json', status: 403, ... }` — auth check failed
 *   - `{ kind: 'response', response }` — handler returned a Web `Response`
 *   - `{ kind: 'stream', stream, status }` — handler returned a stream
 *   - `{ kind: 'json', status, body }` — handler returned a plain JSON result
 */
export async function dispatchPluginEndpoint(
  input: DispatchPluginEndpointInput,
): Promise<FlowlibHttpResult> {
  const { flowlib, pluginPath, method, request, database } = input;

  const endpoints = flowlib.plugins.getEndpoints();
  const matched = matchPluginEndpoint<FlowlibPluginEndpoint>(
    endpoints as readonly FlowlibPluginEndpoint[],
    method,
    pluginPath,
  );

  if (!matched) {
    return {
      kind: 'json',
      status: 404,
      body: {
        error: 'Not Found',
        message: `Plugin route ${method} ${pluginPath} not found`,
      },
    };
  }

  const { endpoint, params } = matched;

  // Endpoint-level auth. The previous adapter implementations called
  // `flowlib.auth.hasPermission()` directly — that bypassed plugin
  // `onAuthorize` hooks and any DB-backed access checks. Use the full
  // `authorize()` path so RBAC plugins keep working.
  if (!endpoint.isPublic && endpoint.permission) {
    const result = await checkEndpointAuth(flowlib, request, endpoint.permission);
    if (result) {
      return result;
    }
  }

  const handlerContext: PluginEndpointContext = {
    body: (request.body ?? {}) as Record<string, unknown>,
    params,
    query: extractStringQuery(request),
    headers: request.headers,
    identity: request.identity ?? null,
    database,
    request: request.webRequest,
    core: {
      getPermissions: (identity) => flowlib.auth.getPermissions(identity),
      getAvailableRoles: () => flowlib.auth.getAvailableRoles(),
      getResolvedRole: (identity) => flowlib.auth.getResolvedRole(identity),
      authorize: (context) => flowlib.auth.authorize(context),
    },
    getFlowlib: () => flowlib,
  };

  const handlerResult = await endpoint.handler(handlerContext);

  return classifyHandlerResult(handlerResult);
}

/**
 * Per-endpoint authorization check. Returns `null` to continue to the
 * handler, or a `FlowlibHttpResult` (the 403 body) to short-circuit.
 *
 * Uses `flowlib.auth.authorize()` rather than `hasPermission()` so plugin
 * `onAuthorize` hooks (e.g. the RBAC plugin's per-flow ACL checks) are
 * honoured for plugin endpoints, not just Flowlib's first-party routes.
 */
async function checkEndpointAuth(
  flowlib: FlowlibInstance,
  request: FlowlibHttpRequest,
  permission: FlowlibPermission,
): Promise<FlowlibHttpResult | null> {
  const result = await flowlib.auth.authorize({
    identity: request.identity ?? null,
    action: permission,
  });
  if (result.allowed) {
    return null;
  }
  return {
    kind: 'json',
    status: request.identity ? 403 : 401,
    body: {
      error: request.identity ? 'Forbidden' : 'Unauthorized',
      message: result.reason ?? `Missing permission: ${permission}`,
    },
  };
}

/**
 * Build the string-valued query map plugin handlers expect. The handler
 * context type accepts `Record<string, string | undefined>` which doesn't
 * include arrays — for Express's repeated-key form, the helpers in
 * `@flowlib/http/parsing` already collapse to a single value.
 */
function extractStringQuery(request: FlowlibHttpRequest): Record<string, string | undefined> {
  if (request.rawQuery && typeof request.rawQuery === 'object') {
    return request.rawQuery as Record<string, string | undefined>;
  }
  const out: Record<string, string | undefined> = {};
  request.searchParams.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

/**
 * Map a `PluginEndpointResponse` (the union shape declared in core) into a
 * dispatcher-side `FlowlibHttpResult`. Adapters then translate from this
 * to their native response.
 */
function classifyHandlerResult(result: PluginEndpointResponse): FlowlibHttpResult {
  if (result instanceof Response) {
    return { kind: 'response', response: result };
  }

  if ('stream' in result && result.stream) {
    return {
      kind: 'stream',
      status: result.status ?? 200,
      stream: result.stream,
    };
  }

  const jsonBody = 'body' in result ? result.body : null;
  return {
    kind: 'json',
    status: ('status' in result && result.status) || 200,
    body: jsonBody,
  };
}
