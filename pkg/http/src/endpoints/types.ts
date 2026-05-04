/**
 * Shared endpoint metadata.
 *
 * Phase 4 of [the shared-HTTP plan][plan]: instead of every adapter declaring
 * its own routes (`router.post(...)`, `@Post(...)`, `if (path === '...')`),
 * the routes for a slice live as plain data in `@flowlib/http/endpoints/*` and
 * each adapter walks the array to mount/dispatch them.
 *
 * The shape covers the four operations every adapter currently does inline:
 *   1. match method + path
 *   2. enforce auth via `flowlib.auth.authorize()`
 *   3. parse the request into a typed `Parsed` value
 *   4. invoke the handler and translate the result into the host response
 *
 * The handler returns a `FlowlibHttpResult` so streaming, raw `Response`
 * passthrough, and plain JSON all flow through the same plumbing the plugin
 * dispatcher uses.
 *
 * [plan]: ../../../../plans/shared-http-adapter-plan.md
 */

import type { FlowlibInstance } from '@flowlib/core';
import type {
  EndpointAuth,
  FlowlibHttpMethod,
  FlowlibHttpRequest,
  FlowlibHttpResult,
} from '../types';

/**
 * Context passed to an endpoint's `handle` function.
 *
 * `parsed` is the output of the optional `parse` step; for endpoints that
 * don't declare a parser, `Parsed` is `undefined` and `parsed === undefined`.
 */
export interface EndpointHandlerContext<Parsed> {
  flowlib: FlowlibInstance;
  request: FlowlibHttpRequest;
  parsed: Parsed;
}

/**
 * One registered endpoint. Generic over the parsed-input shape so handlers
 * get type-safe `parsed` access without `any`.
 *
 * `id` is a stable identifier (e.g. `'flow-runs.list'`) used for logging,
 * tracing, and adapter-side dedup. It does NOT affect routing.
 */
export interface FlowlibHttpEndpoint<Parsed = undefined> {
  id: string;
  method: FlowlibHttpMethod;
  /**
   * Path expressed in the same `:param` / `*` syntax as plugin endpoints
   * (see `plugin-endpoints/match.ts`). Adapters that mount the endpoint into
   * their native router translate the syntax into the framework's form
   * (Express `:id`, Next.js catch-all + manual match, etc.).
   */
  path: string;
  auth: EndpointAuth;
  /**
   * Optional parser. Receives the normalized request, returns the typed
   * `Parsed` value the handler will see. Throwing here flows through the
   * shared `classifyHttpError` path (so a `ZodError` becomes a 400, etc.).
   */
  parse?: (request: FlowlibHttpRequest) => Parsed | Promise<Parsed>;
  handle: (ctx: EndpointHandlerContext<Parsed>) => FlowlibHttpResult | Promise<FlowlibHttpResult>;
}

/**
 * Helper for declaring endpoints with full type inference on `Parsed`.
 *
 * Without this, callers either have to spell out the generic explicitly or
 * widen `parsed` to `unknown`. Wrapping the literal in `defineEndpoint(...)`
 * lets TypeScript infer `Parsed` from the parser's return type.
 */
export function defineEndpoint<Parsed>(
  endpoint: FlowlibHttpEndpoint<Parsed>,
): FlowlibHttpEndpoint<Parsed> {
  return endpoint;
}
