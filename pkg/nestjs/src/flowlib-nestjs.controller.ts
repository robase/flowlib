import { All, Controller, Inject, Req, Res } from '@nestjs/common';
import { createPluginDatabaseApi } from '@flowlib/core';
import type { FlowlibIdentity, FlowlibInstance } from '@flowlib/core';
import {
  allFirstPartyEndpoints,
  dispatchPluginEndpoint,
  matchHttpEndpoint,
  normaliseHttpMethod,
  runEndpoint,
  toWebRequestFromExpress,
  writeFlowlibHttpResultToExpress,
  writeWebResponseToExpress,
  type FlowlibHttpRequest,
} from '@flowlib/http';
import type { Request, Response } from 'express';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      flowlibIdentity?: FlowlibIdentity | null;
    }
  }
}

@Controller()
export class FlowlibController {
  constructor(@Inject('FLOWLIB_CORE') private readonly flowlib: FlowlibInstance) {}

  /**
   * Plugin endpoint catch-all. Stays first because Nest matches decorators
   * in declaration order — the broader `@All('*')` below would otherwise
   * shadow this.
   *
   * Plugin endpoints have separate dispatch semantics (their own
   * `onRequest` hook chain, plugin-supplied database adapter), so they go
   * through `dispatchPluginEndpoint`, not the first-party registry.
   */
  @All('plugins/*pluginPath')
  async handlePluginEndpoint(@Req() req: Request, @Res() res: Response): Promise<void> {
    // Same wildcard-capture trick as `dispatchAny` below — Nest's
    // `setGlobalPrefix` leaves `req.path` prefixed, but `req.params.pluginPath`
    // (array) holds the segments after `plugins/` regardless of any global
    // prefix the host added.
    const captured = (req.params as Record<string, unknown>).pluginPath;
    const pluginPath = Array.isArray(captured)
      ? '/' + (captured as string[]).join('/')
      : typeof captured === 'string'
        ? '/' + captured
        : (req.path as string).replace(/^.*\/plugins/, '') || '/';
    const method = normaliseHttpMethod(req.method);

    const webRequest = toWebRequestFromExpress({
      method: req.method,
      protocol: req.protocol,
      originalUrl: req.originalUrl,
      headers: req.headers,
      body: req.body || {},
      get: (name: string) => req.get(name),
    });

    const result = await dispatchPluginEndpoint({
      flowlib: this.flowlib,
      pluginPath,
      method,
      database: createPluginDatabaseApi(this.flowlib.plugins.getDatabaseConnection()),
      request: {
        method,
        path: pluginPath,
        params: {},
        rawQuery: req.query,
        searchParams: new URL(webRequest.url).searchParams,
        headers: req.headers as Record<string, string | undefined>,
        body: req.body || {},
        identity: req.flowlibIdentity ?? null,
        webRequest,
        rawRequest: req,
      },
    });

    // Auth-proxy plugins issue redirects with multiple Set-Cookie headers,
    // which `writeFlowlibHttpResultToExpress` preserves only for the
    // `kind: 'response'` branch (via `writeWebResponseToExpress`). The other
    // branches already go through that helper so behaviour is unified.
    if (result.kind === 'response') {
      await writeWebResponseToExpress(result.response, res);
      return;
    }
    await writeFlowlibHttpResultToExpress(result, res);
  }

  /**
   * First-party catch-all. Walks the shared `@flowlib/http` registries in
   * order; first match wins. Auth + parsing + error classification all run
   * through `runEndpoint`, identical to the Express + Next.js adapters.
   *
   * The plan's phase 7 (originally "thin wrappers around shared handlers")
   * has now consolidated to a true catch-all. Nest's exception filters and
   * route-metadata introspection still see this as a single `@All` mount —
   * any consumer that relied on per-route metadata for auth or rate-limiting
   * would have already broken under the registry contract since `runEndpoint`
   * decides everything before the handler runs.
   */
  @All('*path')
  async dispatchAny(@Req() req: Request, @Res() res: Response): Promise<void> {
    const method = normaliseHttpMethod(req.method);
    // Nest's `setGlobalPrefix(...)` doesn't populate Express's `req.baseUrl`,
    // so `req.path` includes the prefix (e.g. `/flowlib/flows/list`). The
    // wildcard match in `@All('*path')` captures the unprefixed segments
    // into `req.params.path` (array form under path-to-regexp v6+, single
    // string under older versions). Reconstruct the registry-shape path
    // from those segments — that's what's mount-relative regardless of
    // whatever global prefix the host configured.
    const wildcardParam = (req.params as Record<string, unknown>).path;
    const path = Array.isArray(wildcardParam)
      ? '/' + (wildcardParam as string[]).join('/')
      : typeof wildcardParam === 'string'
        ? '/' + wildcardParam
        : req.path;

    const matched = matchHttpEndpoint(allFirstPartyEndpoints, method, path);

    if (!matched) {
      res.status(404).json({
        error: 'Not Found',
        message: `Route ${method} ${path} not found`,
      });
      return;
    }

    // Forward client disconnect to the handler so SSE streams cancel
    // promptly. Express emits 'close' on `req` when the socket disconnects.
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
      method,
      path,
      params: matched.params,
      rawQuery: req.query,
      searchParams: new URL(webRequest.url).searchParams,
      headers: req.headers as Record<string, string | undefined>,
      body: req.body,
      identity: req.flowlibIdentity ?? null,
      webRequest,
      rawRequest: req,
    };
    const result = await runEndpoint(matched.endpoint, httpRequest, {
      flowlib: this.flowlib,
      params: matched.params,
    });
    await writeFlowlibHttpResultToExpress(result, res);
  }
}
