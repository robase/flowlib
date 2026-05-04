import { Router, json } from 'express';
import type { Request, Response, NextFunction } from 'express';
import {
  createFlowlib,
  FlowlibConfig,
  FlowlibIdentity,
  createPluginDatabaseApi,
} from '@flowlib/core';
import {
  allFirstPartyEndpoints,
  classifyHttpError,
  dispatchPluginEndpoint,
  normaliseHttpMethod,
  toWebRequestFromExpress,
  writeFlowlibHttpResultToExpress,
  writeWebResponseToExpress,
} from '@flowlib/http';
import { mountFlowlibEndpoints } from './mount-endpoints';

// Extend Express Request type to include Flowlib identity
declare module 'express' {
  interface Request {
    /** Flowlib identity resolved from host app auth */
    flowlibIdentity?: FlowlibIdentity | null;
  }
}

/**
 * Create Flowlib Express Router
 */
export async function createFlowlibRouter(config: FlowlibConfig): Promise<Router> {
  const flowlib = await createFlowlib(config);

  // Start batch polling for automatic batch completion handling
  await flowlib.startBatchPolling();

  // Start cron scheduler for automatic cron trigger execution
  await flowlib.startCronScheduler();

  const router = Router();

  router.use(json({ limit: '10mb' }));

  // =====================================
  // AUTHENTICATION MIDDLEWARE
  // =====================================

  /**
   * Auth middleware - resolves identity from host app and attaches to request.
   *
   * The host app provides a `resolveUser` callback in the config that extracts
   * the user identity from the request (e.g., from JWT, session, API key).
   */
  router.use(async (req: Request, res: Response, next: NextFunction) => {
    // Always run plugin onRequest hooks so that identity is resolved even
    // when auth enforcement is disabled.  Plugins such as @flowlib/user-auth
    // populate the identity from session cookies in this hook.
    try {
      // No body forwarded for the global onRequest hook — auth-proxy bodies
      // are consumed inside the plugin endpoint dispatcher (see below), not
      // by the identity-resolution pass.
      const webRequest = toWebRequestFromExpress({
        method: req.method,
        protocol: req.protocol,
        originalUrl: req.originalUrl,
        headers: req.headers,
        get: (name: string) => req.get(name),
      });
      const hookContext = {
        path: req.path,
        method: req.method,
        identity: null as FlowlibIdentity | null,
      };

      const hookResult = await flowlib.plugins
        .getHookRunner()
        .runOnRequest(webRequest, hookContext);
      if (hookResult.intercepted && hookResult.response) {
        await writeWebResponseToExpress(hookResult.response, res);
        return;
      }

      req.flowlibIdentity = hookContext.identity ?? null;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Auth resolution error:', error);
      req.flowlibIdentity = null;
    }

    next();
  });

  // =====================================
  // FIRST-PARTY ROUTES (shared registry)
  //
  // All first-party routes are declared as `FlowlibHttpEndpoint` records in
  // `@flowlib/http/endpoints/*`. The canonical ordered array
  // `allFirstPartyEndpoints` is the single source of truth — adding a slice
  // there picks it up on every adapter without further wiring.
  //
  // Each route runs through the shared `runEndpoint` pipeline (auth + parse
  // + handle + classify). Auth uses `flowlib.auth.authorize()` so plugin
  // `onAuthorize` hooks fire on every first-party route, not just plugin
  // endpoints.
  // =====================================
  mountFlowlibEndpoints(router, flowlib, allFirstPartyEndpoints);

  // =====================================
  // PLUGIN ENDPOINTS
  // Mount API endpoints defined by plugins via flowlib.plugins.getEndpoints()
  // =====================================
  router.all('/plugins/*path', async (req: Request, res: Response) => {
    // Strip the /plugins prefix — endpoint paths are defined relative to it.
    // e.g. req.path="/plugins/auth/api/auth/sign-in/email" → "/auth/api/auth/sign-in/email"
    const pluginPath = (req.path || '/').replace(/^\/plugins/, '') || '/';
    const method = normaliseHttpMethod(req.method);

    // Build a Web Request once — better-auth and other auth-proxy plugins
    // call `request.json()` / `request.headers.get(...)` on it.
    const webRequest = toWebRequestFromExpress({
      method: req.method,
      protocol: req.protocol,
      originalUrl: req.originalUrl,
      headers: req.headers,
      body: req.body || {},
      get: (name: string) => req.get(name),
    });

    // Delegate match → authorize → invoke to the shared dispatcher.
    // Authorization runs through `flowlib.auth.authorize()` (not raw
    // `hasPermission()`), so plugin `onAuthorize` hooks are honoured.
    const result = await dispatchPluginEndpoint({
      flowlib,
      pluginPath,
      method,
      database: createPluginDatabaseApi(flowlib.plugins.getDatabaseConnection()),
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

    await writeFlowlibHttpResultToExpress(result, res);
  });

  // Error handling middleware - must be last. Delegates classification
  // to the shared `@flowlib/http` helper so all framework adapters return
  // the same body/status for the same input error.
  router.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
    const { status, body } = classifyHttpError(error);
    // Log unexpected (5xx) errors that didn't carry a typed status — these
    // are the cases the caller hasn't anticipated.
    if (status >= 500 && body.code === undefined) {
      // eslint-disable-next-line no-console
      console.error('Flowlib Router Error:', error);
    }
    res.status(status).json(body);
  });

  return router;
}
