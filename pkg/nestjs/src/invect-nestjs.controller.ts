import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Inject,
  Req,
  Res,
  All,
  BadRequestException,
  NotFoundException,
  HttpCode,
  Header,
} from '@nestjs/common';
import { BatchProvider, FlowValidationResult, createPluginDatabaseApi } from '@flowlib/core';
import type {
  InvectInstance,
  NodeConfigUpdateEvent,
  NodeConfigUpdateResponse,
  CreateFlowRequest,
  UpdateFlowInput,
  InvectDefinition,
  QueryOptions,
  CreateFlowVersionRequest,
  ExecuteFlowOptions,
  SubmitPromptRequest,
  Flow,
  FlowVersion,
  FlowRun,
  NodeExecution,
  FlowInputs,
  CreateCredentialInput,
  UpdateCredentialInput,
  CredentialFilters,
  CreateTriggerInput,
  UpdateTriggerInput,
  ChatStreamEvent,
  InvectIdentity,
  ChatMessage,
} from '@flowlib/core';
import type { Request, Response } from 'express';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      invectIdentity?: InvectIdentity | null;
    }
  }
}

function parseParamsFromQuery(value: unknown): Record<string, unknown> {
  if (!value) {
    return {};
  }

  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }

  if (Array.isArray(value)) {
    const last = value[value.length - 1];
    if (typeof last === 'string') {
      try {
        return JSON.parse(last);
      } catch {
        return {};
      }
    }
    return {};
  }

  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).reduce<Record<string, unknown>>(
      (acc, [key, entry]) => {
        acc[key] = Array.isArray(entry) ? entry[entry.length - 1] : entry;
        return acc;
      },
      {},
    );
  }

  return {};
}

function coerceQueryValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value[value.length - 1];
  }
  return value ?? undefined;
}

@Controller()
export class InvectController {
  constructor(@Inject('INVECT_CORE') private readonly flowlib: InvectInstance) {}

  // =====================================
  // FLOW MANAGEMENT ROUTES
  // =====================================

  /**
   * GET /flows - List flows with optional filtering and pagination
   * Core method: ✅ listFlows(options?: QueryOptions<Flow>)
   */
  @Get('flows')
  async listFlows(@Query() query: Record<string, unknown>) {
    return await this.flowlib.flows.list(query as QueryOptions<Flow>);
  }

  /**
   * GET /flows/list - List flows (Express-compatible alias)
   * POST /flows/list - List flows with body filters (Express-compatible alias)
   */
  @Get('flows/list')
  async listFlowsGetAlias(@Query() query: Record<string, unknown>) {
    return await this.flowlib.flows.list(query as QueryOptions<Flow>);
  }

  @Post('flows/list')
  async listFlowsPostAlias(@Body() body: Record<string, unknown>) {
    return await this.flowlib.flows.list(body as QueryOptions<Flow>);
  }

  /**
   * POST /flows - Create a new flow
   * Core method: ✅ createFlow(flowData: CreateFlowRequest)
   */
  @Post('flows')
  async createFlow(@Body() body: CreateFlowRequest) {
    return await this.flowlib.flows.create(body);
  }

  /**
   * GET /flows/:id - Get flow by ID
   * Core method: ✅ getFlow(flowId: string)
   */
  @Get('flows/:id')
  async getFlow(@Param('id') id: string) {
    return await this.flowlib.flows.get(id);
  }

  /**
   * PUT /flows/:id - Update flow
   * Core method: ✅ updateFlow(flowId: string, updateData: UpdateFlowInput)
   */
  @Put('flows/:id')
  async updateFlow(@Param('id') id: string, @Body() body: UpdateFlowInput) {
    return await this.flowlib.flows.update(id, body);
  }

  /**
   * DELETE /flows/:id - Delete flow
   * Core method: ✅ deleteFlow(flowId: string)
   */
  @Delete('flows/:id')
  async deleteFlow(@Param('id') id: string) {
    await this.flowlib.flows.delete(id);
    // NestJS automatically returns 200 OK for successful DELETE operations
    // If you prefer 204 No Content, you can add @HttpCode(204) decorator
  }

  /**
   * POST /validate-flow - Validate flow definition
   * Core method: ✅ validateFlowDefinition(flowId: string, flowDefinition: InvectDefinition)
   */
  @Post('validate-flow')
  async validateFlow(
    @Body() body: { flowId: string; flowDefinition: InvectDefinition },
  ): Promise<FlowValidationResult> {
    const { flowId, flowDefinition } = body;
    return await this.flowlib.flows.validate(flowId, flowDefinition);
  }

