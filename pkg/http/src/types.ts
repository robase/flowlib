/**
 * Transport-neutral HTTP types shared across Flowlib's framework adapters.
 *
 * These describe the *contract* between an adapter's host-request bridge and
 * the shared dispatch + auth helpers. They're deliberately not a full
 * generic router yet — phase 2 of the shared-HTTP plan only standardises
 * request context + auth, route registration is phase 4.
 */

import type { FlowlibIdentity, FlowlibPermission, FlowlibResourceType } from '@flowlib/core';

/**
 * HTTP method shape every adapter agrees on. NestJS supports more (HEAD,
 * OPTIONS) but Flowlib's route surface uses these five.
 */
export type FlowlibHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * Normalized request shape for shared endpoint handlers.
 *
 * Adapters are responsible for producing this from their host's native
 * request — see the per-adapter `toWebRequest` helpers in phase 2.4.
 *
 * The important invariant: `rawQuery` and `searchParams` describe the same
 * data via different parsers. Adapters that already have a parsed query
 * (Express via `qs`) populate `rawQuery`; adapters that work from the URL
 * (Next.js) populate `searchParams`. Shared parsing helpers accept either.
 */
export interface FlowlibHttpRequest {
  method: FlowlibHttpMethod;
  /** Path WITHOUT the API prefix (e.g. `/flows/:id`, not `/api/flowlib/flows/:id`). */
  path: string;
  /** Path-param map (e.g. `{ flowId: 'abc' }`). */
  params: Record<string, string>;
  /** Host-framework's already-parsed query object (Express `req.query`). May be undefined. */
  rawQuery?: unknown;
  /** URL-level normalised query — preferred when the host has a real `URL`. */
  searchParams: URLSearchParams;
  /** Header map. Both lower-cased and original-case keys may be present depending on host. */
  headers: Record<string, string | undefined>;
  /** Already-parsed body (Express `req.body`, JSON-decoded fetch body). May be `undefined`. */
  body: unknown;
  /** Resolved identity if any. Populated by the auth pipeline before the handler runs. */
  identity?: FlowlibIdentity | null;
  /** Real Web `Request`, used for plugin hooks and auth-proxy passthrough. */
  webRequest: Request;
  /** Original host request object. Adapters that need it can cast back. */
  rawRequest?: unknown;
}

/**
 * Result of running an endpoint handler. Adapters translate this into their
 * native response (`res.json()`, `Response.json()`, NestJS controller return).
 *
 * Three shapes:
 *   - `json` — most common, plain JSON body with explicit status
 *   - `response` — passthrough of a Web `Response` (used by auth proxies that
 *     need cookie-bearing redirects with multiple `Set-Cookie` headers)
 *   - `stream` — SSE / chunked response. Body framing stays adapter-specific.
 */
export type FlowlibHttpResult =
  | { kind: 'json'; status: number; body: unknown; headers?: Record<string, string> }
  | { kind: 'response'; response: Response }
  | {
      kind: 'stream';
      status: number;
      headers?: Record<string, string>;
      stream: ReadableStream;
    };

/**
 * Auth requirement attached to a shared endpoint definition.
 *
 * `public` — no identity required. The endpoint runs unauthenticated.
 * `protected` — identity required. The shared `authorizeEndpoint` helper
 *   will call `flowlib.auth.authorize()` with the resolved identity, the
 *   declared permission, and (optionally) a resource derived from the
 *   request. This routes through plugin `onAuthorize` hooks and DB-backed
 *   access checks the same way per-adapter middleware does today.
 */
export type EndpointAuth =
  | { kind: 'public' }
  | {
      kind: 'protected';
      permission: FlowlibPermission;
      /**
       * Optional callback to extract `{ type, id }` for resource-level RBAC
       * (the RBAC plugin's `onAuthorize` hook needs this for per-flow ACL
       * checks). When omitted, only the permission is checked.
       */
      getResource?: (
        request: FlowlibHttpRequest,
      ) => { type: FlowlibResourceType; id?: string } | undefined;
    };

/**
 * The request context after the auth pipeline has run.
 *
 * Phase 2.4 adapters convert their host request into a `FlowlibHttpRequest`,
 * run plugin `onRequest` hooks (which may resolve identity AND/OR short-
 * circuit with a `Response`), then hand a `ResolvedHttpRequestContext` to
 * the shared dispatcher.
 */
export interface ResolvedHttpRequestContext {
  request: FlowlibHttpRequest;
  webRequest: Request;
  identity: FlowlibIdentity | null;
  /**
   * Set when `onRequest` returned a `Response` (e.g. unauthenticated request
   * blocked by the auth plugin). The dispatcher should write this back
   * verbatim instead of running the endpoint handler.
   */
  intercepted?: Response;
}
