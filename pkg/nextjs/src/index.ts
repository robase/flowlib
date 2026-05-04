import type { FlowlibConfig, FlowlibIdentity, FlowlibInstance } from '@flowlib/core';
import {
  allFirstPartyEndpoints,
  classifyHttpError,
  dispatchPluginEndpoint,
  matchHttpEndpoint,
  normaliseHttpMethod,
  parseBooleanQueryParam,
  runEndpoint,
  type FlowlibHttpRequest,
} from '@flowlib/http';

type CoreModule = typeof import('@flowlib/core');

let coreModule: CoreModule | null = null;

const loadCoreModule = async (): Promise<CoreModule> => {
  if (!coreModule) {
    coreModule = await import('@flowlib/core');
  }

  return coreModule;
};

/**
 * Flowlib Next.js API Route Handler
 *
 * Usage in your Next.js app:
 *
 * // app/api/flowlib/[...flowlib]/route.ts
 * import { createFlowlibHandler } from "@flowlib/nextjs";
 *
 * const config = { ... }; // Your Flowlib config
 * const handler = createFlowlibHandler(config);
 *
 * export const GET = handler.GET;
 * export const POST = handler.POST;
 * export const PATCH = handler.PATCH;
 * export const PUT = handler.PUT;
 * export const DELETE = handler.DELETE;
 */

interface FlowlibHandler {
  GET: (request: Request, context: { params: Promise<{ flowlib: string[] }> }) => Promise<Response>;
  POST: (
    request: Request,
    context: { params: Promise<{ flowlib: string[] }> },
  ) => Promise<Response>;
  PATCH: (
    request: Request,
    context: { params: Promise<{ flowlib: string[] }> },
  ) => Promise<Response>;
  PUT: (request: Request, context: { params: Promise<{ flowlib: string[] }> }) => Promise<Response>;
  DELETE: (
    request: Request,
    context: { params: Promise<{ flowlib: string[] }> },
  ) => Promise<Response>;
}

// Thin shim around the shared boolean parser — Next's URLSearchParams returns
// `string | null` from `.get(key)`. Used by the cron-pre-handler below.
const parseBooleanSearchParam = (value: string | null): boolean | undefined =>
  parseBooleanQueryParam(value);

const disableBackgroundWorkers = async (core: FlowlibInstance): Promise<void> => {
  await core.stopBatchPolling();
  await core.stopMaintenancePolling();
  core.stopCronScheduler();
};