  /**
   * GET /flows/:flowId/react-flow - Get flow data in React Flow format
   * Core method: ✅ renderToReactFlow(flowId, options)
   */
  @Get('flows/:flowId/react-flow')
  async renderToReactFlow(
    @Param('flowId') flowId: string,
    @Query('version') version?: string,
    @Query('flowRunId') flowRunId?: string,
  ) {
    const options: Record<string, unknown> = {};
    if (version) {
      options.version = version;
    }
    if (flowRunId) {
      options.flowRunId = flowRunId;
    }
    return await this.flowlib.flows.renderToReactFlow(flowId, options);
  }

  // =====================================
  // FLOW VERSION MANAGEMENT ROUTES
  // =====================================

  /**
   * POST /flows/:id/versions/list - Get flow versions with optional filtering and pagination
   * Core method: ✅ listFlowVersions(flowId, options)
   */
  @Post('flows/:id/versions/list')
  async listFlowVersionsPost(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return await this.flowlib.versions.list(id, body as QueryOptions<FlowVersion>);
  }

  /**
   * GET /flows/:id/versions - Get flow versions with optional filtering and pagination
   * Core method: ✅ listFlowVersions(flowId: string, options?: QueryOptions<FlowVersion>)
   */
  @Get('flows/:id/versions')
  async getFlowVersions(@Param('id') id: string, @Query() query: Record<string, unknown>) {
    return await this.flowlib.versions.list(id, query as QueryOptions<FlowVersion>);
  }

  /**
   * POST /flows/:id/versions - Create flow version
   * Core method: ✅ createFlowVersion(flowId: string, versionData: CreateFlowVersionRequest)
   */
  @Post('flows/:id/versions')
  async createFlowVersion(@Param('id') id: string, @Body() body: CreateFlowVersionRequest) {
    return await this.flowlib.versions.create(id, body);
  }

  /**
   * GET /flows/:id/versions/:version - Get specific flow version (supports 'latest')
   * Core method: ✅ getFlowVersion(flowId, version)
   */
  @Get('flows/:id/versions/:version')
  async getFlowVersion(@Param('id') id: string, @Param('version') version: string) {
    const result = await this.flowlib.versions.get(id, version);
    if (!result) {
      throw new NotFoundException(`Version ${version} not found for flow ${id}`);
    }
    return result;
  }

  // =====================================
  // FLOW RUN EXECUTION ROUTES
  // =====================================

  /**
   * POST /flows/:flowId/run - Start flow execution
   * Core method: ✅ startFlowRunAsync(flowId, inputs, options)
   */
  @Post('flows/:flowId/run')
  async startFlowRun(
    @Param('flowId') flowId: string,
    @Body() body: { inputs?: Record<string, unknown>; options?: ExecuteFlowOptions },
  ) {
    const { inputs = {}, options } = body;
    return await this.flowlib.runs.startAsync(flowId, inputs as FlowInputs, options);
  }

  /**
   * POST /flows/:flowId/run-to-node/:nodeId - Execute flow up to a specific node
   * Core method: ✅ executeFlowToNode(flowId, targetNodeId, inputs, options)
   */
  @Post('flows/:flowId/run-to-node/:nodeId')
  async executeFlowToNode(
    @Param('flowId') flowId: string,
    @Param('nodeId') nodeId: string,
    @Body() body: { inputs?: Record<string, unknown>; options?: ExecuteFlowOptions },
  ) {
    const { inputs = {}, options } = body;
    return await this.flowlib.runs.executeToNode(flowId, nodeId, inputs as FlowInputs, options);
  }

  /**
   * POST /flow-runs/list - List flow runs with optional filtering and pagination
   * Core method: ✅ listFlowRuns(options)
   */
  @Post('flow-runs/list')
  async listFlowRunsPost(@Body() body: Record<string, unknown>) {
    return await this.flowlib.runs.list(body as QueryOptions<FlowRun>);
  }

  /**
   * GET /flow-runs - Get all flow runs with optional filtering and pagination
   * Core method: ✅ listFlowRuns(options?: QueryOptions<FlowRun>)
   */
  @Get('flow-runs')
  async listFlowRuns(@Query() query: Record<string, unknown>) {
    return await this.flowlib.runs.list(query as QueryOptions<FlowRun>);
  }

  /**
   * GET /flow-runs/:flowRunId - Get specific flow run by ID
   * Core method: ✅ getFlowRunById(flowRunId: string)
   */
  @Get('flow-runs/:flowRunId')
  async getFlowRun(@Param('flowRunId') flowRunId: string) {
    return await this.flowlib.runs.get(flowRunId);
  }

