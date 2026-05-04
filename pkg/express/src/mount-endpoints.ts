/**
 * Walk a list of `FlowlibHttpEndpoint` records and register them on an
 * Express `Router`.
 *
 * The endpoint registry (declared in `@flowlib/http/endpoints/*`) carries
 * method, path (in `:param` syntax), auth metadata, optional parser, and
 * handler. Express's path syntax is identical to the registry's, so paths
 * pass through verbatim. Per-route auth, parsing, and result-classification
 * are handled by the shared `runEndpoint` dispatcher; this helper is just
 * the glue between Express's per-request callback and the dispatcher.
 *
 * Auth note: identity comes from `req.flowlibIdentity`, which the global
 * onRequest middleware in `flowlib-router.ts` populates. The shared
 * dispatcher then runs `flowlib.auth.authorize()` (so plugin `onAuthorize`
 * hooks fire), matching the behaviour of the previous inline
 * `requirePermission()` middleware.
 */

import type { Router, Request, Response } from 'express';
import type { FlowlibIdentity, FlowlibInstance } from '@flowlib/core';
import {
  runEndpoint,
  toWebRequestFromExpress,
  writeFlowlibHttpResultToExpress,
  type FlowlibHttpEndpoint,
  type FlowlibHttpRequest,
} from '@flowlib/http';

declare module 'express' {
  interface Request {
    flowlibIdentity?: FlowlibIdentity | null;
  }
}

const METHOD_TO_REGISTRAR = {
  GET: 'get',
  POST: 'post',
  PUT: 'put',
  PATCH: 'patch',
  DELETE: 'delete',
} as const;

export function mountFlowlibEndpoints(
  router: Router,
  flowlib: FlowlibInstance,
  endpoints: readonly FlowlibHttpEndpoint<unknown>[],
): void {
  for (const endpoint of endpoints) {
    const verb = METHOD_TO_REGISTRAR[endpoint.method];
    router[verb](endpoint.path, async (req: Request, res: Response) => {
      // Propagate client disconnect to the handler via AbortSignal so SSE
      // streams can cancel their event loops promptly. Express triggers
      // 'close' on `req` when the socket disconnects.
      const abortController = new AbortController();
      req.on('close', () => abortController.abort());

      const webRequest = toWebRequestFromExpress({
        method: req.method,
        protocol: req.protocol,
        originalUrl: req.originalUrl,
        headers: req.headers,
        body: req.body,
        get: (name: string) => req.get(name),
        signal: abortController.signal,
      });
      const httpRequest: FlowlibHttpRequest = {
        method: endpoint.method,
        path: req.path,
        // Filled in by `runEndpoint` from `input.params` below — the shared
        // dispatcher overlays the matched router params before calling
        // `parse` / `handle`, so leaving this empty here is fine.
        params: {},
        rawQuery: req.query,
        searchParams: new URL(webRequest.url).searchParams,
        headers: req.headers as Record<string, string | undefined>,
        body: req.body,
        identity: req.flowlibIdentity ?? null,
        webRequest,
        rawRequest: req,
      };
      const result = await runEndpoint(endpoint, httpRequest, {
        flowlib,
        params: req.params as Record<string, string>,
      });
      await writeFlowlibHttpResultToExpress(result, res);
    });
  }
}