export function createFlowlibHandler(config: FlowlibConfig): FlowlibHandler {
  let core: FlowlibInstance | null = null;
  let initializationPromise: Promise<void> | null = null;
  let initError: Error | null = null;

  // eslint-disable-next-line no-console
  console.log('[flowlib-nextjs] createFlowlibHandler called', {
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PHASE: process.env.NEXT_PHASE,
    VERCEL_ENV: process.env.VERCEL_ENV,
    VERCEL_REGION: process.env.VERCEL_REGION,
    hasDatabaseConfig: !!config.database,
    databaseType: config.database?.type,
  });

  // Lazy initialization - only initialize when first request comes in
  const ensureInitialized = async (): Promise<FlowlibInstance> => {
    if (core) {
      return core;
    }

    if (initError) {
      // eslint-disable-next-line no-console
      console.error(
        '[flowlib-nextjs] Previous initialization failed, retrying...',
        initError.message,
      );
      initializationPromise = null;
      initError = null;
    }

    if (!initializationPromise) {
      initializationPromise = (async () => {
        const startTime = Date.now();
        try {
          // Detect Next.js build-phase here (the adapter, not core). Core no
          // longer sniffs `process.env` so it stays portable to edge runtimes —
          // the build-phase check belongs to the framework adapter. We also
          // pass `skipDatabaseInit: true` defensively in case any wrapper
          // caches this branch differently.
          const isBuildPhase =
            process.env.NODE_ENV === 'production' &&
            process.env.NEXT_PHASE === 'phase-production-build';
          if (isBuildPhase) {
            throw new Error('Skipping database initialization during build');
          }

          // eslint-disable-next-line no-console
          console.log('[flowlib-nextjs] Loading @flowlib/core module...');
          const { createFlowlib } = await loadCoreModule();
          // eslint-disable-next-line no-console
          console.log(`[flowlib-nextjs] Core module loaded in ${Date.now() - startTime}ms`);

          // eslint-disable-next-line no-console
          console.log('[flowlib-nextjs] Calling createFlowlib()...');
          core = await createFlowlib(config);
          // eslint-disable-next-line no-console
          console.log(`[flowlib-nextjs] createFlowlib() completed in ${Date.now() - startTime}ms`);

          await disableBackgroundWorkers(core);
          // eslint-disable-next-line no-console
          console.log(
            `[flowlib-nextjs] ✅ Flowlib fully initialized for serverless routing in ${Date.now() - startTime}ms`,
          );
        } catch (error) {
          const elapsed = Date.now() - startTime;
          // eslint-disable-next-line no-console
          console.error(`[flowlib-nextjs] ❌ Initialization failed after ${elapsed}ms:`, error);
          // eslint-disable-next-line no-console
          console.error('[flowlib-nextjs] Error details:', {
            name: error instanceof Error ? error.name : 'unknown',
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
          });
          core = null;
          initError = error instanceof Error ? error : new Error(String(error));
          initializationPromise = null;
          throw error;
        }
      })();
    }

    await initializationPromise;

    if (!core) {
      throw new Error('Flowlib Core failed to initialize');
    }

    return core;
  };

  // Helper function to get initialized core
  const getInitializedCore = async (): Promise<FlowlibInstance | Response> => {
    try {
      return await ensureInitialized();
    } catch (error) {
      // The DatabaseService startup checks already log detailed, helpful
      // messages to the console. Avoid duplicating them — just log a short
      // pointer so the developer knows where to look.
      const errMsg = error instanceof Error ? error.message : String(error);

      // Only log the full error if it's NOT one of our own startup-check
      // errors (those have already been logged with the big banner).
      const isStartupCheckError =
        (errMsg.includes('missing') && errMsg.includes('table')) ||
        errMsg.includes('DATABASE NOT READY') ||
        errMsg.includes('DATABASE CONNECTION FAILED') ||
        errMsg.includes('connectivity check failed');

      if (!isStartupCheckError) {
        // eslint-disable-next-line no-console
        console.error('Flowlib initialization failed:', error);
      }

      return Response.json(
        {
          error: 'Service Unavailable',
          message: errMsg,
        },
        { status: 503 },
      );
    }
  };

  // Delegate classification to the shared `@flowlib/http` helper so all
  // adapters return the same body/status for the same input error.
  const handleError = (error: unknown): Response => {
    const { status, body } = classifyHttpError(error);
    if (status >= 500 && body.code === undefined) {
      // eslint-disable-next-line no-console
      console.error('Flowlib Handler Error:', error);
    }
    return Response.json(body, { status });
  };

  // Helper function to parse request body
  const parseRequestBody = async (request: Request) => {
    try {
      const contentType = request.headers.get('content-type');
      if (contentType?.includes('application/json')) {
        return await request.json();
      }
      return {};
    } catch {
      return {};
    }
  };

  // Route handler function
  const handleRequest = async (
    request: Request,
    context: { params: Promise<{ flowlib: string[] }> },
  ): Promise<Response> => {
    const requestStart = Date.now();
    try {
      const params = await context.params;
      const path = params.flowlib.join('/');
      const method = request.method;
      // eslint-disable-next-line no-console
      console.log(`[flowlib-nextjs] ${method} /${path} (core initialized: ${!!core})`);

      // Get initialized core
      const coreOrResponse = await getInitializedCore();
      if (coreOrResponse instanceof Response) {
        // eslint-disable-next-line no-console
        console.error(
          `[flowlib-nextjs] ${method} /${path} → 503 (init failed, ${Date.now() - requestStart}ms)`,
        );
        return coreOrResponse;
      }
      const initializedCore = coreOrResponse;
      // eslint-disable-next-line no-console
      console.log(
        `[flowlib-nextjs] ${method} /${path} core ready in ${Date.now() - requestStart}ms`,
      );

      // Clone the request before consuming the body so plugin handlers
      // (e.g. user-auth) can read the raw body stream themselves.
      const requestClone = request.clone();

      const body = await parseRequestBody(request);
      const url = new URL(request.url);
      const searchParams = url.searchParams;

      // =====================================
      // SHARED ENDPOINT REGISTRY DISPATCH
      //
      // All first-party routes live as `FlowlibHttpEndpoint` records under
      // `@flowlib/http/endpoints/*`. The combined registry below covers every
      // first-party route the previous inline handler implemented (~50 routes
      // across 10 slices). Plugin endpoints are dispatched separately below
      // because they have their own `onRequest` hook semantics.
      //
      // Auth: identity is `null` for first-party Next.js routes today (Next
      // doesn't run plugin `onRequest` hooks for non-plugin paths). With the
      // default `auth.enabled: false`, `flowlib.auth.authorize()` returns
      // `allowed: true` and behaviour matches the previous inline handler.
      // =====================================
      {
        const httpMethod = normaliseHttpMethod(method);
        const fullPath = '/' + path;
        const matched = matchHttpEndpoint(allFirstPartyEndpoints, httpMethod, fullPath);
        if (matched) {
          const headers: Record<string, string | undefined> = {};
          request.headers.forEach((v, k) => {
            headers[k] = v;
          });
          const httpRequest: FlowlibHttpRequest = {
            method: httpMethod,
            path: fullPath,
            params: matched.params,
            searchParams,
            headers,
            body,
            identity: null,
            webRequest: requestClone,
            rawRequest: request,
          };
          const result = await runEndpoint(matched.endpoint, httpRequest, {
            flowlib: initializedCore,
            params: matched.params,
          });
          if (result.kind === 'response') {
            return result.response;
          }
          if (result.kind === 'stream') {
            return new Response(result.stream, {
              status: result.status,
              headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                Connection: 'keep-alive',
                'X-Accel-Buffering': 'no',
                ...result.headers,
              },
            });
          }
          if (result.body === null || result.body === undefined) {
            return new Response(null, { status: result.status, headers: result.headers });
          }
          return Response.json(result.body, {
            status: result.status,
            headers: result.headers,
          });
        }
      }

      // =====================================
      // PLUGIN ENDPOINTS
      // Delegate to plugin-defined routes under the plugins/ prefix
      // =====================================
      if (path.startsWith('plugins/')) {
        const pluginPath = '/' + path.replace(/^plugins\/?/, '');
        const httpMethod = normaliseHttpMethod(method);

        // Resolve identity for this request by running plugin onRequest hooks.
        // The auth plugin writes the resolved session identity onto the context object.
        // Express/NestJS run this in global middleware; Next.js does it inline.
        const pluginRequestContext = {
          path: pluginPath,
          method,
          identity: null as FlowlibIdentity | null,
        };
        const hookResult = await initializedCore.plugins
          .getHookRunner()
          .runOnRequest(requestClone.clone(), pluginRequestContext);
        if (hookResult.intercepted && hookResult.response) {
          return hookResult.response;
        }

        const headers: Record<string, string | undefined> = {};
        request.headers.forEach((v, k) => {
          headers[k] = v;
        });

        const result = await dispatchPluginEndpoint({
          flowlib: initializedCore,
          pluginPath,
          method: httpMethod,
          database: (await loadCoreModule()).createPluginDatabaseApi(
            initializedCore.plugins.getDatabaseConnection(),
          ),
          request: {
            method: httpMethod,
            path: pluginPath,
            params: {},
            searchParams,
            headers,
            body,
            identity: pluginRequestContext.identity,
            webRequest: requestClone,
            rawRequest: request,
          },
        });

        if (result.kind === 'response') {
          return result.response;
        }
        if (result.kind === 'stream') {
          return new Response(result.stream, {
            status: result.status,
            headers: { 'Content-Type': 'text/event-stream', ...result.headers },
          });
        }
        return Response.json(result.body, {
          status: result.status,
          headers: result.headers,
        });
      }

      // Route not found
      // eslint-disable-next-line no-console
      console.warn(
        `[flowlib-nextjs] ${method} /${path} → 404 (no matching route, ${Date.now() - requestStart}ms)`,
      );
      return Response.json(
        {
          error: 'Not Found',
          message: `Route ${method} /${path} not found`,
        },
        { status: 404 },
      );
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`[flowlib-nextjs] Request error (${Date.now() - requestStart}ms):`, error);
      return handleError(error);
    }
  };

  return {
    GET: handleRequest,
    POST: handleRequest,
    PATCH: handleRequest,
    PUT: handleRequest,
    DELETE: handleRequest,
  };
}

