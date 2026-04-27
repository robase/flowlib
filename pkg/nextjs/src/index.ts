import type {
  BatchProvider,
  CredentialFilters,
  FlowlibConfig,
  FlowlibIdentity,
  FlowlibInstance,
} from '@flowlib/core';
import { ZodError } from 'zod';

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
  POST: (request: Request, context: { params: Promise<{ flowlib: string[] }> }) => Promise<Response>;
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

const parseParamsFromSearch = (value: string | null): Record<string, unknown> => {
  if (!value) {
    return {};
  }

  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
};

const parseBooleanSearchParam = (value: string | null): boolean | undefined => {
  if (value === null) {
    return undefined;
  }

  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  return undefined;
};

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

  // Helper function to handle errors
  const handleError = (error: unknown): Response => {
    // Handle Zod validation errors
    if (error instanceof ZodError) {
      return Response.json(
        {
          error: 'Validation Error',
          message: 'Invalid request data',
          details: error.errors.map((err) => ({
            path: err.path.join('.'),
            message: err.message,
            code: err.code,
          })),
        },
        { status: 400 },
      );
    }

    // Handle other known errors
    if (error && typeof error === 'object' && 'name' in error && error.name === 'DatabaseError') {
      return Response.json(
        {
          error: 'Database Error',
          message: error instanceof Error ? error.message : 'A database error occurred',
        },
        { status: 500 },
      );
    }

    // Handle errors that carry their own statusCode (e.g. ValidationError, NotFoundError)
    if (
      error &&
      typeof error === 'object' &&
      'statusCode' in error &&
      typeof (error as { statusCode: unknown }).statusCode === 'number'
    ) {
      const statusCode = (error as { statusCode: number }).statusCode;
      const message = error instanceof Error ? error.message : 'An error occurred';
      const code =
        'code' in error && typeof (error as { code: unknown }).code === 'string'
          ? (error as { code: string }).code
          : undefined;
      return Response.json(
        {
          error: statusCode < 500 ? 'Bad Request' : 'Internal Server Error',
          message,
          ...(code ? { code } : {}),
        },
        { status: statusCode },
      );
    }

    // Handle generic errors
    // eslint-disable-next-line no-console
    console.error('Flowlib Handler Error:', error);
    return Response.json(
      {
        error: 'Internal Server Error',
        message: 'An unexpected error occurred',
      },
      { status: 500 },
    );
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
      // FLOW MANAGEMENT ROUTES
      // =====================================

      // GET /flows/list — simple GET endpoint
      if (method === 'GET' && path === 'flows/list') {
        const flows = await initializedCore.flows.list();
        return Response.json(flows);
      }

      if (method === 'POST' && path === 'flows/list') {
        const flows = await initializedCore.flows.list(body);
        return Response.json(flows);
      }

      if (method === 'POST' && path === 'flows') {
        const flow = await initializedCore.flows.create(body);
        return Response.json(flow, { status: 201 });
      }

      if (method === 'POST' && path === 'validate-flow') {
        const { flowId, flowDefinition } = body;
        const result = await initializedCore.flows.validate(flowId, flowDefinition);
        return Response.json(result);
      }

      // GET /flows/:flowId/react-flow
      if (method === 'GET' && path.match(/^flows\/[^/]+\/react-flow$/)) {
        const flowId = path.split('/')[1];
        const options: { version?: string; flowRunId?: string } = {};
        const version = searchParams.get('version');
        const flowRunId = searchParams.get('flowRunId');
        if (version) {
          options.version = version;
        }
        if (flowRunId) {
          options.flowRunId = flowRunId;
        }
        const result = await initializedCore.flows.renderToReactFlow(flowId, options);
        return Response.json(result);
      }

      // =====================================
      // FLOW VERSION MANAGEMENT ROUTES
      // =====================================

      if (method === 'POST' && path.match(/^flows\/[^/]+\/versions\/list$/)) {
        const flowId = path.split('/')[1];
        const versions = await initializedCore.versions.list(flowId, body);
        return Response.json(versions);
      }

      if (method === 'POST' && path.match(/^flows\/[^/]+\/versions$/) && !path.endsWith('/list')) {
        const flowId = path.split('/')[1];
        const version = await initializedCore.versions.create(flowId, body);
        return Response.json(version, { status: 201 });
      }

      if (method === 'GET' && path.match(/^flows\/[^/]+\/versions\/[^/]+$/)) {
        const parts = path.split('/');
        const flowId = parts[1];
        const version = parts[3];
        const flowVersion = await initializedCore.versions.get(flowId, version);
        if (!flowVersion) {
          return Response.json(
            { error: 'Not Found', message: `Version ${version} not found for flow ${flowId}` },
            { status: 404 },
          );
        }
        return Response.json(flowVersion);
      }

      // =====================================
      // FLOW RUN EXECUTION ROUTES
      // =====================================

      // POST /flows/:flowId/run-to-node/:nodeId
      if (method === 'POST' && path.match(/^flows\/[^/]+\/run-to-node\/[^/]+$/)) {
        const parts = path.split('/');
        const flowId = parts[1];
        const nodeId = parts[3];
        const { inputs = {}, options } = body;
        const result = await initializedCore.runs.executeToNode(flowId, nodeId, inputs, options);
        return Response.json(result, { status: 201 });
      }

      if (method === 'POST' && path.match(/^flows\/[^/]+\/run$/)) {
        const flowId = path.split('/')[1];
        const { inputs = {}, options } = body;
        const result = await initializedCore.runs.startAsync(flowId, inputs, options);
        return Response.json(result, { status: 201 });
      }

      if (method === 'POST' && path === 'flow-runs/list') {
        const flowRuns = await initializedCore.runs.list(body);
        return Response.json(flowRuns);
      }

      // POST /flow-runs/ephemeral and POST /runs/ephemeral
      // Run an inline definition without persisting it as a regular flow.
      // Body: { definition, inputs?, name? }
      // Credentials referenced inside the definition still resolve by ID
      // against the persisted credential store.
      if (method === 'POST' && (path === 'flow-runs/ephemeral' || path === 'runs/ephemeral')) {
        const { definition, inputs, name } = (body ?? {}) as {
          definition?: unknown;
          inputs?: Record<string, unknown>;
          name?: string;
        };
        if (!definition || typeof definition !== 'object') {
          return Response.json(
            {
              error: 'Bad Request',
              message: 'Body.definition (FlowlibDefinition) is required',
            },
            { status: 400 },
          );
        }
        const result = await initializedCore.runs.runEphemeral(definition as never, inputs ?? {}, {
          name,
        });
        return Response.json(result, { status: 201 });
      }

      if (method === 'POST' && path.match(/^flow-runs\/[^/]+\/resume$/)) {
        const flowRunId = path.split('/')[1];
        const result = await initializedCore.runs.resume(flowRunId);
        return Response.json(result);
      }

      if (method === 'POST' && path.match(/^flow-runs\/[^/]+\/cancel$/)) {
        const flowRunId = path.split('/')[1];
        const result = await initializedCore.runs.cancel(flowRunId);
        return Response.json(result);
      }

      if (method === 'POST' && path.match(/^flow-runs\/[^/]+\/pause$/)) {
        const flowRunId = path.split('/')[1];
        const { reason } = body;
        const result = await initializedCore.runs.pause(flowRunId, reason);
        return Response.json(result);
      }

      // GET /flow-runs/:flowRunId/node-executions
      if (method === 'GET' && path.match(/^flow-runs\/[^/]+\/node-executions$/)) {
        const flowRunId = path.split('/')[1];
        const page = searchParams.get('page');
        const limit = searchParams.get('limit');
        const sortBy = searchParams.get('sortBy');
        const sortOrder = searchParams.get('sortOrder');
        const options: Record<string, unknown> = {};
        const p = page ? parseInt(page, 10) : undefined;
        const l = limit ? parseInt(limit, 10) : undefined;
        if (p || l) {
          options.pagination = {
            page: p && p >= 1 ? p : 1,
            limit: l && l >= 1 ? Math.min(l, 100) : 50,
          };
        }
        if (sortBy) {
          options.sort = {
            sortBy,
            sortOrder: sortOrder === 'asc' || sortOrder === 'desc' ? sortOrder : 'desc',
          };
        }
        const nodeExecutions = await initializedCore.runs.getNodeExecutions(flowRunId, options);
        return Response.json(nodeExecutions);
      }

      // Shared SSE handler for run-events streaming.
      // Used by both `flow-runs/:flowRunId/stream` (canonical) and
      // `runs/:flowRunId/events` (alias for external clients).
      const buildRunEventsResponse = (flowRunId: string): Response => {
        const stream = initializedCore.runs.createEventStream(flowRunId);
        const encoder = new TextEncoder();

        // Track client disconnect via the request's AbortSignal so we don't
        // keep buffering events after the consumer is gone.
        const clientSignal = request.signal;

        const readable = new ReadableStream({
          async start(controller) {
            try {
              for await (const event of stream) {
                if (clientSignal?.aborted) {
                  break;
                }
                const data = JSON.stringify(event);
                controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${data}\n\n`));
              }
            } catch (error: unknown) {
              const message = error instanceof Error ? error.message : 'Stream failed';
              try {
                controller.enqueue(
                  encoder.encode(
                    `event: error\ndata: ${JSON.stringify({ type: 'error', message })}\n\n`,
                  ),
                );
              } catch {
                // Controller already closed by client disconnect — ignore.
              }
            } finally {
              try {
                controller.close();
              } catch {
                // Already closed — ignore.
              }
            }
          },
          cancel() {
            // Consumer aborted — best-effort no-op; the event-bus subscription
            // is unsubscribed by `createEventStream`'s `finally` block.
          },
        });

        return new Response(readable, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
          },
        });
      };

      // GET /flow-runs/:flowRunId/stream - SSE stream of execution events
      if (method === 'GET' && path.match(/^flow-runs\/[^/]+\/stream$/)) {
        const flowRunId = path.split('/')[1];
        return buildRunEventsResponse(flowRunId);
      }

      // GET /runs/:flowRunId/events - SSE stream alias for external clients.
      if (method === 'GET' && path.match(/^runs\/[^/]+\/events$/)) {
        const flowRunId = path.split('/')[1];
        return buildRunEventsResponse(flowRunId);
      }

      // GET /flows/:flowId/flow-runs
      if (method === 'GET' && path.match(/^flows\/[^/]+\/flow-runs$/)) {
        const flowId = path.split('/')[1];
        const page = searchParams.get('page');
        const limit = searchParams.get('limit');
        const sortBy = searchParams.get('sortBy');
        const sortOrder = searchParams.get('sortOrder');
        const options: Record<string, unknown> = {};
        const p = page ? parseInt(page, 10) : undefined;
        const l = limit ? parseInt(limit, 10) : undefined;
        if (p || l) {
          options.pagination = {
            page: p && p >= 1 ? p : 1,
            limit: l && l >= 1 ? Math.min(l, 100) : 20,
          };
        }
        if (sortBy) {
          options.sort = {
            sortBy,
            sortOrder: sortOrder === 'asc' || sortOrder === 'desc' ? sortOrder : 'desc',
          };
        }
        const flowRuns = await initializedCore.runs.listByFlowId(flowId, options);
        return Response.json(flowRuns);
      }

      // GET /flow-runs/:flowRunId (must come AFTER more specific flow-runs/ routes)
      if (method === 'GET' && path.match(/^flow-runs\/[^/]+$/)) {
        const flowRunId = path.split('/')[1];
        const flowRun = await initializedCore.runs.get(flowRunId);
        return Response.json(flowRun);
      }

      // =====================================
      // NODE EXECUTION ROUTES
      // =====================================

      if (method === 'POST' && path === 'node-executions/list') {
        const nodeExecutions = await initializedCore.runs.listNodeExecutions(body);
        return Response.json(nodeExecutions);
      }

      // =====================================
      // NODE DATA & TESTING ROUTES
      // =====================================

      if (method === 'POST' && path === 'node-data/test-expression') {
        const result = await initializedCore.testing.testJsExpression(body);
        return Response.json(result);
      }

      if (method === 'POST' && path === 'node-data/test-mapper') {
        const result = await initializedCore.testing.testMapper(body);
        return Response.json(result);
      }

      if (method === 'POST' && path === 'node-data/model-query') {
        const result = await initializedCore.testing.testModelPrompt(body);
        return Response.json(result);
      }

      if (method === 'GET' && path === 'node-data/models') {
        const credentialId = searchParams.get('credentialId');
        const providerParam = searchParams.get('provider');

        if (credentialId) {
          return Response.json(await initializedCore.testing.getModelsForCredential(credentialId));
        }
        if (providerParam) {
          const { BatchProvider } = await loadCoreModule();
          const normalized = providerParam.trim().toUpperCase();
          if (!Object.values(BatchProvider).includes(normalized as BatchProvider)) {
            return Response.json(
              { error: 'INVALID_PROVIDER', message: `Unsupported provider '${providerParam}'` },
              { status: 400 },
            );
          }
          return Response.json(
            await initializedCore.testing.getModelsForProvider(normalized as BatchProvider),
          );
        }
        return Response.json(await initializedCore.testing.getAvailableModels());
      }

      if (method === 'POST' && path === 'node-config/update') {
        const response = await initializedCore.actions.handleConfigUpdate(body);
        return Response.json(response);
      }

      if (method === 'GET' && path.startsWith('node-definition/')) {
        const nodeTypeParam = path.split('/')[1] ?? '';

        if (!nodeTypeParam.includes('.')) {
          return Response.json(
            { error: 'INVALID_NODE_TYPE', message: `Unknown node type '${nodeTypeParam}'` },
            { status: 400 },
          );
        }

        const params = parseParamsFromSearch(searchParams.get('params'));
        const changeField = searchParams.get('changeField') ?? undefined;
        const changeValue = searchParams.get('changeValue') ?? undefined;
        const nodeId = searchParams.get('nodeId') ?? `definition-${nodeTypeParam.toLowerCase()}`;
        const flowId = searchParams.get('flowId') ?? undefined;

        const response = await initializedCore.actions.handleConfigUpdate({
          nodeType: nodeTypeParam,
          nodeId,
          flowId,
          params,
          change: changeField ? { field: changeField, value: changeValue } : undefined,
        });
        return Response.json(response);
      }

      // GET /nodes — available node definitions
      if (method === 'GET' && path === 'nodes') {
        return new Response(JSON.stringify(initializedCore.actions.getAvailableNodes()), {
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
        });
      }

      // GET /actions/:actionId/fields/:fieldName/options — dynamic field options
      if (method === 'GET' && path.match(/^actions\/[^/]+\/fields\/[^/]+\/options$/)) {
        const parts = path.split('/');
        const actionId = parts[1];
        const fieldName = parts[3];
        let dependencyValues: Record<string, unknown> = {};
        const depsParam = searchParams.get('deps');
        if (depsParam) {
          try {
            dependencyValues = JSON.parse(depsParam);
          } catch {
            return Response.json({ error: 'Invalid deps JSON' }, { status: 400 });
          }
        }
        return Response.json(
          await initializedCore.actions.resolveFieldOptions(actionId, fieldName, dependencyValues),
        );
      }

      // POST /nodes/test — test a single node in isolation
      if (method === 'POST' && path === 'nodes/test') {
        const { nodeType, params: nodeParams, inputData } = body;
        if (!nodeType || typeof nodeType !== 'string') {
          return Response.json(
            { error: 'nodeType is required and must be a string' },
            { status: 400 },
          );
        }
        if (!nodeParams || typeof nodeParams !== 'object') {
          return Response.json(
            { error: 'params is required and must be an object' },
            { status: 400 },
          );
        }
        return Response.json(
          await initializedCore.testing.testNode(nodeType, nodeParams, inputData || {}),
        );
      }

      // =====================================
      // CREDENTIAL ROUTES
      // =====================================

      // OAuth2 routes (must come before generic credential routes)
      if (method === 'GET' && path === 'credentials/oauth2/providers') {
        return Response.json(initializedCore.credentials.getOAuth2Providers());
      }

      if (method === 'GET' && path.match(/^credentials\/oauth2\/providers\/[^/]+$/)) {
        const providerId = path.split('/')[3];
        const provider = initializedCore.credentials.getOAuth2Provider(providerId);
        if (!provider) {
          return Response.json({ error: 'OAuth2 provider not found' }, { status: 404 });
        }
        return Response.json(provider);
      }

      if (method === 'POST' && path === 'credentials/oauth2/start') {
        const {
          providerId,
          clientId,
          clientSecret,
          redirectUri,
          scopes,
          returnUrl,
          credentialName,
        } = body;
        if (!providerId || !clientId || !clientSecret || !redirectUri) {
          return Response.json(
            { error: 'Missing required fields: providerId, clientId, clientSecret, redirectUri' },
            { status: 400 },
          );
        }
        const result = initializedCore.credentials.startOAuth2Flow(
          providerId,
          { clientId, clientSecret, redirectUri },
          { scopes, returnUrl, credentialName },
        );
        return Response.json(result);
      }

      if (method === 'POST' && path === 'credentials/oauth2/callback') {
        const { code, state, clientId, clientSecret, redirectUri } = body;
        if (!code || !state || !clientId || !clientSecret || !redirectUri) {
          return Response.json(
            { error: 'Missing required fields: code, state, clientId, clientSecret, redirectUri' },
            { status: 400 },
          );
        }
        const credential = await initializedCore.credentials.handleOAuth2Callback(code, state, {
          clientId,
          clientSecret,
          redirectUri,
        });
        return Response.json(credential);
      }

      if (method === 'GET' && path === 'credentials/expiring') {
        const daysParam = searchParams.get('daysUntilExpiry');
        const days = daysParam ? parseInt(daysParam) : 7;
        return Response.json(await initializedCore.credentials.getExpiring(days));
      }

      if (method === 'POST' && path === 'credentials/test-request') {
        const {
          url: targetUrl,
          method: reqMethod = 'GET',
          headers: reqHeaders = {},
          body: reqBody,
        } = body;
        if (!targetUrl) {
          return Response.json({ error: 'URL is required' }, { status: 400 });
        }

        // Validate URL to prevent SSRF
        let parsedUrl: URL;
        try {
          parsedUrl = new URL(targetUrl);
        } catch {
          return Response.json({ error: 'Invalid URL' }, { status: 400 });
        }
        if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
          return Response.json(
            { error: 'Only HTTP and HTTPS protocols are allowed' },
            { status: 400 },
          );
        }

        // Resolve hostname to IP and check against private ranges
        const { promises: dns } = await import('node:dns');
        const { isIP } = await import('node:net');
        let resolvedIps: Array<{ address: string }>;
        try {
          resolvedIps = await dns.lookup(parsedUrl.hostname, { all: true });
        } catch {
          return Response.json({ error: 'Could not resolve hostname' }, { status: 400 });
        }
        for (const { address: ip } of resolvedIps) {
          const ver = isIP(ip);
          if (ver === 4) {
            const parts = ip.split('.').map(Number);
            if (
              parts[0] === 127 ||
              parts[0] === 10 ||
              parts[0] === 0 ||
              (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
              (parts[0] === 192 && parts[1] === 168) ||
              (parts[0] === 169 && parts[1] === 254)
            ) {
              return Response.json(
                { error: 'Requests to private/internal network addresses are not allowed' },
                { status: 400 },
              );
            }
          } else if (ver === 6) {
            const lower = ip.toLowerCase();
            if (
              lower === '::1' ||
              lower.startsWith('fe80') ||
              lower.startsWith('fc') ||
              lower.startsWith('fd') ||
              lower.startsWith('::ffff:')
            ) {
              return Response.json(
                { error: 'Requests to private/internal network addresses are not allowed' },
                { status: 400 },
              );
            }
          }
        }

        const fetchOptions: RequestInit = {
          method: reqMethod,
          headers: reqHeaders,
          redirect: 'error',
        };
        if (reqBody && ['POST', 'PUT', 'PATCH'].includes(reqMethod)) {
          fetchOptions.body = typeof reqBody === 'string' ? reqBody : JSON.stringify(reqBody);
        }
        const resp = await fetch(targetUrl, fetchOptions);
        const respText = await resp.text();
        let respBody: unknown;
        try {
          respBody = JSON.parse(respText);
        } catch {
          respBody = respText;
        }
        return Response.json({
          status: resp.status,
          statusText: resp.statusText,
          ok: resp.ok,
          body: respBody,
        });
      }

      if (method === 'POST' && path === 'credentials') {
        const credential = await initializedCore.credentials.create(body);
        return Response.json(credential, { status: 201 });
      }

      if (method === 'GET' && path === 'credentials') {
        const filters: Record<string, unknown> = {};
        const type = searchParams.get('type');
        const authType = searchParams.get('authType');
        const isActive = searchParams.get('isActive');
        if (type) {
          filters.type = type;
        }
        if (authType) {
          filters.authType = authType;
        }
        if (isActive !== null) {
          filters.isActive = isActive === 'true';
        }
        return Response.json(await initializedCore.credentials.list(filters as CredentialFilters));
      }

      // POST /credentials/:id/refresh
      if (method === 'POST' && path.match(/^credentials\/[^/]+\/refresh$/)) {
        const credId = path.split('/')[1];
        return Response.json(await initializedCore.credentials.refreshOAuth2Credential(credId));
      }

      // POST /credentials/:id/track-usage
      if (method === 'POST' && path.match(/^credentials\/[^/]+\/track-usage$/)) {
        const credId = path.split('/')[1];
        await initializedCore.credentials.updateLastUsed(credId);
        return new Response(null, { status: 204 });
      }

      // POST /credentials/:id/test
      if (method === 'POST' && path.match(/^credentials\/[^/]+\/test$/)) {
        const credentialId = path.split('/')[1];
        const result = await initializedCore.credentials.test(credentialId);
        return Response.json(result);
      }

      // GET /credentials/:id
      if (method === 'GET' && path.match(/^credentials\/[^/]+$/)) {
        const credentialId = path.split('/')[1];
        return Response.json(await initializedCore.credentials.getSanitized(credentialId));
      }

      // DELETE /credentials/:id
      if (method === 'DELETE' && path.match(/^credentials\/[^/]+$/)) {
        const credentialId = path.split('/')[1];
        await initializedCore.credentials.delete(credentialId);
        return new Response(null, { status: 204 });
      }

      // GET /triggers/:triggerId
      if (method === 'GET' && path.match(/^triggers\/[^/]+$/)) {
        const triggerId = path.split('/')[1];
        const trigger = await initializedCore.triggers.get(triggerId);
        if (!trigger) {
          return Response.json(
            { error: 'Not Found', message: `Trigger ${triggerId} not found` },
            { status: 404 },
          );
        }
        return Response.json(trigger);
      }

      if (method === 'PUT' && path.match(/^triggers\/[^/]+$/)) {
        const triggerId = path.split('/')[1];
        const trigger = await initializedCore.triggers.update(triggerId, body);
        if (!trigger) {
          return Response.json({ error: 'Not Found' }, { status: 404 });
        }
        return Response.json(trigger);
      }

      if (method === 'DELETE' && path.match(/^triggers\/[^/]+$/)) {
        const triggerId = path.split('/')[1];
        await initializedCore.triggers.delete(triggerId);
        return new Response(null, { status: 204 });
      }

      // =====================================
      // AGENT TOOLS ROUTES
      // =====================================

      if (method === 'GET' && path === 'agent/tools') {
        return new Response(JSON.stringify(initializedCore.agent.getTools()), {
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
        });
      }

      // =====================================
      // DASHBOARD ROUTES
      // =====================================

      if (method === 'GET' && path === 'dashboard/stats') {
        return Response.json(await initializedCore.flows.getDashboardStats());
      }

      // =====================================
      // CHAT ROUTES
      // =====================================

      if (method === 'GET' && path === 'chat/status') {
        return Response.json({ enabled: initializedCore.chat.isEnabled() });
      }

      // GET /chat/models/:credentialId - List available models for a credential
      if (method === 'GET' && path.match(/^chat\/models\/[^/]+$/)) {
        const credentialId = path.split('/')[2];
        const url = new URL(request.url);
        const q = url.searchParams.get('q') ?? undefined;
        const models = await initializedCore.chat.listModels(credentialId, q);
        return Response.json(models);
      }

      // POST /chat - Streaming chat assistant endpoint (SSE via Web ReadableStream)
      if (method === 'POST' && path === 'chat') {
        const { messages, context: chatContext } = body;

        if (!messages || !Array.isArray(messages)) {
          return Response.json(
            { error: 'Validation Error', message: '"messages" must be an array of chat messages' },
            { status: 400 },
          );
        }

        const stream = await initializedCore.chat.createStream({
          messages,
          context: chatContext || {},
        });

        const encoder = new TextEncoder();
        const readable = new ReadableStream({
          async start(controller) {
            try {
              for await (const event of stream) {
                const data = JSON.stringify(event);
                controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${data}\n\n`));
              }
            } catch (error: unknown) {
              const message = error instanceof Error ? error.message : 'Chat stream failed';
              controller.enqueue(
                encoder.encode(
                  `event: error\ndata: ${JSON.stringify({ type: 'error', message, recoverable: false })}\n\n`,
                ),
              );
            } finally {
              controller.close();
            }
          },
        });

        return new Response(readable, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
          },
        });
      }

      // GET /chat/stream/:sessionId - Reattach to an in-flight chat session.
      if (method === 'GET' && path.match(/^chat\/stream\/[^/]+$/)) {
        const sessionId = path.split('/')[2];
        if (!sessionId) {
          return Response.json({ error: 'Session ID required' }, { status: 400 });
        }
        const abortController = new AbortController();
        request.signal.addEventListener('abort', () => abortController.abort());

        const encoder = new TextEncoder();
        const readable = new ReadableStream({
          async start(controller) {
            try {
              const stream = initializedCore.chat.subscribeToSession(
                sessionId,
                abortController.signal,
              );
              for await (const event of stream) {
                const data = JSON.stringify(event);
                controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${data}\n\n`));
              }
            } catch (error: unknown) {
              const message = error instanceof Error ? error.message : 'Chat reattach failed';
              controller.enqueue(
                encoder.encode(
                  `event: error\ndata: ${JSON.stringify({ type: 'error', message, recoverable: false })}\n\n`,
                ),
              );
            } finally {
              controller.close();
            }
          },
        });

        return new Response(readable, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
          },
        });
      }

      if (method === 'GET' && path.match(/^chat\/messages\/[^/]+$/)) {
        const flowId = path.split('/')[2];
        const page = searchParams.get('page');
        const limit = searchParams.get('limit');
        const p = page ? parseInt(page, 10) : undefined;
        const l = limit ? parseInt(limit, 10) : undefined;
        return Response.json(
          await initializedCore.chat.getMessages(flowId, {
            ...(p ? { page: p } : {}),
            ...(l ? { limit: l } : {}),
          }),
        );
      }

      if (method === 'PUT' && path.match(/^chat\/messages\/[^/]+$/)) {
        const flowId = path.split('/')[2];
        const { messages } = body;
        if (!messages || !Array.isArray(messages)) {
          return Response.json({ error: '"messages" must be an array' }, { status: 400 });
        }
        return Response.json(await initializedCore.chat.saveMessages(flowId, messages));
      }

      if (method === 'DELETE' && path.match(/^chat\/messages\/[^/]+$/)) {
        const flowId = path.split('/')[2];
        await initializedCore.chat.deleteMessages(flowId);
        return Response.json({ success: true });
      }

      // =====================================
      // FLOW CRUD (generic — must come AFTER all more-specific /flows/ routes)
      // =====================================

      if (method === 'GET' && path.match(/^flows\/[^/]+$/)) {
        const flowId = path.split('/')[1];
        return Response.json(await initializedCore.flows.get(flowId));
      }

      if (method === 'PUT' && path.match(/^flows\/[^/]+$/)) {
        const flowId = path.split('/')[1];
        return Response.json(await initializedCore.flows.update(flowId, body));
      }

      if (method === 'DELETE' && path.match(/^flows\/[^/]+$/)) {
        const flowId = path.split('/')[1];
        await initializedCore.flows.delete(flowId);
        return new Response(null, { status: 204 });
      }

      // =====================================
      // PLUGIN ENDPOINTS
      // Delegate to plugin-defined routes under the plugins/ prefix
      // =====================================
      if (path.startsWith('plugins/')) {
        const pluginPath = '/' + path.replace(/^plugins\/?/, '');
        const endpoints = initializedCore.plugins.getEndpoints();

        const matchedEndpoint = endpoints.find((ep) => {
          if (ep.method !== method) {
            return false;
          }
          const pattern = ep.path
            .replace(/\*/g, '(.*)') // wildcard * → match any path segments
            .replace(/:([^/]+)/g, '([^/]+)'); // :param → match single segment
          // oxlint-disable-next-line security/detect-non-literal-regexp -- pattern built from registered plugin endpoint paths
          return new RegExp(`^${pattern}$`).test(pluginPath);
        });

        if (!matchedEndpoint) {
          return Response.json(
            { error: 'Not Found', message: `Plugin route ${method} ${pluginPath} not found` },
            { status: 404 },
          );
        }

        // Extract path params
        const paramNames: string[] = [];
        const paramPattern = matchedEndpoint.path
          .replace(/\*/g, '(.*)') // wildcard * → match rest of path
          .replace(/:([^/]+)/g, (_m: string, name: string) => {
            paramNames.push(name);
            return '([^/]+)';
          });
        // oxlint-disable-next-line security/detect-non-literal-regexp -- pattern built from registered plugin endpoint paths
        const paramMatch = new RegExp(`^${paramPattern}$`).exec(pluginPath);
        const pluginParams: Record<string, string> = {};
        if (paramMatch) {
          paramNames.forEach((name, i) => {
            pluginParams[name] = paramMatch[i + 1] || '';
          });
        }

        // Resolve identity for this request by running plugin onRequest hooks.
        // The auth plugin writes the resolved session identity onto the context object.
        const pluginRequestContext = {
          path: '/' + path.replace(/^plugins\/?/, ''),
          method,
          identity: null as FlowlibIdentity | null,
        };
        const hookResult = await initializedCore.plugins
          .getHookRunner()
          .runOnRequest(requestClone.clone(), pluginRequestContext);
        if (hookResult.intercepted && hookResult.response) {
          return hookResult.response;
        }

        const pluginResult = await matchedEndpoint.handler({
          body,
          params: pluginParams,
          query: Object.fromEntries(new URL(request.url).searchParams.entries()),
          headers: (() => {
            const h: Record<string, string | undefined> = {};
            request.headers.forEach((v, k) => {
              h[k] = v;
            });
            return h;
          })(),
          identity: pluginRequestContext.identity,
          database: (await loadCoreModule()).createPluginDatabaseApi(
            initializedCore.plugins.getDatabaseConnection(),
          ),
          request: requestClone,
          core: {
            getPermissions: (identity) => initializedCore.auth.getPermissions(identity),
            getAvailableRoles: () => initializedCore.auth.getAvailableRoles(),
            getResolvedRole: (identity) => initializedCore.auth.getResolvedRole(identity),
            authorize: (context) => initializedCore.auth.authorize(context),
          },
          getFlowlib: () => initializedCore,
        });

        // Handle raw Response objects
        if (pluginResult instanceof Response) {
          return pluginResult;
        }

        // Handle streaming responses
        if ('stream' in pluginResult && pluginResult.stream) {
          return new Response(pluginResult.stream as ReadableStream, {
            status: pluginResult.status || 200,
            headers: { 'Content-Type': 'text/event-stream' },
          });
        }

        // Standard JSON response
        const jsonBody = 'body' in pluginResult ? pluginResult.body : null;
        return Response.json(jsonBody, { status: pluginResult.status || 200 });
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
          if (error instanceof ZodError) {
            return Response.json(
              {
                error: 'Validation Error',
                message: 'Invalid request data',
                details: error.errors.map((err) => ({
                  path: err.path.join('.'),
                  message: err.message,
                  code: err.code,
                })),
              },
              { status: 400 },
            );
          }

          // eslint-disable-next-line no-console
          console.error('Flowlib Endpoint Error:', error);
          return Response.json(
            {
              error: 'Internal Server Error',
              message: 'An unexpected error occurred',
            },
            { status: 500 },
          );
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
      if (error instanceof ZodError) {
        return Response.json(
          {
            error: 'Validation Error',
            message: 'Invalid request data',
            details: error.errors.map((err) => ({
              path: err.path.join('.'),
              message: err.message,
              code: err.code,
            })),
          },
          { status: 400 },
        );
      }

      // eslint-disable-next-line no-console
      console.error('Flowlib Cron Handler Error:', error);
      return Response.json(
        {
          error: 'Internal Server Error',
          message: error instanceof Error ? error.message : 'An unexpected error occurred',
        },
        { status: 500 },
      );
    }
  };
}

// Re-export types from core for convenience
export type { FlowlibConfig, FlowlibInstance } from '@flowlib/core';

export async function createFlowlib(config: FlowlibConfig): Promise<FlowlibInstance> {
  const { createFlowlib: createCoreFlowlib } = await loadCoreModule();
  return createCoreFlowlib(config);
}