  /**
   * GET /flows/:flowId/flow-runs - Get flow runs for a specific flow
   * Core method: ✅ listFlowRunsByFlowId(flowId: string, options?)
   * Query params: page, limit, sortBy, sortOrder
   */
  @Get('flows/:flowId/flow-runs')
  async getFlowRunsByFlowId(
    @Param('flowId') flowId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: 'asc' | 'desc',
  ) {
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
      options.sort = { sortBy, sortOrder: sortOrder ?? 'desc' };
    }
    return await this.flowlib.runs.listByFlowId(flowId, options as QueryOptions<FlowRun>);
  }

  /**
   * POST /flow-runs/:flowRunId/resume - Resume paused flow execution
   * Core method: ✅ resumeExecution(executionId: string)
   */
  @Post('flow-runs/:flowRunId/resume')
  async resumeFlowRun(@Param('flowRunId') flowRunId: string) {
    return await this.flowlib.runs.resume(flowRunId);
  }

  /**
   * POST /flow-runs/:flowRunId/cancel - Cancel flow execution
   * Core method: ✅ cancelFlowRun(flowRunId: string)
   */
  @Post('flow-runs/:flowRunId/cancel')
  async cancelFlowRun(@Param('flowRunId') flowRunId: string) {
    return await this.flowlib.runs.cancel(flowRunId);
  }

  /**
   * POST /flow-runs/:flowRunId/pause - Pause flow execution
   * Core method: ✅ pauseFlowRun(flowRunId: string, reason?: string)
   */
  @Post('flow-runs/:flowRunId/pause')
  async pauseFlowRun(@Param('flowRunId') flowRunId: string, @Body() body?: { reason?: string }) {
    const reason = body?.reason;
    return await this.flowlib.runs.pause(flowRunId, reason);
  }

  // =====================================
  // NODE EXECUTION ROUTES
  // =====================================

  /**
   * GET /flow-runs/:flowRunId/node-executions - Get node executions for a flow run
   * Core method: ✅ getNodeExecutionsByRunId(flowRunId: string, options?)
   * Query params: page, limit, sortBy, sortOrder
   */
  @Get('flow-runs/:flowRunId/node-executions')
  async getNodeExecutionsByRunId(
    @Param('flowRunId') flowRunId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: 'asc' | 'desc',
  ) {
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
      options.sort = { sortBy, sortOrder: sortOrder ?? 'desc' };
    }
    return await this.flowlib.runs.getNodeExecutions(
      flowRunId,
      options as QueryOptions<NodeExecution>,
    );
  }

  /**
   * Shared SSE handler for the run-events stream. Wired to both
   * `/flow-runs/:flowRunId/stream` (canonical) and `/runs/:flowRunId/events`
   * (alias for external clients).
   */
  private async pipeRunEventsToSse(flowRunId: string, req: Request, res: Response): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    res.socket?.setNoDelay(true);

    const flush = (res as unknown as { flush?: () => void }).flush;
    const flushIfPresent = typeof flush === 'function' ? flush.bind(res) : (): void => undefined;

    let clientGone = false;
    req.on('close', () => {
      clientGone = true;
    });

    try {
      const stream = this.flowlib.runs.createEventStream(flowRunId);
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
        res.status(500).json({ error: 'Internal Server Error', message });
        return;
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
   * NOTE: not using NestJS `@Sse()` decorator because the existing semantics
   * frame the events as `event: <type>\ndata: <json>` (a stable contract the
   * frontend, version-control, and the new VSCode extension all consume).
   * `@Sse()` would re-wrap with its own framing.
   */
  @Get('flow-runs/:flowRunId/stream')
  async streamFlowRun(
    @Param('flowRunId') flowRunId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    await this.pipeRunEventsToSse(flowRunId, req, res);
  }

  /**
   * GET /runs/:flowRunId/events - SSE stream alias.
   * Identical to `/flow-runs/:flowRunId/stream`.
   */
  @Get('runs/:flowRunId/events')
  async streamRunEvents(
    @Param('flowRunId') flowRunId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    await this.pipeRunEventsToSse(flowRunId, req, res);
  }

  /**
   * POST /flow-runs/ephemeral - Run an inline flow definition without
   * persisting it as a regular flow.
   *
   * Body: { definition: InvectDefinition, inputs?: Record<string, unknown>, name?: string }
   * Returns: { flowRunId, flowId, status, eventsPath }
   *
   * Credentials are NOT ephemeral — `credentialId` references in the
   * definition still resolve against the persisted credential store.
   */
  @Post('flow-runs/ephemeral')
  async runEphemeralFlow(
    @Body()
    body: {
      definition?: unknown;
      inputs?: Record<string, unknown>;
      name?: string;
    },
    @Req() req: Request,
  ) {
    return this.runEphemeralImpl(body, req);
  }

  /**
   * POST /runs/ephemeral - Alias for /flow-runs/ephemeral.
   */
  @Post('runs/ephemeral')
  async runEphemeralFlowAlias(
    @Body()
    body: {
      definition?: unknown;
      inputs?: Record<string, unknown>;
      name?: string;
    },
    @Req() req: Request,
  ) {
    return this.runEphemeralImpl(body, req);
  }

  private async runEphemeralImpl(
    body: { definition?: unknown; inputs?: Record<string, unknown>; name?: string } | undefined,
    req: Request,
  ) {
    if (!body?.definition || typeof body.definition !== 'object') {
      throw new BadRequestException('Body.definition (InvectDefinition) is required');
    }
    try {
      return await this.flowlib.runs.runEphemeral(
        body.definition as InvectDefinition,
        body.inputs ?? {},
        { name: body.name, initiatedBy: req.invectIdentity?.id },
      );
    } catch (error) {
      // Translate ValidationError → 400 so callers get a structured response
      // rather than NestJS's default 500.
      if (
        error &&
        typeof error === 'object' &&
        (error as { name?: string }).name === 'ValidationError'
      ) {
        const ve = error as Error & {
          field?: string;
          context?: Record<string, unknown>;
        };
        throw new BadRequestException({
          error: 'Validation Error',
          message: ve.message,
          field: ve.field,
          details: ve.context,
        });
      }
      throw error;
    }
  }

  /**
   * GET /node-executions - Get all node executions with optional filtering and pagination
   * Core method: ✅ listNodeExecutions(options?: QueryOptions<NodeExecution>)
   */
  @Get('node-executions')
  async listNodeExecutions(@Query() query: Record<string, unknown>) {
    return await this.flowlib.runs.listNodeExecutions(query as QueryOptions<NodeExecution>);
  }

  /**
   * POST /node-executions/list - List node executions with body filters
   * Core method: ✅ listNodeExecutions(options)
   */
  @Post('node-executions/list')
  async listNodeExecutionsPost(@Body() body: Record<string, unknown>) {
    return await this.flowlib.runs.listNodeExecutions(body as QueryOptions<NodeExecution>);
  }

  // =====================================
  // NODE DATA & TESTING ROUTES
  // =====================================

  /**
   * POST /node-data/test-expression - Test a JS expression in the QuickJS sandbox
   * Core method: ✅ testJsExpression({ expression, context })
   */
  @Post('node-data/test-expression')
  async testJsExpression(@Body() body: { expression: string; context: Record<string, unknown> }) {
    return await this.flowlib.testing.testJsExpression(body);
  }

  /**
   * POST /node-data/test-mapper - Test a mapper expression with mode semantics
   * Core method: ✅ testMapper({ expression, incomingData, mode? })
   */
  @Post('node-data/test-mapper')
  async testMapper(
    @Body()
    body: {
      expression: string;
      incomingData: Record<string, unknown>;
      mode?: 'auto' | 'iterate' | 'reshape';
    },
  ) {
    return await this.flowlib.testing.testMapper(body);
  }

  /**
   * POST /node-data/model-query - Test model prompt
   * Core method: ✅ testModelPrompt(request: SubmitPromptRequest)
   */
  @Post('node-data/model-query')
  async testModelPrompt(@Body() body: SubmitPromptRequest) {
    return await this.flowlib.testing.testModelPrompt(body);
  }

  /**
   * GET /node-data/models - Get available AI models
   * Core method: ✅ getAvailableModels()
   */
  @Get('node-data/models')
  async getAvailableModels(
    @Query('credentialId') credentialId?: string,
    @Query('provider') provider?: string,
  ) {
    if (credentialId) {
      return await this.flowlib.testing.getModelsForCredential(credentialId);
    }

    if (provider) {
      const normalized = provider.trim().toUpperCase();
      if (!Object.values(BatchProvider).includes(normalized as BatchProvider)) {
        throw new BadRequestException(
          `Unsupported provider '${provider}'. Expected one of: ${Object.values(BatchProvider).join(', ')}`,
        );
      }
      return await this.flowlib.testing.getModelsForProvider(normalized as BatchProvider);
    }

    return await this.flowlib.testing.getAvailableModels();
  }

  /**
   * POST /node-config/update - Generic node configuration updates
   * Core method: ✅ handleNodeConfigUpdate(event)
   */
  @Post('node-config/update')
  async handleNodeConfigUpdate(
    @Body() body: NodeConfigUpdateEvent,
  ): Promise<NodeConfigUpdateResponse> {
    try {
      return await this.flowlib.actions.handleConfigUpdate(body);
    } catch (error: unknown) {
      if (
        error &&
        typeof error === 'object' &&
        'statusCode' in error &&
        (error as { statusCode: number }).statusCode < 500
      ) {
        throw new BadRequestException(error instanceof Error ? error.message : 'Invalid request');
      }
      throw error;
    }
  }

  @Get('node-definition/:nodeType')
  async resolveNodeDefinition(
    @Param('nodeType') nodeTypeParam: string,
    @Query() query: Record<string, unknown>,
  ): Promise<NodeConfigUpdateResponse> {
    if (!nodeTypeParam.includes('.')) {
      throw new BadRequestException(`Unknown node type '${nodeTypeParam}'`);
    }

    const params = parseParamsFromQuery(query.params);
    const changeField = typeof query.changeField === 'string' ? query.changeField : undefined;
    const changeValue = coerceQueryValue(query.changeValue);
    const nodeId =
      typeof query.nodeId === 'string' ? query.nodeId : `definition-${nodeTypeParam.toLowerCase()}`;
    const flowId = typeof query.flowId === 'string' ? query.flowId : undefined;

    return await this.flowlib.actions.handleConfigUpdate({
      nodeType: nodeTypeParam,
      nodeId,
      flowId,
      params,
      change: changeField ? { field: changeField, value: changeValue } : undefined,
    });
  }

  /**
   * GET /nodes - Get available node definitions
   * Core method: ✅ getAvailableNodes()
   */
  @Get('nodes')
  @Header('Cache-Control', 'public, max-age=3600')
  getAvailableNodes() {
    return this.flowlib.actions.getAvailableNodes();
  }

  /**
   * GET /actions/:actionId/fields/:fieldName/options - Load dynamic field options
   * Core method: ✅ resolveFieldOptions(actionId, fieldName, deps)
   */
  @Get('actions/:actionId/fields/:fieldName/options')
  async resolveFieldOptions(
    @Param('actionId') actionId: string,
    @Param('fieldName') fieldName: string,
    @Query('deps') deps?: string,
  ): Promise<unknown> {
    let dependencyValues: Record<string, unknown> = {};
    if (deps) {
      try {
        dependencyValues = JSON.parse(deps);
      } catch {
        throw new BadRequestException('Invalid deps JSON');
      }
    }
    return await this.flowlib.actions.resolveFieldOptions(actionId, fieldName, dependencyValues);
  }

  /**
   * POST /nodes/test - Test/execute a single node in isolation
   * Core method: ✅ testNode(nodeType, params, inputData)
   */
  @Post('nodes/test')
  async testNode(
    @Body()
    body: {
      nodeType: string;
      params: Record<string, unknown>;
      inputData?: Record<string, unknown>;
    },
  ) {
    const { nodeType, params, inputData } = body;
    if (!nodeType || typeof nodeType !== 'string') {
      throw new BadRequestException('nodeType is required and must be a string');
    }
    if (!params || typeof params !== 'object') {
      throw new BadRequestException('params is required and must be an object');
    }
    return await this.flowlib.testing.testNode(nodeType, params, inputData || {});
  }

  // =====================================
  // CREDENTIAL ROUTES
  // =====================================

  /**
   * POST /credentials - Create a new credential
   */
  @Post('credentials')
  async createCredential(
    @Body()
    body: {
      name: string;
      type: string;
      authType: string;
      config: Record<string, unknown>;
      description?: string;
      workspaceId?: string;
      isShared?: boolean;
      metadata?: Record<string, unknown>;
      expiresAt?: string;
    },
  ): Promise<unknown> {
    return await this.flowlib.credentials.create(body as CreateCredentialInput);
  }

  /**
   * GET /credentials - List credentials
   */
  @Get('credentials')
  async listCredentials(
    @Query('type') type?: string,
    @Query('authType') authType?: string,
    @Query('isActive') isActive?: string,
  ): Promise<unknown> {
    const filters: Record<string, unknown> = {};
    if (type) {
      filters.type = type;
    }
    if (authType) {
      filters.authType = authType;
    }
    if (isActive !== undefined) {
      filters.isActive = isActive === 'true';
    }
    return await this.flowlib.credentials.list(filters as CredentialFilters);
  }

  /**
   * GET /credentials/:id - Get a credential (sanitized)
   */
  @Get('credentials/:id')
  async getCredential(@Param('id') id: string): Promise<unknown> {
    return await this.flowlib.credentials.getSanitized(id);
  }

  /**
   * PUT /credentials/:id - Update a credential
   */
  @Put('credentials/:id')
  async updateCredential(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    return await this.flowlib.credentials.update(id, body as UpdateCredentialInput);
  }

  /**
   * DELETE /credentials/:id - Delete a credential
   */
  @Delete('credentials/:id')
  @HttpCode(204)
  async deleteCredential(@Param('id') id: string) {
    await this.flowlib.credentials.delete(id);
  }

  /**
   * POST /credentials/:id/test - Test a credential
   */
  @Post('credentials/:id/test')
  async testCredential(@Param('id') id: string) {
    return await this.flowlib.credentials.test(id);
  }

  /**
   * POST /credentials/:id/track-usage - Update credential last used timestamp
   * Core method: ✅ updateCredentialLastUsed(id)
   */
  @Post('credentials/:id/track-usage')
  @HttpCode(204)
  async trackCredentialUsage(@Param('id') id: string) {
    await this.flowlib.credentials.updateLastUsed(id);
  }

  /**
   * GET /credentials/expiring - Get credentials expiring soon
   * Core method: ✅ getExpiringCredentials(daysUntilExpiry?)
   */
  @Get('credentials/expiring')
  async getExpiringCredentials(
    @Query('daysUntilExpiry') daysUntilExpiry?: string,
  ): Promise<unknown> {
    const days = daysUntilExpiry ? parseInt(daysUntilExpiry) : 7;
    return await this.flowlib.credentials.getExpiring(days);
  }

  /**
   * POST /credentials/test-request - Proxy HTTP request to test a credential
   */
  @Post('credentials/test-request')
  async testCredentialRequest(
    @Body()
    body: { url: string; method?: string; headers?: Record<string, string>; body?: unknown },
  ) {
    const { url, method = 'GET', headers = {}, body: reqBody } = body;
    if (!url) {
      throw new BadRequestException('URL is required');
    }

    // Validate URL to prevent SSRF
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      throw new BadRequestException('Invalid URL');
    }
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new BadRequestException('Only HTTP and HTTPS protocols are allowed');
    }

    // Resolve hostname to IP and check against private ranges to prevent
    // DNS rebinding, decimal/octal IP encoding, and IPv6 mapped addresses.
    const { promises: dns } = await import('node:dns');
    let resolvedIps: Array<{ address: string }>;
    try {
      resolvedIps = await dns.lookup(parsedUrl.hostname, { all: true });
    } catch {
      throw new BadRequestException('Could not resolve hostname');
    }

    const { isIP } = await import('node:net');
    for (const { address: ip } of resolvedIps) {
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
          throw new BadRequestException(
            'Requests to private/internal network addresses are not allowed',
          );
        }
      } else if (version === 6) {
        const lower = ip.toLowerCase();
        if (
          lower === '::1' ||
          lower.startsWith('fe80') ||
          lower.startsWith('fc') ||
          lower.startsWith('fd') ||
          lower.startsWith('::ffff:')
        ) {
          throw new BadRequestException(
            'Requests to private/internal network addresses are not allowed',
          );
        }
      }
    }

    const fetchOptions: RequestInit = {
      method,
      headers,
      redirect: 'error', // Prevent open redirects to internal IPs
    };
    if (reqBody && ['POST', 'PUT', 'PATCH'].includes(method)) {
      fetchOptions.body = typeof reqBody === 'string' ? reqBody : JSON.stringify(reqBody);
    }

    // codeql[js/request-forgery] SSRF mitigated: URL is validated (protocol allowlist), hostname is DNS-resolved and checked against private/internal IP ranges above, and redirects are disabled.
    const response = await fetch(url, fetchOptions);
    const responseText = await response.text();
    let responseBody: unknown;
    try {
      responseBody = JSON.parse(responseText);
    } catch {
      responseBody = responseText;
    }

    return {
      status: response.status,
      statusText: response.statusText,
      ok: response.ok,
      body: responseBody,
    };
  }

  // =====================================
  // OAUTH2 ROUTES
  // =====================================

  @Get('credentials/oauth2/providers')
  getOAuth2Providers() {
    return this.flowlib.credentials.getOAuth2Providers();
  }

  @Get('credentials/oauth2/providers/:providerId')
  getOAuth2Provider(@Param('providerId') providerId: string) {
    const provider = this.flowlib.credentials.getOAuth2Provider(providerId);
    if (!provider) {
      throw new NotFoundException('OAuth2 provider not found');
    }
    return provider;
  }

  @Post('credentials/oauth2/start')
  startOAuth2Flow(
    @Body()
    body: {
      providerId: string;
      clientId: string;
      clientSecret: string;
      redirectUri: string;
      scopes?: string[];
      returnUrl?: string;
      credentialName?: string;
    },
  ) {
    const { providerId, clientId, clientSecret, redirectUri, scopes, returnUrl, credentialName } =
      body;
    if (!providerId || !clientId || !clientSecret || !redirectUri) {
      throw new BadRequestException(
        'Missing required fields: providerId, clientId, clientSecret, redirectUri',
      );
    }
    return this.flowlib.credentials.startOAuth2Flow(
      providerId,
      { clientId, clientSecret, redirectUri },
      { scopes, returnUrl, credentialName },
    );
  }

  @Post('credentials/oauth2/callback')
  async handleOAuth2Callback(
    @Body()
    body: {
      code: string;
      state: string;
      clientId: string;
      clientSecret: string;
      redirectUri: string;
    },
  ): Promise<unknown> {
    const { code, state, clientId, clientSecret, redirectUri } = body;
    if (!code || !state || !clientId || !clientSecret || !redirectUri) {
      throw new BadRequestException(
        'Missing required fields: code, state, clientId, clientSecret, redirectUri',
      );
    }
    return await this.flowlib.credentials.handleOAuth2Callback(code, state, {
      clientId,
      clientSecret,
      redirectUri,
    });
  }

  @Post('credentials/:id/refresh')
  async refreshOAuth2Credential(@Param('id') id: string): Promise<unknown> {
    return await this.flowlib.credentials.refreshOAuth2Credential(id);
  }

  // =====================================
  // DASHBOARD ROUTES
  // =====================================

  @Get('dashboard/stats')
  async getDashboardStats() {
    return await this.flowlib.flows.getDashboardStats();
  }

  // =====================================
  // TRIGGER MANAGEMENT ROUTES
  // =====================================

  /**
   * GET /flows/:flowId/triggers - List triggers for a flow
   */
  @Get('flows/:flowId/triggers')
  async listTriggersForFlow(@Param('flowId') flowId: string) {
    return await this.flowlib.triggers.list(flowId);
  }

  /**
   * POST /flows/:flowId/triggers - Create a trigger
   */
  @Post('flows/:flowId/triggers')
  async createTrigger(@Param('flowId') flowId: string, @Body() body: Record<string, unknown>) {
    return await this.flowlib.triggers.create({ ...body, flowId } as CreateTriggerInput);
  }

  /**
   * POST /flows/:flowId/triggers/sync - Sync triggers from definition
   */
  @Post('flows/:flowId/triggers/sync')
  async syncTriggersForFlow(
    @Param('flowId') flowId: string,
    @Body()
    body: {
      definition: { nodes: Array<{ id: string; type: string; params?: Record<string, unknown> }> };
    },
  ) {
    return await this.flowlib.triggers.sync(flowId, body.definition);
  }

  /**
   * GET /triggers/:triggerId - Get a trigger
   */
  @Get('triggers/:triggerId')
  async getTrigger(@Param('triggerId') triggerId: string) {
    const trigger = await this.flowlib.triggers.get(triggerId);
    if (!trigger) {
      throw new NotFoundException(`Trigger ${triggerId} not found`);
    }
    return trigger;
  }

  /**
   * PUT /triggers/:triggerId - Update a trigger
   */
  @Put('triggers/:triggerId')
  async updateTrigger(
    @Param('triggerId') triggerId: string,
    @Body() body: Record<string, unknown>,
  ) {
    const trigger = await this.flowlib.triggers.update(triggerId, body as UpdateTriggerInput);
    if (!trigger) {
      throw new NotFoundException(`Trigger ${triggerId} not found`);
    }
    return trigger;
  }

  /**
   * DELETE /triggers/:triggerId - Delete a trigger
   */
  @Delete('triggers/:triggerId')
  @HttpCode(204)
  async deleteTrigger(@Param('triggerId') triggerId: string) {
    await this.flowlib.triggers.delete(triggerId);
  }

  // =====================================
  // AGENT TOOLS ROUTES
  // =====================================

  /**
   * GET /agent/tools - List all available agent tools
   */
  @Get('agent/tools')
  @Header('Cache-Control', 'public, max-age=3600')
  getAgentTools() {
    return this.flowlib.agent.getTools();
  }

  // =====================================
  // CHAT ASSISTANT ROUTES
  // =====================================

  @Get('chat/status')
  getChatStatus() {
    return { enabled: this.flowlib.chat.isEnabled() };
  }

  @Get('chat/models/:credentialId')
  async getChatModels(@Param('credentialId') credentialId: string, @Query('q') q?: string) {
    return this.flowlib.chat.listModels(credentialId, q);
  }

  @Post('chat')
  async streamChat(
    @Body() body: { messages: unknown[]; context?: Record<string, unknown> },
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const { messages, context } = body;
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({
        error: 'Validation Error',
        message: '"messages" must be an array of chat messages',
      });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    try {
      const stream = await this.flowlib.chat.createStream({
        messages: messages as ChatMessage[],
        context: context || {},
      });
      for await (const event of stream) {
        if (res.destroyed) {
          break;
        }
        const data = JSON.stringify(event);
        res.write(`event: ${(event as ChatStreamEvent).type}\ndata: ${data}\n\n`);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Chat stream failed';
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
  }

  /**
   * GET /chat/stream/:sessionId - Reattach to an in-flight chat session.
   * Replays buffered events then tails live events until completion.
   */
  @Get('chat/stream/:sessionId')
  async reattachChatStream(
    @Param('sessionId') sessionId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const abortController = new AbortController();
    req.on('close', () => abortController.abort());

    try {
      const stream = this.flowlib.chat.subscribeToSession(sessionId, abortController.signal);
      for await (const event of stream) {
        if (res.destroyed) {
          break;
        }
        res.write(`event: ${(event as ChatStreamEvent).type}\ndata: ${JSON.stringify(event)}\n\n`);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Chat reattach failed';
      res.write(
        `event: error\ndata: ${JSON.stringify({ type: 'error', message, recoverable: false })}\n\n`,
      );
    } finally {
      res.end();
    }
  }

  // =====================================
  // CHAT MESSAGE PERSISTENCE ROUTES
  // =====================================

  @Get('chat/messages/:flowId')
  async getChatMessages(
    @Param('flowId') flowId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ): Promise<unknown> {
    const p = page ? parseInt(page, 10) : undefined;
    const l = limit ? parseInt(limit, 10) : undefined;
    return await this.flowlib.chat.getMessages(flowId, {
      ...(p ? { page: p } : {}),
      ...(l ? { limit: l } : {}),
    });
  }

  @Put('chat/messages/:flowId')
  async saveChatMessages(
    @Param('flowId') flowId: string,
    @Body() body: { messages: unknown[] },
  ): Promise<unknown> {
    if (!body.messages || !Array.isArray(body.messages)) {
      throw new BadRequestException('"messages" must be an array');
    }
    return await this.flowlib.chat.saveMessages(
      flowId,
      body.messages as Array<{
        role: 'user' | 'assistant' | 'system' | 'tool';
        content: string;
        toolMeta?: Record<string, unknown> | null;
      }>,
    );
  }

  @Delete('chat/messages/:flowId')
  async deleteChatMessages(@Param('flowId') flowId: string) {
    await this.flowlib.chat.deleteMessages(flowId);
    return { success: true };
  }

  // =====================================
  // PLUGIN ENDPOINTS
  // Catch-all that delegates to plugin-defined routes
  // =====================================

  @All('plugins/*')
  async handlePluginEndpoint(@Req() req: Request, @Res() res: Response) {
    const endpoints = this.flowlib.plugins.getEndpoints();
    const pluginPath = (req.path as string).replace(/^.*\/plugins/, '') || '/';
    const method = req.method.toUpperCase();

    const matchedEndpoint = endpoints.find((ep) => {
      if (ep.method !== method) {
        return false;
      }
      const pattern = ep.path.replace(/:([^/]+)/g, '([^/]+)');
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
    const paramPattern = matchedEndpoint.path.replace(/:([^/]+)/g, (_m: string, name: string) => {
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
      const identity = req.invectIdentity ?? null;
      if (!this.flowlib.auth.hasPermission(identity, matchedEndpoint.permission)) {
        return res.status(403).json({
          error: 'Forbidden',
          message: `Missing permission: ${matchedEndpoint.permission}`,
        });
      }
    }

    const result = await matchedEndpoint.handler({
      body: req.body || {},
      params,
      query: (req.query || {}) as Record<string, string | undefined>,
      headers: req.headers as Record<string, string | undefined>,
      identity: req.invectIdentity ?? null,
      database: createPluginDatabaseApi(this.flowlib.plugins.getDatabaseConnection()),
      request: req as unknown as globalThis.Request,
      core: {
        getPermissions: (identity) => this.flowlib.auth.getPermissions(identity),
        getAvailableRoles: () => this.flowlib.auth.getAvailableRoles(),
        getResolvedRole: (identity) => this.flowlib.auth.getResolvedRole(identity),
        authorize: (context) => this.flowlib.auth.authorize(context),
      },
      getInvect: () => this.flowlib,
    });

    // Handle raw Response objects
    if (result instanceof Response) {
      const arrayBuf = await result.arrayBuffer();
      res.status(result.status);
      result.headers.forEach((value: string, key: string) => res.setHeader(key, value));
      res.send(Buffer.from(arrayBuf));
      return;
    }

    // Handle streaming responses
    if ('stream' in result && result.stream) {
      res.status(result.status || 200);
      res.setHeader('Content-Type', 'text/event-stream');
      const streamResult = result as { status?: number; stream: ReadableStream };
      const reader = streamResult.stream.getReader();
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
    return res.status(jsonResult.status || 200).json(jsonResult.body);
  }
}