/**
 * Convenience function for creating a simple handler when you don't need catch-all routing
 * This creates individual route handlers for specific endpoints
 */
export function createFlowlibEndpoint(config: FlowlibConfig) {
  let core: FlowlibInstance | null = null;
  let initializationPromise: Promise<void> | null = null;

  const ensureInitialized = async (): Promise<FlowlibInstance> => {
    if (core) {
      return core;
    }

    if (!initializationPromise) {
      initializationPromise = (async () => {
        try {
          const { createFlowlib } = await loadCoreModule();
          core = await createFlowlib(config);
          await disableBackgroundWorkers(core);
          // eslint-disable-next-line no-console
          console.log('✅ Flowlib initialized with background workers disabled');
        } catch (error) {
          // eslint-disable-next-line no-console
          console.error('Failed to initialize Flowlib Core:', error);
          core = null;
          initializationPromise = null;
          throw error;
        }
      })();
    }

    await initializationPromise;

    if (!core) {
      throw new Error('Flowlib Core failed to initialize');
    }

    return core;
  };

  return {
    core: () => core,

    // Helper to create individual endpoint handlers
    createEndpoint: (handler: (core: FlowlibInstance, request: Request) => Promise<Response>) => {
      return async (request: Request) => {
        try {
          const initializedCore = await ensureInitialized();
          return await handler(initializedCore, request);
        } catch (error) {
          const { status, body } = classifyHttpError(error);
          if (status >= 500 && body.code === undefined) {
            // eslint-disable-next-line no-console
            console.error('Flowlib Endpoint Error:', error);
          }
          return Response.json(body, { status });
        }
      };
    },
  };
}

