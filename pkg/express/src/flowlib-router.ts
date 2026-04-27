import { Router, json } from 'express';
import type { Request, Response, NextFunction } from 'express';
import {
  BatchProvider,
  createFlowlib,
  FlowlibConfig,
  FlowlibIdentity,
  FlowlibPermission,
  FlowlibResourceType,
  createPluginDatabaseApi,
} from '@flowlib/core';
import type { CredentialFilters } from '@flowlib/core';
import type { QueryOptions } from '@flowlib/core';
import type { FlowRun } from '@flowlib/core';
import type { NodeExecution } from '@flowlib/core';

import { ZodError } from 'zod';

// Extend Express Request type to include Flowlib identity
declare module 'express' {
  interface Request {
    /** Flowlib identity resolved from host app auth */
    flowlibIdentity?: FlowlibIdentity | null;
  }
}

function parseParamsFromQuery(queryValue: unknown): Record<string, unknown> {
  if (!queryValue) {
    return {};
  }

  if (typeof queryValue === 'string') {
    try {
      return JSON.parse(queryValue);
    } catch {
      return {};
    }
  }

  if (Array.isArray(queryValue)) {
    const last = queryValue[queryValue.length - 1];
    if (typeof last === 'string') {
      try {
        return JSON.parse(last);
      } catch {
        return {};
      }
    }
    return {};
  }

  if (typeof queryValue === 'object') {
    return Object.entries(queryValue).reduce<Record<string, unknown>>((acc, [key, value]) => {
      acc[key] = Array.isArray(value) ? value[value.length - 1] : value;
      return acc;
    }, {});
  }

  return {};
}

function coerceQueryValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value[value.length - 1];
  }
  return value ?? undefined;
}

/**
 * Parse pagination options from Express query params.
 * Returns a QueryOptions object suitable for the core API.
 */