/**
 * Create a dedicated maintenance handler for serverless cron invocations.
 *
 * Intended for routes like /api/flowlib/cron that are triggered by Vercel Cron.
 * The handler performs one maintenance pass that:
 * - polls pending batch jobs
 * - resumes flows paused for batch completion
 * - fails stale runs
 * - executes due Flowlib cron triggers
 */
export function createFlowlibCronHandler(config: FlowlibConfig) {
  let core: FlowlibInstance | null = null;
  let initializationPromise: Promise<void> | null = null;

  const ensureInitialized = async (): Promise<FlowlibInstance> => {
    if (core) {
      return core;
    }

    if (!initializationPromise) {
      initializationPromise = (async () => {
        try {
          const { createFlowlib } = await loadCoreModule();
          core = await createFlowlib(config);
          await disableBackgroundWorkers(core);
        } catch (error) {
          core = null;
          initializationPromise = null;
          throw error;
        }
      })();
    }

    await initializationPromise;

    if (!core) {
      throw new Error('Flowlib Core failed to initialize');
    }

    return core;
  };

  return async function handleCron(request: Request): Promise<Response> {
    if (request.method !== 'GET') {
      return new Response(null, {
        status: 405,
        headers: { Allow: 'GET' },
      });
    }

    try {
      const initializedCore = await ensureInitialized();
      const searchParams = new URL(request.url).searchParams;
      const result = await initializedCore.runMaintenance({
        now: searchParams.get('now') ?? undefined,
        pollBatchJobs: parseBooleanSearchParam(searchParams.get('pollBatchJobs')),
        resumePausedFlows: parseBooleanSearchParam(searchParams.get('resumePausedFlows')),
        failStaleRuns: parseBooleanSearchParam(searchParams.get('failStaleRuns')),
        executeCronTriggers: parseBooleanSearchParam(searchParams.get('executeCronTriggers')),
      });

      return Response.json({ ok: true, ...result });
    } catch (error) {
      const { status, body } = classifyHttpError(error);
      if (status >= 500 && body.code === undefined) {
        // eslint-disable-next-line no-console
        console.error('Flowlib Cron Handler Error:', error);
      }
      return Response.json(body, { status });
    }
  };
}

// Re-export types from core for convenience
export type { FlowlibConfig, FlowlibInstance } from '@flowlib/core';

export async function createFlowlib(config: FlowlibConfig): Promise<FlowlibInstance> {
  const { createFlowlib: createCoreFlowlib } = await loadCoreModule();
  return createCoreFlowlib(config);
}