function parsePaginationFromQuery(query: Record<string, unknown>): {
  pagination?: { page: number; limit: number };
  sort?: { sortBy: string; sortOrder: 'asc' | 'desc' };
} {
  const result: {
    pagination?: { page: number; limit: number };
    sort?: { sortBy: string; sortOrder: 'asc' | 'desc' };
  } = {};
  const page = typeof query.page === 'string' ? parseInt(query.page, 10) : undefined;
  const limit = typeof query.limit === 'string' ? parseInt(query.limit, 10) : undefined;
  if (page || limit) {
    result.pagination = {
      page: page && page >= 1 ? page : 1,
      limit: limit && limit >= 1 ? Math.min(limit, 100) : 20,
    };
  }
  const sortBy = typeof query.sortBy === 'string' ? query.sortBy : undefined;
  const sortOrder =
    query.sortOrder === 'asc' || query.sortOrder === 'desc' ? query.sortOrder : undefined;
  if (sortBy) {
    result.sort = { sortBy, sortOrder: sortOrder ?? 'desc' };
  }
  return result;
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

  /** Extract a single route parameter as a string (Express 5 params can be string | string[]). */
  function param(req: Request, name: string): string {
    const v = req.params[name];
    return Array.isArray(v) ? v[0] : v;
  }

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
      const webRequestUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
      const webRequestInit: RequestInit = {
        method: req.method,
        headers: req.headers as HeadersInit,
      };
      const webRequest = new globalThis.Request(webRequestUrl, webRequestInit);
      const hookContext = {
        path: req.path,
        method: req.method,
        identity: null as FlowlibIdentity | null,
      };

      const hookResult = await flowlib.plugins.getHookRunner().runOnRequest(webRequest, hookContext);
      if (hookResult.intercepted && hookResult.response) {
        const arrayBuf = await hookResult.response.arrayBuffer();
        res.status(hookResult.response.status);
        hookResult.response.headers.forEach((value, key) => {
          res.setHeader(key, value);
        });
        return res.send(Buffer.from(arrayBuf));
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
  // AUTHORIZATION HELPER
  // =====================================

  /**
   * Create an authorization middleware for a specific permission.
   * Uses the standard authorize() path which delegates to plugin hooks (e.g., RBAC).
   */
  function requirePermission(
    permission: FlowlibPermission,
    getResourceId?: (req: Request) => string | string[] | undefined,
  ) {
    return async (req: Request, res: Response, next: NextFunction) => {
      const identity = req.flowlibIdentity ?? null;
      const rawId = getResourceId ? getResourceId(req) : undefined;
      const resourceId = Array.isArray(rawId) ? rawId[0] : rawId;
      const resourceType = permission.split(':')[0] as FlowlibResourceType;

      const result = await flowlib.auth.authorize({
        identity,
        action: permission,
        resource: resourceId
          ? {
              type: resourceType,
              id: resourceId,
            }
          : undefined,
      });

      if (!result.allowed) {
        const status = identity ? 403 : 401;
        return res.status(status).json({
          error: status === 403 ? 'Forbidden' : 'Unauthorized',
          message: result.reason || 'Access denied',
        });
      }

      next();
    };
  }

  // =====================================
  // DASHBOARD ROUTES
  // =====================================

  /**
   * GET /dashboard/stats - Get dashboard statistics
   * Core method: ✅ getDashboardStats()
   * Returns: DashboardStats (flow counts, run counts by status, recent activity)
   * Permission: flow:read
   */
  router.get(
    '/dashboard/stats',
    requirePermission('flow:read'),
    async (_req: Request, res: Response) => {
      const stats = await flowlib.flows.getDashboardStats();
      res.json(stats);
    },
  );

  // =====================================
  // FLOW MANAGEMENT ROUTES
  // =====================================

  /**
   * GET /flows/list - List all flows (simple GET endpoint)
   * Core method: ✅ listFlows()
   * Permission: flow:read
   */
  router.get(
    '/flows/list',
    requirePermission('flow:read'),
    async (_req: Request, res: Response) => {
      const flows = await flowlib.flows.list();
      res.json(flows);
    },
  );

  /**
   * POST /flows/list - List flows with optional filtering and pagination
   * Core method: ✅ listFlows(options?: QueryOptions<Flow>)
   * Body: QueryOptions<Flow>
   * Permission: flow:read
   */
  router.post(
    '/flows/list',
    requirePermission('flow:read'),
    async (req: Request, res: Response) => {
      const flows = await flowlib.flows.list(req.body);
      res.json(flows);
    },
  );

  /**
   * POST /flows - Create a new flow
   * Core method: ✅ createFlow(flowData: CreateFlowRequest)
   * Permission: flow:create
   */
  router.post('/flows', requirePermission('flow:create'), async (req: Request, res: Response) => {
    const flow = await flowlib.flows.create(req.body);
    res.status(201).json(flow);
  });

  /**
   * GET /flows/:id - Get flow by ID
   * Core method: ✅ getFlow(flowId: string)
   * Permission: flow:read (with resource check)
   */
  router.get(
    '/flows/:id',
    requirePermission('flow:read', (req) => param(req, 'id')),
    async (req: Request, res: Response) => {
      const flow = await flowlib.flows.get(param(req, 'id'));
      res.json(flow);
    },
  );

  /**
   * PUT /flows/:id - Update flow
   * Core method: ✅ updateFlow(flowId: string, updateData: UpdateFlowInput)
   * Permission: flow:update (with resource check)
   */
  router.put(
    '/flows/:id',
    requirePermission('flow:update', (req) => param(req, 'id')),
    async (req: Request, res: Response) => {
      const flow = await flowlib.flows.update(param(req, 'id'), req.body);
      res.json(flow);
    },
  );

  /**
   * DELETE /flows/:id - Delete flow
   * Core method: ✅ deleteFlow(flowId: string)
   * Permission: flow:delete (with resource check)
   */
  router.delete(
    '/flows/:id',
    requirePermission('flow:delete', (req) => param(req, 'id')),
    async (req: Request, res: Response) => {
      await flowlib.flows.delete(param(req, 'id'));
      res.status(204).send();
    },
  );

  /**
   * POST /validate-flow - Validate flow definition
   * Core method: ✅ validateFlowDefinition(flowId: string, flowDefinition: FlowlibDefinition)
   * Permission: flow:read
   */
  router.post(
    '/validate-flow',
    requirePermission('flow:read'),
    async (req: Request, res: Response) => {
      const { flowId, flowDefinition } = req.body;
      const result = await flowlib.flows.validate(flowId, flowDefinition);
      res.json(result);
    },
  );

  /**
   * GET /flows/:flowId/react-flow - Get flow data in React Flow format
   * Core method: ✅ renderToReactFlow(flowId: string, options)
   * Query params: version, flowRunId
   * Permission: flow:read (with resource check)
   */
  router.get(
    '/flows/:flowId/react-flow',
    requirePermission('flow:read', (req) => param(req, 'flowId')),
    async (req: Request, res: Response) => {
      interface ReactFlowQueryParams {
        version?: string | 'latest';
        flowRunId?: string;
      }

      const queryParams = req.query as ReactFlowQueryParams;
      const options: { version?: string | number | 'latest'; flowRunId?: string } = {};

      // Extract and validate query parameters
      if (queryParams.version) {
        options.version = queryParams.version;
      }
      if (queryParams.flowRunId) {
        options.flowRunId = queryParams.flowRunId;
      }

      const result = await flowlib.flows.renderToReactFlow(param(req, 'flowId'), options);
      res.json(result);
    },
  );

  // =====================================
  // FLOW VERSION MANAGEMENT ROUTES
  // =====================================

  /**
   * POST /flows/:id/versions/list - Get flow versions with optional filtering and pagination
   * Core method: ✅ listFlowVersions(flowId: string, options?: QueryOptions<FlowVersion>)
   * Body: QueryOptions<FlowVersion>
   * Permission: flow-version:read (with resource check on flow)
   */
  router.post(
    '/flows/:id/versions/list',
    requirePermission('flow-version:read', (req) => param(req, 'id')),
    async (req: Request, res: Response) => {
      const versions = await flowlib.versions.list(param(req, 'id'), req.body);
      res.json(versions);
    },
  );

  /**
   * POST /flows/:id/versions - Create flow version
   * Core method: ✅ createFlowVersion(flowId: string, versionData: CreateFlowVersionRequest)
   * Permission: flow-version:create (with resource check on flow)
   */
  router.post(
    '/flows/:id/versions',
    requirePermission('flow-version:create', (req) => param(req, 'id')),
    async (req: Request, res: Response) => {
      const version = await flowlib.versions.create(param(req, 'id'), req.body);
      res.status(201).json(version);
    },
  );

  /**
   * GET /flows/:id/versions/:version - Get specific flow version (supports 'latest')
   * Core method: ✅ getFlowVersion(flowId: string, version: string | number | "latest")
   * Permission: flow-version:read (with resource check on flow)
   */
  router.get(
    '/flows/:id/versions/:version',
    requirePermission('flow-version:read', (req) => param(req, 'id')),
    async (req: Request, res: Response) => {
      const version = await flowlib.versions.get(param(req, 'id'), param(req, 'version'));
      if (!version) {
        return res.status(404).json({
          error: 'Not Found',
          message: `Version ${param(req, 'version')} not found for flow ${param(req, 'id')}`,
        });
      }
      res.json(version);
    },
  );

  // =====================================
  // FLOW RUN EXECUTION ROUTES
  // =====================================

  /**
   * POST /flows/:flowId/run - Start flow execution (async - returns immediately)
   * Core method: ✅ startFlowRunAsync(flowId: string, inputs: FlowInputs, options?: ExecuteFlowOptions)
   * Returns immediately with flow run ID. The flow executes in the background.
   * Permission: flow-run:create (with resource check on flow)
   */
  router.post(
    '/flows/:flowId/run',
    requirePermission('flow-run:create', (req) => param(req, 'flowId')),
    async (req: Request, res: Response) => {
      const { inputs = {}, options } = req.body;
      const result = await flowlib.runs.startAsync(param(req, 'flowId'), inputs, options);
      res.status(201).json(result);
    },
  );

  /**
   * POST /flows/:flowId/run-to-node/:nodeId - Execute flow up to a specific node
   * Only executes the upstream nodes required to produce output for the target node.
   * Core method: ✅ executeFlowToNode(flowId, targetNodeId, inputs, options)
   * Permission: flow-run:create (with resource check on flow)
   */
  router.post(
    '/flows/:flowId/run-to-node/:nodeId',
    requirePermission('flow-run:create', (req) => param(req, 'flowId')),
    async (req: Request, res: Response) => {
      const { inputs = {}, options } = req.body;
      const result = await flowlib.runs.executeToNode(
        param(req, 'flowId'),
        param(req, 'nodeId'),
        inputs,
        options,
      );
      res.status(201).json(result);
    },
  );

  /**
   * POST /flow-runs/list - Get all flow runs with optional filtering and pagination
   * Core method: ✅ listFlowRuns(options?: QueryOptions<FlowRun>)
   * Body: QueryOptions<FlowRun>
   * Permission: flow-run:read
   */
  router.post(
    '/flow-runs/list',
    requirePermission('flow-run:read'),
    async (req: Request, res: Response) => {
      const flowRuns = await flowlib.runs.list(req.body);
      res.json(flowRuns);
    },
  );

  /**
   * GET /flow-runs/:flowRunId - Get specific flow run by ID
   * Core method: ✅ getFlowRunById(flowRunId: string)
   * Permission: flow-run:read
   */
  router.get(
    '/flow-runs/:flowRunId',
    requirePermission('flow-run:read'),
    async (req: Request, res: Response) => {
      const flowRun = await flowlib.runs.get(param(req, 'flowRunId'));
      res.json(flowRun);
    },
  );

  /**
   * GET /flows/:flowId/flow-runs - Get flow runs for a specific flow
   * Core method: ✅ listFlowRunsByFlowId(flowId: string, options?)
   * Query params: page, limit, sortBy, sortOrder
   * Permission: flow-run:read (with resource check on flow)
   */
  router.get(
    '/flows/:flowId/flow-runs',
    requirePermission('flow-run:read', (req) => param(req, 'flowId')),
    async (req: Request, res: Response) => {
      const paginationOpts = parsePaginationFromQuery(req.query as Record<string, unknown>);
      const flowRuns = await flowlib.runs.listByFlowId(
        param(req, 'flowId'),
        paginationOpts as QueryOptions<FlowRun>,
      );
      res.json(flowRuns);
    },
  );

  /**
   * POST /flow-runs/:flowRunId/resume - Resume paused flow execution
   * Core method: ✅ resumeExecution(executionId: string)
   * Permission: flow-run:update
   */
  router.post(
    '/flow-runs/:flowRunId/resume',
    requirePermission('flow-run:cancel'),
    async (req: Request, res: Response) => {
      const result = await flowlib.runs.resume(param(req, 'flowRunId'));
      res.json(result);
    },
  );

  /**
   * POST /flow-runs/:flowRunId/cancel - Cancel flow execution
   * Core method: ✅ cancelFlowRun(flowRunId: string)
   * Permission: flow-run:update
   */
  router.post(
    '/flow-runs/:flowRunId/cancel',
    requirePermission('flow-run:cancel'),
    async (req: Request, res: Response) => {
      const result = await flowlib.runs.cancel(param(req, 'flowRunId'));
      res.json(result);
    },
  );

  /**
   * POST /flow-runs/:flowRunId/pause - Pause flow execution
   * Core method: ✅ pauseFlowRun(flowRunId: string, reason?: string)
   * Permission: flow-run:update
   */
  router.post(
    '/flow-runs/:flowRunId/pause',
    requirePermission('flow-run:cancel'),
    async (req: Request, res: Response) => {
      const { reason } = req.body;
      const result = await flowlib.runs.pause(param(req, 'flowRunId'), reason);
      res.json(result);
    },
  );

  // =====================================
  // NODE EXECUTION ROUTES
  // =====================================

  /**
   * GET /flow-runs/:flowRunId/node-executions - Get node executions for a flow run
   * Core method: ✅ getNodeExecutionsByRunId(flowRunId: string, options?)
   * Query params: page, limit, sortBy, sortOrder
   * Permission: flow-run:read
   */
  router.get(
    '/flow-runs/:flowRunId/node-executions',
    requirePermission('flow-run:read'),
    async (req: Request, res: Response) => {
      const paginationOpts = parsePaginationFromQuery(req.query as Record<string, unknown>);
      const nodeExecutions = await flowlib.runs.getNodeExecutions(
        param(req, 'flowRunId'),
        paginationOpts as QueryOptions<NodeExecution>,
      );
      res.json(nodeExecutions);
    },
  );

  /**
   * Shared handler for the SSE event stream.
   * Wired to both `/flow-runs/:flowRunId/stream` (legacy / canonical) and
   * `/runs/:flowRunId/events` (alias used by the VSCode extension and other
   * external clients that prefer a `/runs/...` REST shape).
   */
  async function handleRunEventsStream(req: Request, res: Response, flowRunId: string) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Disable Nagle so each `res.write` chunk hits the socket immediately
    // — important for SSE under bursty event traffic (parallel scheduler).
    res.socket?.setNoDelay(true);

    // If a compression middleware is in the stack, `res.flush()` exists and
    // must be called after every write to defeat its buffer.
    const flush = (res as unknown as { flush?: () => void }).flush;
    const flushIfPresent = typeof flush === 'function' ? flush.bind(res) : (): void => undefined;

    // Clean shutdown if the client disconnects mid-stream.
    let clientGone = false;
    req.on('close', () => {
      clientGone = true;
    });

    try {
      const stream = flowlib.runs.createEventStream(flowRunId);

      for await (const event of stream) {
        if (clientGone || res.destroyed) {
          break;
        }
        const data = JSON.stringify(event);
        res.write(`event: ${event.type}\ndata: ${data}\n\n`);
        flushIfPresent();
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Stream failed';
      if (res.headersSent) {
        res.write(`event: error\ndata: ${JSON.stringify({ type: 'error', message })}\n\n`);
        flushIfPresent();
      } else {
        return res.status(500).json({ error: 'Internal Server Error', message });
      }
    } finally {
      if (!res.destroyed) {
        res.end();
      }
    }
  }

  /**
   * GET /flow-runs/:flowRunId/stream - SSE stream of execution events
   * Core method: ✅ createFlowRunEventStream(flowRunId: string)
   *
   * Streams node-execution and flow-run updates in real time.
   * First event is a "snapshot", then incremental updates, ending with "end".
   * Permission: flow-run:read
   */
  router.get(
    '/flow-runs/:flowRunId/stream',
    requirePermission('flow-run:read'),
    async (req: Request, res: Response) => {
      await handleRunEventsStream(req, res, param(req, 'flowRunId'));
    },
  );

  /**
   * GET /runs/:flowRunId/events - SSE stream of execution events (alias).
   *
   * Identical semantics to `/flow-runs/:flowRunId/stream`. Exposed under the
   * shorter `/runs/...` shape for external clients (VSCode extension, etc.)
   * that prefer it.
   * Permission: flow-run:read
   */
  router.get(
    '/runs/:flowRunId/events',
    requirePermission('flow-run:read'),
    async (req: Request, res: Response) => {
      await handleRunEventsStream(req, res, param(req, 'flowRunId'));
    },
  );

  /**
   * POST /flow-runs/ephemeral - Run an inline flow definition without
   * persisting it as a regular flow.
   *
   * Body: { definition: FlowlibDefinition, inputs?: Record<string, unknown>, name?: string }
   * Returns: { flowRunId, flowId, status, eventsPath }
   *
   * Credentials are NOT ephemeral — `credentialId` references in the
   * definition still resolve against the persisted credential store.
   * Permission: flow:create (ephemeral runs implicitly create a flow record)
   */
  router.post(
    '/flow-runs/ephemeral',
    requirePermission('flow:create'),
    async (req: Request, res: Response) => {
      const { definition, inputs, name } = (req.body ?? {}) as {
        definition?: unknown;
        inputs?: Record<string, unknown>;
        name?: string;
      };
      if (!definition || typeof definition !== 'object') {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Body.definition (FlowlibDefinition) is required',
        });
      }
      const result = await flowlib.runs.runEphemeral(definition as never, inputs ?? {}, {
        name,
        initiatedBy: req.flowlibIdentity?.id,
      });
      res.json(result);
    },
  );

  /**
   * POST /runs/ephemeral - Alias for /flow-runs/ephemeral.
   */
  router.post(
    '/runs/ephemeral',
    requirePermission('flow:create'),
    async (req: Request, res: Response) => {
      const { definition, inputs, name } = (req.body ?? {}) as {
        definition?: unknown;
        inputs?: Record<string, unknown>;
        name?: string;
      };
      if (!definition || typeof definition !== 'object') {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Body.definition (FlowlibDefinition) is required',
        });
      }
      const result = await flowlib.runs.runEphemeral(definition as never, inputs ?? {}, {
        name,
        initiatedBy: req.flowlibIdentity?.id,
      });
      res.json(result);
    },
  );

  /**
   * POST /node-executions/list - Get all node executions with optional filtering and pagination
   * Core method: ✅ listNodeExecutions(options?: QueryOptions<NodeExecution>)
   * Body: QueryOptions<NodeExecution>
   * Permission: flow-run:read
   */
  router.post(
    '/node-executions/list',
    requirePermission('flow-run:read'),
    async (req: Request, res: Response) => {
      const nodeExecutions = await flowlib.runs.listNodeExecutions(req.body);
      res.json(nodeExecutions);
    },
  );

  // =====================================
  // NODE DATA & TESTING ROUTES
  // =====================================

  /**
   * POST /node-data/test-expression - Test a JS expression in the QuickJS sandbox
   * Core method: ✅ testJsExpression({ expression, context })
   * Permission: flow:update
   */
  router.post(
    '/node-data/test-expression',
    requirePermission('flow:update'),
    async (req: Request, res: Response) => {
      const result = await flowlib.testing.testJsExpression(req.body);
      res.json(result);
    },
  );

  /**
   * POST /node-data/test-mapper - Test a mapper expression with mode semantics
   * Core method: ✅ testMapper({ expression, incomingData, mode? })
   * Permission: flow:update
   */
  router.post(
    '/node-data/test-mapper',
    requirePermission('flow:update'),
    async (req: Request, res: Response) => {
      const result = await flowlib.testing.testMapper(req.body);
      res.json(result);
    },
  );

  /**
   * POST /node-data/model-query - Test model prompt
   * Core method: ✅ testModelPrompt(request: SubmitPromptRequest)
   * Permission: flow:update
   */
  router.post(
    '/node-data/model-query',
    requirePermission('flow:update'),
    async (req: Request, res: Response) => {
      const result = await flowlib.testing.testModelPrompt(req.body);
      res.json(result);
    },
  );

  /**
   * GET /node-data/models - Get available AI models
   * Core method: ✅ getAvailableModels()
   * Permission: flow:read
   */
  router.get(
    '/node-data/models',
    requirePermission('flow:read'),
    async (req: Request, res: Response) => {
      const credentialId =
        typeof req.query.credentialId === 'string' ? req.query.credentialId.trim() : '';
      const providerQuery =
        typeof req.query.provider === 'string' ? req.query.provider.trim().toUpperCase() : '';

      if (credentialId) {
        const response = await flowlib.testing.getModelsForCredential(credentialId);
        res.json(response);
        return;
      }

      if (providerQuery) {
        if (!Object.values(BatchProvider).includes(providerQuery as BatchProvider)) {
          res.status(400).json({
            error: 'INVALID_PROVIDER',
            message: `Unsupported provider '${providerQuery}'. Expected one of: ${Object.values(BatchProvider).join(', ')}`,
          });
          return;
        }

        const provider = providerQuery as BatchProvider;
        const response = await flowlib.testing.getModelsForProvider(provider);
        res.json(response);
        return;
      }

      const models = await flowlib.testing.getAvailableModels();
      res.json(models);
    },
  );

  /**
   * POST /node-config/update - Generic node configuration updates
   * Core method: ✅ handleNodeConfigUpdate(event: NodeConfigUpdateEvent)
   * Permission: flow:update
   */
  router.post(
    '/node-config/update',
    requirePermission('flow:update'),
    async (req: Request, res: Response) => {
      const response = await flowlib.actions.handleConfigUpdate(req.body);
      res.json(response);
    },
  );

  router.get(
    '/node-definition/:nodeType',
    requirePermission('flow:read'),
    async (req: Request, res: Response) => {
      const nodeTypeParam = param(req, 'nodeType') ?? '';

      if (!nodeTypeParam.includes('.')) {
        res.status(400).json({
          error: 'INVALID_NODE_TYPE',
          message: `Unknown node type '${nodeTypeParam}'`,
        });
        return;
      }

      const params = parseParamsFromQuery(req.query.params);
      const changeField =
        typeof req.query.changeField === 'string' ? req.query.changeField : undefined;
      const changeValue = coerceQueryValue(req.query.changeValue);
      const nodeId = typeof req.query.nodeId === 'string' ? req.query.nodeId : undefined;
      const flowId = typeof req.query.flowId === 'string' ? req.query.flowId : undefined;

      const response = await flowlib.actions.handleConfigUpdate({
        nodeType: nodeTypeParam,
        nodeId: nodeId ?? `definition-${nodeTypeParam.toLowerCase()}`,
        flowId,
        params,
        change: changeField ? { field: changeField, value: changeValue } : undefined,
      });

      res.json(response);
    },
  );

  /**
   * GET /nodes - Get available node definitions
   * Core method: ✅ getAvailableNodes()
   * Permission: flow:read
   */
  router.get('/nodes', requirePermission('flow:read'), async (req: Request, res: Response) => {
    const nodes = flowlib.actions.getAvailableNodes();
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.json(nodes);
  });

  /**
   * GET /actions/:actionId/fields/:fieldName/options - Load dynamic field options
   * Core method: ✅ resolveFieldOptions(actionId, fieldName, deps)
   *
   * Query params:
   *   deps - JSON-encoded object of dependency field values
   * Permission: flow:read
   */
  router.get(
    '/actions/:actionId/fields/:fieldName/options',
    requirePermission('flow:read'),
    async (req: Request, res: Response) => {
      const actionId = param(req, 'actionId');
      const fieldName = param(req, 'fieldName');

      let dependencyValues: Record<string, unknown> = {};
      if (typeof req.query.deps === 'string') {
        try {
          dependencyValues = JSON.parse(req.query.deps);
        } catch {
          res.status(400).json({ error: 'Invalid deps JSON' });
          return;
        }
      }

      const result = await flowlib.actions.resolveFieldOptions(
        actionId,
        fieldName,
        dependencyValues,
      );
      res.json(result);
    },
  );

  /**
   * POST /nodes/test - Test/execute a single node in isolation
   * Core method: ✅ testNode(nodeType, params, inputData)
   * Body: { nodeType: string, params: Record<string, unknown>, inputData?: Record<string, unknown> }
   * Permission: flow:update
   */
  router.post(
    '/nodes/test',
    requirePermission('flow:update'),
    async (req: Request, res: Response) => {
      const { nodeType, params, inputData } = req.body;

      if (!nodeType || typeof nodeType !== 'string') {
        return res.status(400).json({ error: 'nodeType is required and must be a string' });
      }

      if (!params || typeof params !== 'object') {
        return res.status(400).json({ error: 'params is required and must be an object' });
      }

      const result = await flowlib.testing.testNode(nodeType, params, inputData || {});
      res.json(result);
    },
  );

  // =====================================
  // CREDENTIALS MANAGEMENT ROUTES
  // =====================================

  /**
   * POST /credentials - Create a new credential
   * Core method: ✅ createCredential(input: CreateCredentialInput)
   * Permission: credential:create
   */
  router.post(
    '/credentials',
    requirePermission('credential:create'),
    async (req: Request, res: Response) => {
      // Resolve userId from auth context, body, or header; fallback to identity id or 'anonymous'
      const resolvedUserId =
        req.flowlibIdentity?.id ||
        (req as Request & { user?: { id?: string } }).user?.id ||
        req.body.userId ||
        req.header('x-user-id') ||
        'anonymous';

      const credential = await flowlib.credentials.create({ ...req.body, userId: resolvedUserId });
      res.status(201).json(credential);
    },
  );

  /**
   * GET /credentials - List credentials with optional filtering and pagination
   * Core method: ✅ listCredentials(filters?: CredentialFilters, options?: QueryOptions)
   * Query params: type?, authType?, isActive?, page?, limit?
   * Permission: credential:read
   */
  router.get(
    '/credentials',
    requirePermission('credential:read'),
    async (req: Request, res: Response) => {
      const filters: CredentialFilters = {
        type: req.query.type as CredentialFilters['type'],
        authType: req.query.authType as CredentialFilters['authType'],
        isActive:
          req.query.isActive === 'true' ? true : req.query.isActive === 'false' ? false : undefined,
      };
      const credentials = await flowlib.credentials.list(filters);
      res.json(credentials);
    },
  );

  /**
   * GET /credentials/:id - Get credential by ID
   * Core method: ✅ getCredential(id: string)
   * Permission: credential:read (with resource check)
   */
  router.get(
    '/credentials/:id',
    requirePermission('credential:read', (req) => param(req, 'id')),
    async (req: Request, res: Response) => {
      const credential = await flowlib.credentials.getSanitized(param(req, 'id'));
      res.json(credential);
    },
  );

  /**
   * PUT /credentials/:id - Update credential
   * Core method: ✅ updateCredential(id: string, input: UpdateCredentialInput)
   * Permission: credential:update (with resource check)
   */
  router.put(
    '/credentials/:id',
    requirePermission('credential:update', (req) => param(req, 'id')),
    async (req: Request, res: Response) => {
      const credential = await flowlib.credentials.update(param(req, 'id'), req.body);
      res.json(credential);
    },
  );

  /**
   * DELETE /credentials/:id - Delete credential
   * Core method: ✅ deleteCredential(id: string)
   * Permission: credential:delete (with resource check)
   */
  router.delete(
    '/credentials/:id',
    requirePermission('credential:delete', (req) => param(req, 'id')),
    async (req: Request, res: Response) => {
      await flowlib.credentials.delete(param(req, 'id'));
      res.status(204).send();
    },
  );

  /**
   * POST /credentials/:id/test - Test credential validity
   * Core method: ✅ testCredential(id: string)
   * Permission: credential:read (with resource check)
   */
  router.post(
    '/credentials/:id/test',
    requirePermission('credential:read', (req) => param(req, 'id')),
    async (req: Request, res: Response) => {
      const result = await flowlib.credentials.test(param(req, 'id'));
      res.json(result);
    },
  );

  /**
   * POST /credentials/:id/track-usage - Update credential last used timestamp
   * Core method: ✅ updateCredentialLastUsed(id: string)
   * Permission: credential:read (with resource check)
   */
  router.post(
    '/credentials/:id/track-usage',
    requirePermission('credential:read', (req) => param(req, 'id')),
    async (req: Request, res: Response) => {
      await flowlib.credentials.updateLastUsed(param(req, 'id'));
      res.status(204).send();
    },
  );

  /**
   * GET /credentials/expiring - Get credentials expiring soon
   * Core method: ✅ getExpiringCredentials(daysUntilExpiry?: number)
   * Query params: daysUntilExpiry (default: 7)
   * Permission: credential:read
   */
  router.get(
    '/credentials/expiring',
    requirePermission('credential:read'),
    async (req: Request, res: Response) => {
      const daysUntilExpiry = req.query.daysUntilExpiry
        ? parseInt(req.query.daysUntilExpiry as string)
        : 7;

      const credentials = await flowlib.credentials.getExpiring(daysUntilExpiry);
      res.json(credentials);
    },
  );

  /**
   * POST /credentials/test-request - Test a credential by making an HTTP request
   * This endpoint proxies HTTP requests to avoid CORS issues when testing credentials
   * Body: { url, method, headers, body }
   * Permission: credential:read
   */
  router.post(
    '/credentials/test-request',
    requirePermission('credential:read'),
    async (req: Request, res: Response) => {
      const { url, method = 'GET', headers = {}, body } = req.body;

      if (!url) {
        res.status(400).json({ error: 'URL is required' });
        return;
      }

      // Validate URL to prevent SSRF
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(url);
      } catch {
        res.status(400).json({ error: 'Invalid URL' });
        return;
      }
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        res.status(400).json({ error: 'Only HTTP and HTTPS protocols are allowed' });
        return;
      }

      // Resolve hostname to IP and check against private ranges to prevent
      // DNS rebinding, decimal/octal IP encoding, and IPv6 mapped addresses.
      const { promises: dns } = await import('node:dns');
      let resolvedIps: string[];
      try {
        const results = await dns.lookup(parsedUrl.hostname, { all: true });
        resolvedIps = results.map((r) => r.address);
      } catch {
        res.status(400).json({ error: 'Could not resolve hostname' });
        return;
      }

      const { isIP } = await import('node:net');
      for (const ip of resolvedIps) {
        const version = isIP(ip);
        if (version === 4) {
          const parts = ip.split('.').map(Number);
          if (
            parts[0] === 127 ||
            parts[0] === 10 ||
            parts[0] === 0 ||
            (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
            (parts[0] === 192 && parts[1] === 168) ||
            (parts[0] === 169 && parts[1] === 254)
          ) {
            res
              .status(400)
              .json({ error: 'Requests to private/internal network addresses are not allowed' });
            return;
          }
        } else if (version === 6) {
          // Block loopback (::1), link-local (fe80::), ULA (fc/fd), and IPv4-mapped (::ffff:x.x.x.x)
          const lower = ip.toLowerCase();
          if (
            lower === '::1' ||
            lower.startsWith('fe80') ||
            lower.startsWith('fc') ||
            lower.startsWith('fd') ||
            lower.startsWith('::ffff:')
          ) {
            res
              .status(400)
              .json({ error: 'Requests to private/internal network addresses are not allowed' });
            return;
          }
        }
      }

      try {
        const fetchOptions: RequestInit = {
          method,
          headers: headers as Record<string, string>,
          redirect: 'error', // Prevent open redirects to internal IPs
        };

        if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
          fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
        }

        // codeql[js/request-forgery] SSRF mitigated: URL is validated (protocol allowlist), hostname is DNS-resolved and checked against private/internal IP ranges above, and redirects are disabled.
        const response = await fetch(url, fetchOptions);
        const responseText = await response.text();

        // Try to parse as JSON, fallback to text
        let responseBody: unknown;
        try {
          responseBody = JSON.parse(responseText);
        } catch {
          responseBody = responseText;
        }

        res.json({
          status: response.status,
          statusText: response.statusText,
          ok: response.ok,
          body: responseBody,
        });
      } catch (error) {
        res.status(500).json({
          error: 'Request failed',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    },
  );

  // =====================================
  // OAUTH2 ROUTES
  // =====================================

  /**
   * GET /credentials/oauth2/providers - List all available OAuth2 providers
   * Permission: credential:read
   */
  router.get(
    '/credentials/oauth2/providers',
    requirePermission('credential:read'),
    async (_req: Request, res: Response) => {
      const providers = flowlib.credentials.getOAuth2Providers();
      res.json(providers);
    },
  );

  /**
   * GET /credentials/oauth2/providers/:providerId - Get a specific OAuth2 provider
   * Permission: credential:read
   */
  router.get(
    '/credentials/oauth2/providers/:providerId',
    requirePermission('credential:read'),
    async (req: Request, res: Response) => {
      const provider = flowlib.credentials.getOAuth2Provider(param(req, 'providerId'));
      if (!provider) {
        res.status(404).json({ error: 'OAuth2 provider not found' });
        return;
      }
      res.json(provider);
    },
  );

  /**
   * POST /credentials/oauth2/start - Start OAuth2 authorization flow
   * Body: { providerId, clientId, clientSecret, redirectUri, scopes?, returnUrl?, credentialName? }
   *   OR  { existingCredentialId, redirectUri, scopes?, returnUrl? } — secrets read from stored credential
   * Returns: { authorizationUrl, state }
   * Permission: credential:create
   */
  router.post(
    '/credentials/oauth2/start',
    requirePermission('credential:create'),
    async (req: Request, res: Response) => {
      const {
        providerId,
        clientId,
        clientSecret,
        redirectUri,
        scopes,
        returnUrl,
        credentialName,
        existingCredentialId,
      } = req.body;

      // When reconnecting an existing credential, resolve secrets from the DB
      if (existingCredentialId && redirectUri) {
        const result = await flowlib.credentials.startOAuth2FlowForCredential(
          existingCredentialId,
          redirectUri,
          { scopes, returnUrl },
        );
        res.json(result);
        return;
      }

      if (!providerId || !clientId || !clientSecret || !redirectUri) {
        res.status(400).json({
          error: 'Missing required fields: providerId, clientId, clientSecret, redirectUri',
        });
        return;
      }

      const result = flowlib.credentials.startOAuth2Flow(
        providerId,
        { clientId, clientSecret, redirectUri },
        { scopes, returnUrl, credentialName, existingCredentialId },
      );

      res.json(result);
    },
  );

  /**
   * POST /credentials/oauth2/callback - Handle OAuth2 callback and exchange code for tokens
   * Body: { code, state, redirectUri, clientId?, clientSecret? }
   * clientId/clientSecret are optional — resolved from pending state if omitted
   * Permission: credential:create
   */
  router.post(
    '/credentials/oauth2/callback',
    requirePermission('credential:create'),
    async (req: Request, res: Response) => {
      const { code, state, clientId, clientSecret, redirectUri } = req.body;

      if (!code || !state) {
        res.status(400).json({
          error: 'Missing required fields: code, state',
        });
        return;
      }

      // Pass appConfig only if explicitly provided (new flows from OAuth2ProviderSelector)
      const appConfig =
        clientId && clientSecret && redirectUri
          ? { clientId, clientSecret, redirectUri }
          : undefined;

      const credential = await flowlib.credentials.handleOAuth2Callback(code, state, appConfig);

      res.json(credential);
    },
  );

  /**
   * GET /credentials/oauth2/callback - Handle OAuth2 callback (for redirect-based flows)
   * Query: code, state
   * Redirects to the return URL with credential ID or error
   */
  router.get('/credentials/oauth2/callback', async (req: Request, res: Response) => {
    const { code, state, error, error_description } = req.query;

    // Check for OAuth error
    if (error) {
      const errorMsg = error_description || error;
      // Get pending state to find return URL
      const pendingState = flowlib.credentials.getOAuth2PendingState(state as string);
      const returnUrl = pendingState?.returnUrl || '/';
      const separator = returnUrl.includes('?') ? '&' : '?';
      res.redirect(`${returnUrl}${separator}oauth_error=${encodeURIComponent(errorMsg as string)}`);
      return;
    }

    if (!code || !state) {
      res.status(400).json({ error: 'Missing code or state parameter' });
      return;
    }

    // Get pending state to retrieve client credentials and return URL
    const pendingState = flowlib.credentials.getOAuth2PendingState(state as string);
    if (!pendingState) {
      res.status(400).json({ error: 'Invalid or expired OAuth state' });
      return;
    }

    // Do not echo the authorization code — instruct the client to use POST instead
    res.json({
      message:
        'OAuth callback received. Use POST /credentials/oauth2/callback to exchange the code.',
      providerId: pendingState.providerId,
      returnUrl: pendingState.returnUrl,
    });
  });

  /**
   * POST /credentials/:id/refresh - Manually refresh an OAuth2 credential's access token
   * Permission: credential:update (with resource check)
   */
  router.post(
    '/credentials/:id/refresh',
    requirePermission('credential:update', (req) => param(req, 'id')),
    async (req: Request, res: Response) => {
      const credential = await flowlib.credentials.refreshOAuth2Credential(param(req, 'id'));
      res.json(credential);
    },
  );

  // =====================================
  // TRIGGER MANAGEMENT ROUTES
  // =====================================

  /**
   * GET /flows/:flowId/triggers - List all trigger registrations for a flow
   * Core method: ✅ listTriggersForFlow(flowId)
   * Permission: flow:read (with resource check)
   */
  router.get(
    '/flows/:flowId/triggers',
    requirePermission('flow:read', (req) => param(req, 'flowId')),
    async (req: Request, res: Response) => {
      const triggers = await flowlib.triggers.list(param(req, 'flowId'));
      res.json(triggers);
    },
  );

  /**
   * POST /flows/:flowId/triggers - Create a trigger registration for a flow
   * Core method: ✅ createTrigger(input)
   * Permission: flow:update (with resource check)
   */
  router.post(
    '/flows/:flowId/triggers',
    requirePermission('flow:update', (req) => param(req, 'flowId')),
    async (req: Request, res: Response) => {
      const trigger = await flowlib.triggers.create({
        ...req.body,
        flowId: param(req, 'flowId'),
      });
      res.status(201).json(trigger);
    },
  );

  /**
   * POST /flows/:flowId/triggers/sync - Sync triggers from the flow definition
   * Core method: ✅ syncTriggersForFlow(flowId, definition)
   * Permission: flow:update (with resource check)
   */
  router.post(
    '/flows/:flowId/triggers/sync',
    requirePermission('flow:update', (req) => param(req, 'flowId')),
    async (req: Request, res: Response) => {
      const { definition } = req.body;
      const triggers = await flowlib.triggers.sync(param(req, 'flowId'), definition);
      res.json(triggers);
    },
  );

  /**
   * GET /triggers/:triggerId - Get a single trigger by ID
   * Core method: ✅ getTrigger(triggerId)
   * Permission: flow:read
   */
  router.get(
    '/triggers/:triggerId',
    requirePermission('flow:read'),
    async (req: Request, res: Response) => {
      const trigger = await flowlib.triggers.get(param(req, 'triggerId'));
      if (!trigger) {
        return res.status(404).json({
          error: 'Not Found',
          message: `Trigger ${param(req, 'triggerId')} not found`,
        });
      }
      res.json(trigger);
    },
  );

  /**
   * PUT /triggers/:triggerId - Update a trigger registration
   * Core method: ✅ updateTrigger(triggerId, input)
   * Permission: flow:update
   */
  router.put(
    '/triggers/:triggerId',
    requirePermission('flow:update'),
    async (req: Request, res: Response) => {
      const trigger = await flowlib.triggers.update(param(req, 'triggerId'), req.body);
      if (!trigger) {
        return res.status(404).json({
          error: 'Not Found',
          message: `Trigger ${param(req, 'triggerId')} not found`,
        });
      }
      res.json(trigger);
    },
  );

  /**
   * DELETE /triggers/:triggerId - Delete a trigger registration
   * Core method: ✅ deleteTrigger(triggerId)
   * Permission: flow:delete
   */
  router.delete(
    '/triggers/:triggerId',
    requirePermission('flow:delete'),
    async (req: Request, res: Response) => {
      await flowlib.triggers.delete(param(req, 'triggerId'));
      res.status(204).send();
    },
  );

  // =====================================
  // AGENT TOOLS ROUTES
  // =====================================

  /**
   * GET /agent/tools - List all available agent tools
   * Core method: ✅ getAgentTools()
   * Permission: flow:read
   */
  router.get(
    '/agent/tools',
    requirePermission('flow:read'),
    async (_req: Request, res: Response) => {
      const tools = flowlib.agent.getTools();
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.json(tools);
    },
  );

  // =====================================
  // CHAT ASSISTANT ROUTES
  // =====================================

  /**
   * GET /chat/status - Check if chat assistant is enabled
   * Core method: ✅ isChatEnabled()
   * Permission: flow:read
   */
  router.get(
    '/chat/status',
    requirePermission('flow:read'),
    async (_req: Request, res: Response) => {
      res.json({ enabled: flowlib.chat.isEnabled() });
    },
  );

  /**
   * POST /chat - Streaming chat assistant endpoint (SSE)
   * Core method: ✅ createChatStream()
   *
   * Request body: { messages: ChatMessage[], context: ChatContext }
   * Response: Server-Sent Events stream of ChatStreamEvents
   */

  /**
   * GET /chat/models/:credentialId - List available models for a credential
   * Core method: ✅ listChatModels()
   * Permission: flow:read
   */
  router.get(
    '/chat/models/:credentialId',
    requirePermission('flow:read'),
    async (req: Request, res: Response) => {
      const q = typeof req.query.q === 'string' ? req.query.q : undefined;
      const models = await flowlib.chat.listModels(param(req, 'credentialId'), q);
      res.json(models);
    },
  );

  router.post('/chat', requirePermission('flow:update'), async (req: Request, res: Response) => {
    const { messages, context } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({
        error: 'Validation Error',
        message: '"messages" must be an array of chat messages',
      });
    }

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
    res.flushHeaders();

    // Resolve identity for RBAC (from middleware)
    const identity =
      (req as Request & { __flowlibIdentity?: FlowlibIdentity | null }).__flowlibIdentity ?? undefined;

    try {
      const stream = await flowlib.chat.createStream({
        messages,
        context: context || {},
        identity,
      });

      // Stream events as SSE frames
      for await (const event of stream) {
        // Check if client disconnected
        if (res.destroyed) {
          break;
        }

        const data = JSON.stringify(event);
        res.write(`event: ${event.type}\ndata: ${data}\n\n`);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Chat stream failed';
      // If headers already sent, write error as SSE event
      if (res.headersSent) {
        res.write(
          `event: error\ndata: ${JSON.stringify({ type: 'error', message, recoverable: false })}\n\n`,
        );
      } else {
        return res.status(500).json({ error: 'Internal Server Error', message });
      }
    } finally {
      res.end();
    }
  });

  /**
   * GET /chat/stream/:sessionId - Reattach to an in-flight chat session.
   *
   * Replays buffered events for the session then tails live events until
   * generation completes. Used by the frontend to resume a streaming turn
   * after a page refresh without losing the in-flight response.
   */
  router.get(
    '/chat/stream/:sessionId',
    requirePermission('flow:update'),
    async (req: Request, res: Response) => {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();

      const sessionId = param(req, 'sessionId');
      const abortController = new AbortController();
      req.on('close', () => abortController.abort());

      try {
        const stream = flowlib.chat.subscribeToSession(sessionId, abortController.signal);
        for await (const event of stream) {
          if (res.destroyed) {
            break;
          }
          res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Chat reattach failed';
        res.write(
          `event: error\ndata: ${JSON.stringify({ type: 'error', message, recoverable: false })}\n\n`,
        );
      } finally {
        res.end();
      }
    },
  );

  // =====================================
  // CHAT MESSAGE PERSISTENCE ROUTES
  // =====================================

  /**
   * GET /chat/messages/:flowId - Get persisted chat messages for a flow
   * Core method: ✅ getChatMessages()
   * Query params: page, limit
   * Permission: flow:read
   */
  router.get(
    '/chat/messages/:flowId',
    requirePermission('flow:read'),
    async (req: Request, res: Response) => {
      const page = typeof req.query.page === 'string' ? parseInt(req.query.page, 10) : undefined;
      const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : undefined;
      const messages = await flowlib.chat.getMessages(param(req, 'flowId'), {
        ...(page ? { page } : {}),
        ...(limit ? { limit } : {}),
      });
      res.json(messages);
    },
  );

  /**
   * PUT /chat/messages/:flowId - Save (replace) chat messages for a flow
   * Core method: ✅ saveChatMessages()
   *
   * Request body: { messages: Array<{ role, content, toolMeta? }> }
   * Permission: flow:update
   */
  router.put(
    '/chat/messages/:flowId',
    requirePermission('flow:update'),
    async (req: Request, res: Response) => {
      const { messages } = req.body;
      if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({
          error: 'Validation Error',
          message: '"messages" must be an array',
        });
      }
      const saved = await flowlib.chat.saveMessages(param(req, 'flowId'), messages);
      res.json(saved);
    },
  );

  /**
   * DELETE /chat/messages/:flowId - Delete all chat messages for a flow
   * Core method: ✅ deleteChatMessages()
   * Permission: flow:delete
   */
  router.delete(
    '/chat/messages/:flowId',
    requirePermission('flow:delete'),
    async (req: Request, res: Response) => {
      await flowlib.chat.deleteMessages(param(req, 'flowId'));
      res.json({ success: true });
    },
  );

  // =====================================
  // PLUGIN ENDPOINTS
  // Mount API endpoints defined by plugins via flowlib.plugins.getEndpoints()
  // =====================================
  router.all('/plugins/*path', async (req: Request, res: Response) => {
    const endpoints = flowlib.plugins.getEndpoints();
    // Strip the /plugins prefix — endpoint paths are defined relative to it
    // e.g. req.path="/plugins/auth/api/auth/sign-in/email" → "/auth/api/auth/sign-in/email"
    const pluginPath = (req.path || '/').replace(/^\/plugins/, '') || '/';
    const method = req.method.toUpperCase();

    const matchedEndpoint = endpoints.find((ep) => {
      if (ep.method !== method) {
        return false;
      }
      // Path matching with Express-style :params and * wildcards
      const pattern = ep.path
        .replace(/\*/g, '(.*)') // wildcard * → match any path segments
        .replace(/:([^/]+)/g, '([^/]+)'); // :param → match single segment
      // oxlint-disable-next-line security/detect-non-literal-regexp -- pattern built from registered plugin endpoint paths
      return new RegExp(`^${pattern}$`).test(pluginPath);
    });

    if (!matchedEndpoint) {
      return res.status(404).json({
        error: 'Not Found',
        message: `Plugin route ${method} ${pluginPath} not found`,
      });
    }

    // Extract path params
    const paramNames: string[] = [];
    const paramPattern = matchedEndpoint.path
      .replace(/\*/g, '(.*)') // wildcard * → match rest of path
      .replace(/:([^/]+)/g, (_m, name) => {
        paramNames.push(name);
        return '([^/]+)';
      });
    // oxlint-disable-next-line security/detect-non-literal-regexp -- pattern built from registered plugin endpoint paths
    const paramMatch = new RegExp(`^${paramPattern}$`).exec(pluginPath);
    const params: Record<string, string> = {};
    if (paramMatch) {
      paramNames.forEach((name, i) => {
        params[name] = paramMatch[i + 1] || '';
      });
    }

    // Check endpoint-level auth
    if (!matchedEndpoint.isPublic && matchedEndpoint.permission) {
      const identity = req.flowlibIdentity ?? null;
      if (!flowlib.auth.hasPermission(identity, matchedEndpoint.permission)) {
        return res.status(403).json({
          error: 'Forbidden',
          message: `Missing permission: ${matchedEndpoint.permission}`,
        });
      }
    }

    // Build a Web Request from the Express req so plugin handlers
    // (e.g. user-auth) that rely on the Fetch API Request work correctly.
    const webRequestUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    const webRequestInit: RequestInit = {
      method: req.method,
      headers: req.headers as HeadersInit,
    };
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'DELETE') {
      // Re-serialize the already-parsed body so the stream is consumable
      webRequestInit.body = JSON.stringify(req.body || {});
    }
    const webRequest = new globalThis.Request(webRequestUrl, webRequestInit);

    const result = await matchedEndpoint.handler({
      body: req.body || {},
      params,
      query: (req.query || {}) as Record<string, string | undefined>,
      headers: req.headers as Record<string, string | undefined>,
      identity: req.flowlibIdentity ?? null,
      database: createPluginDatabaseApi(flowlib.plugins.getDatabaseConnection()),
      request: webRequest,
      core: {
        getPermissions: (identity) => flowlib.auth.getPermissions(identity),
        getAvailableRoles: () => flowlib.auth.getAvailableRoles(),
        getResolvedRole: (identity) => flowlib.auth.getResolvedRole(identity),
        authorize: (context) => flowlib.auth.authorize(context),
      },
      getFlowlib: () => flowlib,
    });

    // Handle raw Response objects
    if (result instanceof Response) {
      const arrayBuf = await result.arrayBuffer();
      res.status(result.status);
      // Forward all headers — but handle Set-Cookie specially since
      // Headers.forEach() combines multiple Set-Cookie values into one
      // comma-separated string, which breaks cookie parsing.
      result.headers.forEach((value, key) => {
        if (key.toLowerCase() !== 'set-cookie') {
          res.setHeader(key, value);
        }
      });
      // Use getSetCookie() to get individual Set-Cookie headers intact
      const setCookies = result.headers.getSetCookie?.();
      if (setCookies && setCookies.length > 0) {
        res.setHeader('set-cookie', setCookies);
      }
      res.send(Buffer.from(arrayBuf));
      return;
    }

    // Handle streaming responses
    if ('stream' in result && result.stream) {
      res.status(result.status || 200);
      res.setHeader('Content-Type', 'text/event-stream');
      const reader = result.stream.getReader();
      const pump = async () => {
        const { done, value } = await reader.read();
        if (done) {
          res.end();
          return;
        }
        res.write(value);
        await pump();
      };
      await pump();
      return;
    }

    // Standard JSON response
    const jsonResult = result as { status?: number; body: unknown };
    res.status(jsonResult.status || 200).json(jsonResult.body);
  });

  // Error handling middleware - must be last
  router.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
    // Handle Zod validation errors
    if (error instanceof ZodError) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Invalid request data',
        details: error.errors.map((err) => ({
          path: err.path.join('.'),
          message: err.message,
          code: err.code,
        })),
      });
    }

    // Handle other known errors
    if (error.name === 'ValidationError') {
      const ve = error as Error & {
        field?: string;
        context?: Record<string, unknown>;
      };
      return res.status(400).json({
        error: 'Validation Error',
        message: error.message || 'Validation failed',
        field: ve.field,
        details: ve.context,
      });
    }

    if (error.name === 'DatabaseError') {
      return res.status(500).json({
        error: 'Database Error',
        message: error.message || 'A database error occurred',
      });
    }

    // Handle generic errors
    // eslint-disable-next-line no-console
    console.error('Flowlib Router Error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'An unexpected error occurred',
    });
  });

  return router;
}
