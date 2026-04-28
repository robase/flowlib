// Core services and factories
import { ServiceFactory } from './services/service-factory';
import { FlowValidator } from './services/flow-validator';
import { SubmitAgentPromptRequest, NodeExecutionContext } from './types.internal';

// Database models
import type { Flow } from './services/flows/flows.model';
import type { FlowRun } from './services/flow-runs/flow-runs.model';
import type { NodeExecution } from './services/node-executions/node-executions.model';
import { FlowVersion } from './database';
import type { DatabaseConnection } from './database/connection';

// Service interfaces and types
import type {
  ExecuteFlowOptions,
  FlowRunResult,
  FlowInputs,
} from './services/flow-runs/flow-runs.service';
import type { SubmitPromptRequest } from './services/node-data.service';
import type {
  Credential,
  CreateCredentialInput,
  UpdateCredentialInput,
  CredentialFilters,
} from './services/credentials';
import type { CredentialAuthType } from './database/schema-sqlite';

import type {
  FlowTriggerRegistration,
  CreateTriggerInput,
  UpdateTriggerInput,
} from './services/triggers';

// Schemas and validation
import * as Schemas from './schemas';
import { FlowlibConfig, FlowlibConfigSchema, PaginatedResponse, QueryOptions } from './schemas';
import {
  CreateFlowVersionRequest,
  createFlowVersionRequestSchema,
  FlowlibDefinition,
  flowlibDefinitionSchema,
} from './services/flow-versions/schemas-fresh';
import { FlowValidationResult } from './types/validation';
import type { CreateFlowInput, UpdateFlowInput } from './services/flows/flows.model';

// Utilities and errors
import {
  LoggerManager,
  ScopedLogger,
  type LogLevel,
  type ScopedLoggingConfig,
} from './utils/logger';
import { DatabaseError, ValidationError } from './types/common/errors.types';
import { FlowRunStatus, NodeExecutionStatus } from './types/base';
import type { ExecutionStreamEvent } from './services/execution-event-bus';

// Template + JS expression engine
import { getTemplateService } from './services/templating/template.service';
import type { TemplateService } from './services/templating/template.service';
import {
  JsExpressionService,
  type JsExpressionService as JsExpressionServiceType,
} from './services/templating/js-expression.service';

// React Flow renderer types
import type { ReactFlowData } from './services/react-flow-renderer.service';
import { NodeDefinition } from './types/node-definition.types';
import { BatchProvider, Model } from './services/ai/base-client';
import { detectProviderFromCredential } from './utils/provider-detection';
import type {
  NodeConfigUpdateEvent,
  NodeConfigUpdateResponse,
} from './types/node-config-update.types';

// Plugin system
import { PluginManager } from './services/plugin-manager';
import type {
  FlowlibPlugin,
  FlowlibPluginDefinition,
  FlowlibPluginEndpoint,
  PluginHookRunner,
} from './types/plugin.types';
import type { AgentToolDefinition, AgentPromptResult } from './types/agent-tool.types';

// Action registry (Provider-Actions architecture)
import { ActionRegistry, initializeGlobalActionRegistry } from '@flowlib/actions/registry';
import { allProviderActions } from '@flowlib/actions';
import type { ActionDefinition, ProviderDef, LoadOptionsResult } from '@flowlib/action-kit';

// Authorization
import { AuthorizationService, createAuthorizationService } from './services/auth';
import type {
  FlowlibIdentity,
  FlowlibPermission,
  AuthorizationContext,
  AuthorizationResult,
  AuthEvent,
} from './types/auth.types';

// Shared plugin database API factory
import { createPluginDatabaseApi } from './services/plugin-database-api';

/**
 * Custom node configuration interface
 */
export interface CustomNodeConfig {
  nodeType: string;
  executor: string; // path to executor class or instance
  config?: Record<string, unknown>;
}

/**
 * Flowlib Core initialization status
 */
export interface CoreInitializationStatus {
  isInitialized: boolean;
  servicesReady: boolean;
  databaseReady: boolean;
  errors?: string[];
}

/**
 * Dashboard statistics returned by getDashboardStats()
 */
export interface DashboardStats {
  /** Total number of flows */
  totalFlows: number;
  /** Total number of flow runs (all time) */
  totalRuns: number;
  /** Number of runs in the last 24 hours */
  runsLast24h: number;
  /** Currently active runs (RUNNING + PENDING + PAUSED_FOR_BATCH) */
  activeRuns: number;
  /** Success rate as percentage (0-100) */
  successRate: number;
  /** Number of failed runs in the last 24 hours */
  failedRunsLast24h: number;
  /** Run counts keyed by FlowRunStatus */
  runsByStatus: Record<string, number>;
  /** Most recent 10 flow runs */
  recentRuns: FlowRun[];
}

/** Flowlib Core provider stub shared by all built-in legacy nodes. */
const _FLOWLIB_CORE_PROVIDER: NonNullable<NodeDefinition['provider']> = {
  id: 'core',
  name: 'Flowlib Core',
  icon: 'Blocks',
};

/**
 * Main Flowlib Core class
 *
 * Provides a high-level API for flow operations with comprehensive lifecycle management.
 * This class orchestrates all flow-related operations including:
 * - Flow and flow version management
 * - Flow execution and monitoring
 * - Node execution tracking
 * - AI batch operations
 * - Testing and development utilities
 *
 * @example
 * ```typescript
 * const flowlib = new Flowlib(config);
 * await flowlib.initialize();
 *
 * const flow = await flowlib.createFlow({ name: "My Flow", description: "..." });
 * const result = await flowlib.startFlowRun(flow.id, inputs);
 *
 * await flowlib.shutdown();
 * ```
 */
export class Flowlib {
  protected serviceFactory: ServiceFactory | null = null;
  protected actionRegistry: ActionRegistry | null = null;
  private jsExpressionService: JsExpressionServiceType | null = null;
  private templateService: TemplateService | null = null;
  private pluginManager: PluginManager;
  private initialized = false;
  private loggerManager: LoggerManager;
  private authService: AuthorizationService;

  /**
   * Creates a new Flowlib instance
   *
   * @param config - Flowlib configuration object
   */
  constructor(private readonly config: FlowlibConfig) {
    // Parse and validate the config to ensure defaults are applied.
    // Cast back to `FlowlibConfig` because the `services` block is typed as
    // `unknown` in the Zod schema (adapter instances aren't validatable).
    this.config = FlowlibConfigSchema.parse(config) as FlowlibConfig;

    // Initialize logger manager with scoped logging support
    const loggingConfig: ScopedLoggingConfig = {
      level: this.config.logging?.level || 'info',
      scopes: this.config.logging?.scopes,
    };
    this.loggerManager = new LoggerManager(loggingConfig);

    // ALWAYS use the LoggerManager's basic logger for services
    // This ensures log level filtering is respected.
    // If you passed `logger: console`, it would bypass log level filtering
    // because console.debug() always outputs regardless of configured level.
    this.config.logger = this.loggerManager.getBasicLogger();

    // Initialize authorization service with defaults (plugins configure via hooks)
    this.authService = createAuthorizationService({
      logger: this.config.logger,
    });

    // Initialize plugin manager — extract backend plugins from unified definitions
    const rawPlugins = (this.config.plugins as FlowlibPluginDefinition[] | undefined) ?? [];
    const backendPlugins = rawPlugins
      .map((p) => p.backend)
      .filter((p): p is FlowlibPlugin => p !== null && p !== undefined);
    this.pluginManager = new PluginManager(backendPlugins);
  }

  // =====================================
  // AUTHORIZATION API
  // =====================================

  /**
   * Authorize an action for an identity.
   *
   * This is the main entry point for authorization checks. Framework adapters
   * (Express, NestJS, Next.js) should call this method to check permissions.
   *
   * @param context - Authorization context with identity, action, and optional resource
   * @returns Authorization result with allowed flag and optional reason
   *
   * @example
   * ```typescript
   * const result = await flowlib.authorize({
   *   identity: { id: 'user_123', role: 'editor' },
   *   action: 'flow:create',
   * });
   *
   * if (!result.allowed) {
   *   throw new ForbiddenError(result.reason);
   * }
   * ```
   */
  async authorize(context: AuthorizationContext): Promise<AuthorizationResult> {
    const hookResult = await this.pluginManager.runOnAuthorize({
      ...context,
      database: this.serviceFactory
        ? createPluginDatabaseApi(this.serviceFactory.getDatabaseService().getConnection())
        : undefined,
    });
    if (hookResult) {
      return hookResult;
    }
    return this.authService.authorize(context);
  }

  /**
   * Check if a specific identity has a permission.
   * Convenience method that wraps authorize().
   */
  hasPermission(identity: FlowlibIdentity | null, permission: FlowlibPermission): boolean {
    return this.authService.hasPermission(identity, permission);
  }

  /**
   * Get all permissions for an identity.
   */
  getPermissions(identity: FlowlibIdentity | null): FlowlibPermission[] {
    return this.authService.getPermissions(identity);
  }

  // =====================================
  // PLUGIN API
  // =====================================

  /**
   * Check if a plugin is registered by ID.
   */
  hasPlugin(pluginId: string): boolean {
    return this.pluginManager.hasPlugin(pluginId);
  }

  /**
   * Get a registered plugin by ID.
   */
  getPlugin(pluginId: string): FlowlibPlugin | null {
    return this.pluginManager.getPlugin(pluginId);
  }

  /**
   * Get all registered plugins.
   */
  getPlugins(): readonly FlowlibPlugin[] {
    return this.pluginManager.getPlugins();
  }

  /**
   * Get all plugin-defined API endpoints.
   * Framework adapters use this to mount plugin routes.
   */
  getPluginEndpoints(): FlowlibPluginEndpoint[] {
    return this.pluginManager.getPluginEndpoints();
  }

  /**
   * Get the plugin hook runner for framework adapters.
   * Used to run onRequest/onResponse/onAuthorize hooks.
   */
  getPluginHookRunner(): PluginHookRunner {
    return this.pluginManager;
  }

  /**
   * Get the initialized host database connection.
   * Framework adapters use this to expose a narrow database API to plugins.
   */
  getDatabaseConnection(): DatabaseConnection {
    if (!this.serviceFactory) {
      throw new Error('ServiceFactory not initialized');
    }
    return this.serviceFactory.getDatabaseService().getConnection();
  }

  /**
   * Check if authentication is enabled.
   */
  isAuthEnabled(): boolean {
    return this.authService.isEnabled();
  }

  /**
   * Check if a route is public (no auth required).
   */
  isPublicRoute(path: string): boolean {
    return this.authService.isPublicRoute(path);
  }

  /**
   * Get the authorization service for advanced use cases.
   * The service extends EventEmitter and emits auth events.
   */
  getAuthService(): AuthorizationService {
    return this.authService;
  }

  /**
   * Get available roles and their permissions.
   * Useful for admin UIs to show role options.
   */
  getAvailableRoles() {
    return this.authService.getAvailableRoles();
  }

  /**
   * Subscribe to auth events for audit logging.
   *
   * @example
   * ```typescript
   * flowlib.onAuthEvent('auth:forbidden', (event) => {
   *   auditLogger.warn('Access denied', event);
   * });
   * ```
   */
  onAuthEvent<T extends AuthEvent['type']>(
    event: T,
    listener: (event: Extract<AuthEvent, { type: T }>) => void,
  ): void {
    this.authService.on(event, listener);
  }

  // =====================================
  // LOGGING MANAGEMENT
  // =====================================

  /**
   * Get a scoped logger for a specific feature area.
   *
   * Scoped loggers have independent log levels that can be configured
   * per scope via the logging.scopes configuration.
   *
   * @param scope - The scope/feature area (use LogScope constants)
   * @param context - Optional additional context (e.g., class name)
   * @returns A ScopedLogger instance
   *
   * @example
   * ```typescript
   * const logger = flowlib.getLogger('execution', 'MyService');
   * logger.debug('Starting execution'); // Only logs if execution scope is 'debug'
   * ```
   */
  getLogger(scope: string, context?: string): ScopedLogger {
    return this.loggerManager.getLogger(scope, context);
  }

  /**
   * Get the logger manager for advanced logging configuration
   */
  getLoggerManager(): LoggerManager {
    return this.loggerManager;
  }

  /**
   * Update the log level for a specific scope at runtime
   *
   * @example
   * ```typescript
   * // Enable debug logging for execution during troubleshooting
   * flowlib.setLogLevel('execution', 'debug');
   * ```
   */
  setLogLevel(scope: string, level: LogLevel): void {
    this.loggerManager.setLogLevel(scope, level);
  }

  // =====================================
  // INITIALIZATION & LIFECYCLE MANAGEMENT
  // =====================================

  /**
   * Initialize Flowlib Core
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      this.config.logger.debug('Flowlib Core already initialized');
      return;
    }

    // Explicit opt-in skip — host (e.g. framework adapter) is responsible for
    // setting `config.skipDatabaseInit`. Core does not sniff the environment.
    if (this.config.skipDatabaseInit) {
      this.config.logger.info('Skipping Flowlib Core initialization (skipDatabaseInit=true)');
      throw new DatabaseError('Flowlib Core initialization skipped (skipDatabaseInit=true)', {
        reason: 'build_time_skip',
      });
    }

    this.config.logger.info('Initializing Flowlib Core...');

    try {
      // Initialize action registry (Provider-Actions architecture)
      this.actionRegistry = initializeGlobalActionRegistry(this.config.logger);

      // Register all built-in actions (core, http, gmail, etc.)
      this.actionRegistry.registerMany(allProviderActions);
      this.config.logger.info(
        `Registered ${this.actionRegistry.size} built-in actions from ${this.actionRegistry.getProviders().length} providers`,
      );

      // Initialize plugins (register plugin actions, call init hooks)
      const actionRegistry = this.actionRegistry;
      await this.pluginManager.initializePlugins({
        config: this.config as unknown as Record<string, unknown>,
        logger: this.config.logger,
        registerAction: (action) => {
          actionRegistry.register(action);
        },
        getFlowlib: () => {
          throw new Error(
            'FlowlibInstance is not available via the legacy Flowlib class. ' +
              'Use createFlowlib() instead to get full FlowlibInstance access in plugins.',
          );
        },
      });

      if (this.pluginManager.getPlugins().length > 0) {
        this.config.logger.info(
          `Initialized ${this.pluginManager.getPlugins().length} plugin(s): ${this.pluginManager
            .getPlugins()
            .map((p) => p.id)
            .join(', ')}`,
        );
      }

      // Initialize JS expression engine (sandboxed QuickJS runtime for data mapper)
      try {
        this.jsExpressionService = new JsExpressionService({}, this.config.logger);
        await this.jsExpressionService.initialize();
        this.templateService = getTemplateService(this.jsExpressionService, this.config.logger);
        this.config.logger.debug('JS expression engine + template service initialized');
      } catch (error) {
        this.jsExpressionService = null;
        this.templateService = null;
        this.config.logger.warn(
          'JS expression engine unavailable; continuing without data mapper and template expression support',
          { error: error instanceof Error ? (error.stack ?? error.message) : String(error) },
        );
      }

      // Initialize service factory
      await this.initializeServices();

      this.initialized = true;

      // Ensure default credentials exist after initialization (non-blocking)
      if (this.config.defaultCredentials?.length) {
        this.ensureDefaultCredentials().catch((err) => {
          this.config.logger.error('Default credential seeding failed', err);
        });
      }
    } catch (error) {
      // Don't double-wrap DatabaseError — it already has a clear message
      if (error instanceof DatabaseError) {
        throw error;
      }
      this.config.logger.error('Failed to initialize Flowlib Core', error);
      throw new DatabaseError('Flowlib Core initialization failed', { error });
    }
  }

  /**
   * Gracefully shutdown Flowlib Core.
   * Marks any in-progress flow runs as FAILED before closing services.
   */
  async shutdown(): Promise<void> {
    this.config.logger.info('Shutting down Flowlib Core...');

    try {
      // Mark in-progress flows as failed before tearing down services
      if (this.serviceFactory?.isInitialized()) {
        try {
          const flowRunsService = this.serviceFactory.getFlowRunsService();
          const failedCount = await flowRunsService.failStaleRuns(0); // threshold 0 = fail ALL active runs
          if (failedCount > 0) {
            this.config.logger.warn(
              `Graceful shutdown: marked ${failedCount} in-progress flow run(s) as FAILED`,
            );
          }
        } catch (error) {
          this.config.logger.error('Failed to mark in-progress runs during shutdown', error);
        }
      }

      // Shutdown plugins (reverse order)
      await this.pluginManager.shutdownPlugins(this.config.logger);

      if (this.serviceFactory) {
        await this.serviceFactory.close();
        this.serviceFactory = null;
      }

      this.actionRegistry = null;

      // Dispose JS expression engine + template service
      if (this.jsExpressionService) {
        this.jsExpressionService.dispose();
        this.jsExpressionService = null;
      }
      this.templateService = null;

      this.initialized = false;

      this.config.logger.info('Flowlib Core shutdown completed');
    } catch (error) {
      this.config.logger.error('Error during Flowlib Core shutdown', error);
      throw new DatabaseError('Flowlib Core shutdown failed', { error });
    }
  }

  /**
   * Check if core is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Run health check on all services
   */
  async healthCheck(): Promise<{ [serviceName: string]: boolean }> {
    this.ensureInitialized();
    const healthStatus = await this.serviceFactory.healthCheck();
    return healthStatus.services;
  }

  // =====================================
  // FLOW MANAGEMENT
  // =====================================

  /**
   * Create a new flow
   */
  async createFlow(flowData: CreateFlowInput): Promise<Flow> {
    this.config.logger.debug(
      'createFlow called with arguments:',
      JSON.stringify(flowData, null, 2),
    );
    const data = Schemas.flow.createFlowRequestSchema.parse(flowData);
    return this.flowService.createFlow(data);
  }

  /**
   * Get all flows with optional filtering, sorting, and pagination
   */
  async listFlows(options?: QueryOptions<Flow>): Promise<PaginatedResponse<Flow>> {
    this.config.logger.debug('listFlows called with arguments:', JSON.stringify(options, null, 2));

    // Validate options using Zod schema
    if (options) {
      Schemas.QueryOptionsSchema.parse(options);
    }

    // Call the flows service and return its paginated response
    return await this.flowService.listFlows(options);
  }

  /**
   * Get flow by ID
   */
  async getFlow(flowId: string): Promise<Flow> {
    this.config.logger.debug('getFlow called with arguments:', JSON.stringify({ flowId }, null, 2));
    const validatedParams = Schemas.flow.FlowIdParamsSchema.parse({ flowId });
    return this.flowService.getFlowById(validatedParams.flowId);
  }

  /**
   * Update an existing flow
   */
  async updateFlow(flowId: string, updateData: UpdateFlowInput): Promise<Flow> {
    this.config.logger.debug(
      'updateFlow called with arguments:',
      JSON.stringify({ flowId, updateData }, null, 2),
    );
    const validatedParams = Schemas.flow.FlowIdParamsSchema.parse({ flowId });
    return this.flowService.updateFlow(validatedParams.flowId, updateData);
  }

  /**
   * Delete a flow
   */
  async deleteFlow(flowId: string): Promise<void> {
    this.config.logger.debug(
      'deleteFlow called with arguments:',
      JSON.stringify({ flowId }, null, 2),
    );
    const validatedParams = Schemas.flow.FlowIdParamsSchema.parse({ flowId });
    return this.flowService.deleteFlow(validatedParams.flowId);
  }

  /**
   * Validate flow definition
   */
  async validateFlowDefinition(
    flowId: string,
    flowDefinition: unknown,
  ): Promise<FlowValidationResult> {
    this.config.logger.debug(
      'validateFlowDefinition called with arguments:',
      JSON.stringify({ flowId, flowDefinition }, null, 2),
    );
    this.ensureInitialized();

    // Validate parameters using Zod schemas
    const validatedParams = Schemas.flow.FlowIdParamsSchema.parse({ flowId });

    // First validate the raw data with the Zod schema
    const validatedBody = flowlibDefinitionSchema.parse(flowDefinition);

    // Now cast to the inferred type for use with FlowValidator
    const typedDefinition = validatedBody as FlowlibDefinition;

    this.config.logger.debug('Validating flow definition', {
      flowId: validatedParams.flowId,
    });

    try {
      // Use the properly typed definition for validation
      const validationResult = FlowValidator.validateFlowDefinition(typedDefinition);

      this.config.logger.debug('Flow validation completed', validationResult);

      return validationResult;
    } catch (error) {
      this.config.logger.error('Flow validation failed', {
        flowId: validatedParams.flowId,
        error,
      });
      throw error;
    }
  }

  // =====================================
  // FLOW VERSION MANAGEMENT
  // =====================================

  /**
   * Create flow version and sync trigger registrations (D3: sync on publish)
   */
  async createFlowVersion(
    flowId: string,
    versionData: CreateFlowVersionRequest,
  ): Promise<FlowVersion> {
    this.config.logger.debug(
      'createFlowVersion called with arguments:',
      JSON.stringify({ flowId, versionData }, null, 2),
    );
    const validatedParams = Schemas.flow.FlowIdParamsSchema.parse({ flowId });
    const data = createFlowVersionRequestSchema.parse(versionData);
    const version = await this.flowVersionsService.createFlowVersion(validatedParams.flowId, data);

    // D3: Sync trigger registrations from the new version's definition.
    // This upserts webhook paths/secrets and cron expressions as needed.
    try {
      if (data.flowlibDefinition?.nodes) {
        await this.triggersService.syncTriggersForFlow(
          validatedParams.flowId,
          data.flowlibDefinition as {
            nodes: Array<{ id: string; type: string; params?: Record<string, unknown> }>;
          },
        );
        this.config.logger.debug('Trigger registrations synced after version creation', {
          flowId: validatedParams.flowId,
          versionNumber: version.version,
        });
      }
    } catch (error) {
      // Don't fail the version creation if trigger sync fails
      this.config.logger.error('Failed to sync triggers after version creation', {
        flowId: validatedParams.flowId,
        error,
      });
    }

    return version;
  }

  /**
   * Get flow versions with optional filtering, sorting, and pagination
   */
  async listFlowVersions(
    flowId: string,
    options?: QueryOptions<FlowVersion>,
  ): Promise<PaginatedResponse<FlowVersion>> {
    this.config.logger.debug(
      'listFlowVersions called with arguments:',
      JSON.stringify({ flowId, options }, null, 2),
    );
    const validatedParams = Schemas.flow.FlowIdParamsSchema.parse({ flowId });
    return await this.flowVersionsService.listFlowVersionsByFlowId(validatedParams.flowId, options);
  }

  /**
   * Get specific flow version by version number or 'latest'
   */
  async getFlowVersion(
    flowId: string,
    version: string | number | 'latest',
  ): Promise<FlowVersion | null> {
    this.config.logger.debug(
      'getFlowVersion called with arguments:',
      JSON.stringify({ flowId, version }, null, 2),
    );
    const validatedParams = Schemas.flow.FlowIdParamsSchema.parse({ flowId });
    return await this.flowVersionsService.getFlowVersion(validatedParams.flowId, version);
  }

  // =====================================
  // FLOW RUN MANAGEMENT
  // =====================================

  /**
   * Execute a flow (synchronous - waits for completion)
   */
  async startFlowRun(
    flowId: string,
    inputs: FlowInputs = {},
    options?: ExecuteFlowOptions,
  ): Promise<FlowRunResult> {
    this.config.logger.debug(
      'startFlowRun called with arguments:',
      JSON.stringify({ flowId, inputs, options }, null, 2),
    );
    // TODO: validate inputs
    return this.orchestrationService.executeFlow(flowId, inputs, options);
  }

  /**
   * Start a flow execution asynchronously - returns immediately with flow run ID.
   * The flow executes in the background. Use this for UI-initiated runs where
   * you want to redirect the user immediately without waiting for completion.
   */
  async startFlowRunAsync(
    flowId: string,
    inputs: FlowInputs = {},
    options?: ExecuteFlowOptions,
  ): Promise<FlowRunResult> {
    this.config.logger.debug(
      'startFlowRunAsync called with arguments:',
      JSON.stringify({ flowId, inputs, options }, null, 2),
    );
    return this.orchestrationService.executeFlowAsync(flowId, inputs, options);
  }

  /**
   * Execute a flow up to a specific target node.
   * Only executes the upstream nodes required to produce output for the target node.
   * This is useful for testing a specific node with its real upstream dependencies.
   *
   * @param flowId - The flow to execute
   * @param targetNodeId - The node to execute up to (this node will also be executed)
   * @param inputs - Flow-level inputs
   * @param options - Execution options (version, batch processing, etc.)
   * @returns The flow run result with the target node's output
   */
  async executeFlowToNode(
    flowId: string,
    targetNodeId: string,
    inputs: FlowInputs = {},
    options?: ExecuteFlowOptions,
  ): Promise<FlowRunResult> {
    this.config.logger.debug(
      'executeFlowToNode called with arguments:',
      JSON.stringify({ flowId, targetNodeId, inputs, options }, null, 2),
    );
    return this.orchestrationService.executeFlowToNode(flowId, targetNodeId, inputs, options);
  }

  /**
   * Resume execution
   */
  async resumeExecution(executionId: string): Promise<{ message: string; timestamp: string }> {
    this.config.logger.debug(
      'resumeExecution called with arguments:',
      JSON.stringify({ executionId }, null, 2),
    );
    return this.flowRunsService.resumeRun(executionId);
  }

  /**
   * Get all Flow Runs
   */
  async listFlowRuns(options?: QueryOptions<FlowRun>): Promise<PaginatedResponse<FlowRun>> {
    this.config.logger.debug(
      'listFlowRuns called with arguments:',
      JSON.stringify(options, null, 2),
    );

    return await this.flowRunsService.listRuns(options);
  }

  /**
   * Get flow executions for a specific flow
   */
  async listFlowRunsByFlowId(flowId: string): Promise<PaginatedResponse<FlowRun>> {
    this.config.logger.debug(
      'listFlowRunsByFlowId called with arguments:',
      JSON.stringify({ flowId }, null, 2),
    );
    const validatedParams = Schemas.flow.FlowIdParamsSchema.parse({ flowId });
    return this.flowRunsService.listRuns({ filter: { flowId: [validatedParams.flowId] } });
  }

  /**
   * Get a specific flow run by ID
   */
  async getFlowRunById(flowRunId: string): Promise<FlowRun> {
    this.config.logger.debug(
      'getFlowRunById called with arguments:',
      JSON.stringify({ flowRunId }, null, 2),
    );
    return this.flowRunsService.getRunById(flowRunId);
  }

  /**
   * Cancel a flow run
   */
  async cancelFlowRun(flowRunId: string): Promise<{ message: string; timestamp: string }> {
    this.config.logger.debug(
      'cancelFlowRun called with arguments:',
      JSON.stringify({ flowRunId }, null, 2),
    );
    return this.flowRunsService.cancelRun(flowRunId);
  }

  /**
   * Pause a flow run
   */
  async pauseFlowRun(
    flowRunId: string,
    reason?: string,
  ): Promise<{ message: string; timestamp: string }> {
    this.config.logger.debug(
      'pauseFlowRun called with arguments:',
      JSON.stringify({ flowRunId, reason }, null, 2),
    );
    return this.flowRunsService.pauseRun(flowRunId, reason);
  }

  /**
   * Get dashboard statistics: flow counts, run counts by status, recent activity.
   */
  async getDashboardStats(): Promise<DashboardStats> {
    this.config.logger.debug('getDashboardStats called');

    const [flowsResponse, runStats, recentRunsResponse] = await Promise.all([
      this.flowService.listFlows({ pagination: { page: 1, limit: 1 } }),
      this.flowRunsService.getStats(),
      this.flowRunsService.listRuns({
        pagination: { page: 1, limit: 10 },
        sort: { sortBy: 'startedAt', sortOrder: 'desc' },
      }),
    ]);

    const totalRunsAll = Object.values(runStats.totalRuns).reduce((sum, c) => sum + c, 0);
    const totalSuccess = runStats.totalRuns[FlowRunStatus.SUCCESS] ?? 0;
    const successRate = totalRunsAll > 0 ? Math.round((totalSuccess / totalRunsAll) * 100) : 0;

    const activeCount =
      (runStats.totalRuns[FlowRunStatus.RUNNING] ?? 0) +
      (runStats.totalRuns[FlowRunStatus.PENDING] ?? 0) +
      (runStats.totalRuns[FlowRunStatus.PAUSED_FOR_BATCH] ?? 0);

    const recentRunsAll = Object.values(runStats.recentRuns).reduce((sum, c) => sum + c, 0);

    return {
      totalFlows: flowsResponse.pagination.totalPages, // limit=1 so totalPages === totalCount
      totalRuns: totalRunsAll,
      runsLast24h: recentRunsAll,
      activeRuns: activeCount,
      successRate,
      failedRunsLast24h: runStats.recentRuns[FlowRunStatus.FAILED] ?? 0,
      runsByStatus: runStats.totalRuns,
      recentRuns: recentRunsResponse.data,
    };
  }

  // =====================================
  // CREDENTIAL MANAGEMENT
  // =====================================

  /**
   * Create a credential
   */
  async createCredential(input: CreateCredentialInput): Promise<Credential> {
    this.config.logger.debug('createCredential called');
    return this.credentialsService.create(input);
  }

  /**
   * List credentials with optional filters
   */
  async listCredentials(filters?: CredentialFilters): Promise<Array<Omit<Credential, 'config'>>> {
    this.config.logger.debug('listCredentials called', { filters });
    return this.credentialsService.list(filters);
  }

  /**
   * Retrieve a credential by id
   */
  async getCredential(id: string): Promise<Credential> {
    this.config.logger.debug('getCredential called', { id });
    return this.credentialsService.get(id);
  }

  /**
   * Update credential
   */
  async updateCredential(id: string, input: UpdateCredentialInput): Promise<Credential> {
    this.config.logger.debug('updateCredential called', { id });
    return this.credentialsService.update(id, input);
  }

  /**
   * Delete credential
   */
  async deleteCredential(id: string): Promise<void> {
    this.config.logger.debug('deleteCredential called', { id });
    return this.credentialsService.delete(id);
  }

  /**
   * Test credential validity
   */
  async testCredential(id: string): Promise<{ success: boolean; error?: string }> {
    this.config.logger.debug('testCredential called', { id });
    return this.credentialsService.test(id);
  }

  /**
   * Update credential last used timestamp
   */
  async updateCredentialLastUsed(id: string): Promise<void> {
    this.config.logger.debug('updateCredentialLastUsed called', { id });
    return this.credentialsService.updateLastUsed(id);
  }

  /**
   * Get expiring credentials helper
   */
  async getExpiringCredentials(daysUntilExpiry?: number): Promise<Credential[]> {
    this.config.logger.debug('getExpiringCredentials called', { daysUntilExpiry });
    return this.credentialsService.getExpiringCredentials(daysUntilExpiry);
  }

  // =====================================
  // NODE EXECUTION MANAGEMENT
  // =====================================

  /**
   * Get node executions by flow run ID
   */
  async getNodeExecutionsByRunId(flowRunId: string): Promise<NodeExecution[]> {
    this.config.logger.debug(
      'getNodeExecutionsByRunId called with arguments:',
      JSON.stringify({ flowRunId }, null, 2),
    );
    return this.nodeExecutionsService.listNodeExecutionsByFlowRunId(flowRunId);
  }

  /**
   * Get all node executions with optional filtering, sorting, and pagination
   */
  async listNodeExecutions(
    options?: QueryOptions<NodeExecution>,
  ): Promise<PaginatedResponse<NodeExecution>> {
    this.config.logger.debug(
      'listNodeExecutions called with arguments:',
      JSON.stringify(options, null, 2),
    );
    return await this.nodeExecutionsService.listNodeExecutions(options);
  }

  // =====================================
  // EXECUTION STREAMING (SSE)
  // =====================================

  /**
   * Create an async iterable that yields execution events for a flow run.
   *
   * The first event is always a "snapshot" with the current FlowRun and all
   * NodeExecutions.  Subsequent events are incremental updates.  The stream
   * ends automatically when the flow run reaches a terminal status.
   *
   * Consumers (Express/NestJS/Next.js adapters) iterate this with
   * `for await (const event of stream)` and write SSE frames.
   */
  async *createFlowRunEventStream(
    flowRunId: string,
  ): AsyncGenerator<ExecutionStreamEvent, void, undefined> {
    const bus = this.serviceFactory?.getExecutionEventBus();
    if (!bus) {
      throw new Error('ServiceFactory not initialized');
    }

    // 1. Send initial snapshot
    const flowRun = await this.flowRunsService.getRunById(flowRunId);
    const nodeExecutions =
      await this.nodeExecutionsService.listNodeExecutionsByFlowRunId(flowRunId);

    yield { type: 'snapshot', flowRun, nodeExecutions };

    // If the run is already terminal, close immediately
    const terminalStatuses = new Set([
      FlowRunStatus.SUCCESS,
      FlowRunStatus.FAILED,
      FlowRunStatus.CANCELLED,
    ]);
    if (terminalStatuses.has(flowRun.status)) {
      yield { type: 'end', flowRun };
      return;
    }

    // 2. Forward live events via a queue
    const queue: ExecutionStreamEvent[] = [];
    let resolve: (() => void) | null = null;
    let done = false;

    const unsubscribe = bus.subscribe(flowRunId, (event) => {
      queue.push(event);

      // Check for terminal flow-run status
      if (event.type === 'flow_run.updated' && terminalStatuses.has(event.flowRun.status)) {
        queue.push({ type: 'end', flowRun: event.flowRun });
        done = true;
      }

      // Wake up the consumer if it's waiting
      const wakeUp = resolve;
      if (wakeUp) {
        resolve = null;
        wakeUp();
      }
    });

    // 3. Heartbeat interval to keep the connection alive
    const heartbeatTimer = setInterval(() => {
      queue.push({ type: 'heartbeat' });
      if (resolve) {
        resolve();
        resolve = null;
      }
    }, 15_000);

    try {
      while (!done) {
        // Drain whatever is in the queue
        while (queue.length > 0) {
          const event = queue.shift();
          if (!event) {
            break;
          }
          yield event;
          if (event.type === 'end') {
            return;
          }
        }
        // Wait for more events
        await new Promise<void>((r) => {
          resolve = r;
        });
      }
    } finally {
      clearInterval(heartbeatTimer);
      unsubscribe();
    }
  }

  // =====================================
  // AI BATCH OPERATIONS
  // =====================================

  /**
   * Start batch polling for automatic batch completion handling
   */
  async startBatchPolling(): Promise<void> {
    await this.baseAIClient.startBatchPolling();
  }

  /**
   * Stop batch polling
   */
  async stopBatchPolling(): Promise<void> {
    await this.baseAIClient.stopBatchPolling();
  }

  // =====================================
  // CRON SCHEDULER
  // =====================================

  /**
   * Start the cron scheduler for automatic cron trigger execution.
   * Call after initialize() — typically in your server startup code.
   * If cronEnabled is false in FlowlibConfig.triggers, this is a no-op.
   */
  async startCronScheduler(): Promise<void> {
    const cronEnabled = this.config.triggers?.cronEnabled ?? true;
    if (!cronEnabled) {
      this.config.logger.info('Cron scheduler disabled via config');
      return;
    }

    this.config.logger.info('Starting cron scheduler');
    const scheduler = this.serviceFactory?.getCronScheduler();
    if (!scheduler) {
      throw new Error('ServiceFactory not initialized');
    }
    await scheduler.start();
  }

  /**
   * Stop the cron scheduler. Call during graceful shutdown.
   */
  stopCronScheduler(): void {
    this.config.logger.info('Stopping cron scheduler');
    const scheduler = this.serviceFactory?.getCronScheduler();
    if (!scheduler) {
      throw new Error('ServiceFactory not initialized');
    }
    scheduler.stop();
  }

  /**
   * Refresh cron jobs from the database (e.g. after trigger registrations change).
   */
  async refreshCronScheduler(): Promise<void> {
    const scheduler = this.serviceFactory?.getCronScheduler();
    if (!scheduler) {
      throw new Error('ServiceFactory not initialized');
    }
    await scheduler.refresh();
  }

  // =====================================
  // TESTING AND DEVELOPMENT
  // =====================================

  /**
   * Test a JS expression in the sandboxed QuickJS runtime.
   * Used by the frontend data mapper preview.
   */
  async testJsExpression(request: {
    expression: string;
    context: Record<string, unknown>;
  }): Promise<{ success: boolean; result?: unknown; error?: string }> {
    this.ensureInitialized();
    if (!this.jsExpressionService) {
      return { success: false, error: 'JS expression engine not initialized' };
    }
    try {
      const result = await this.jsExpressionService.evaluate(request.expression, request.context);
      return { success: true, result };
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  /**
   * Test a mapper expression — returns the result plus metadata about how
   * the node would behave (iterate vs single, item count).
   * Used by the frontend Data Mapper pane live preview.
   */
  async testMapper(request: {
    expression: string;
    incomingData: Record<string, unknown>;
    mode?: 'auto' | 'iterate' | 'reshape';
  }): Promise<{
    success: boolean;
    result?: unknown;
    resultType?: 'array' | 'object' | 'primitive';
    itemCount?: number;
    error?: string;
  }> {
    this.ensureInitialized();
    if (!this.jsExpressionService) {
      return { success: false, error: 'JS expression engine not initialized' };
    }
    try {
      const result = await this.jsExpressionService.evaluate(
        request.expression,
        request.incomingData,
      );
      const mode = request.mode ?? 'auto';
      const isArray = Array.isArray(result);
      let resultType: 'array' | 'object' | 'primitive';

      if (isArray) {
        resultType = 'array';
      } else if (result !== null && typeof result === 'object') {
        resultType = 'object';
      } else {
        resultType = 'primitive';
      }

      // Apply mode semantics for preview
      if (mode === 'iterate' && !isArray) {
        return {
          success: false,
          error: `Mode is "iterate" but expression returned ${resultType}, not an array`,
        };
      }

      return {
        success: true,
        result,
        resultType,
        itemCount: isArray ? (result as unknown[]).length : undefined,
      };
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  /**
   * Test a model prompt
   */
  async testModelPrompt(request: SubmitPromptRequest): Promise<unknown> {
    this.config.logger.debug(
      'testModelPrompt called with arguments:',
      JSON.stringify(request, null, 2),
    );
    if (request.credentialId) {
      await this.ensureAdapterForCredential(request.credentialId, request.provider);
    }
    return this.baseAIClient.executePrompt(request);
  }

  /**
   * Get available AI models
   */
  async getAvailableModels(): Promise<unknown> {
    return this.nodeDataService.getAvailableModels();
  }

  /**
   * Get models for a specific provider
   */
  async getModelsForProvider(provider: BatchProvider): Promise<{
    provider: BatchProvider;
    models: Model[];
    defaultModel: string;
  }> {
    if (!provider) {
      throw new ValidationError('Provider is required to list models');
    }

    const result = await this.nodeDataService.getModelsForProvider(provider);
    return {
      provider,
      ...result,
    };
  }

  /**
   * Get models for a credential by detecting its provider
   */
  async getModelsForCredential(credentialId: string): Promise<{
    provider: BatchProvider;
    models: Model[];
    defaultModel: string;
  }> {
    if (!credentialId) {
      throw new ValidationError('credentialId is required to list models');
    }

    const credential = await this.credentialsService.get(credentialId);
    const provider = detectProviderFromCredential(credential);

    if (!provider) {
      throw new ValidationError(
        'Unable to detect provider from credential. Ensure the credential has an API URL or provider hint.',
      );
    }

    const result = await this.nodeDataService.getModelsForProvider(provider);
    return {
      provider,
      ...result,
    };
  }

  /**
   * Get definitions for all available nodes.
   * Returns both legacy node definitions and action-based node definitions.
   */
  getAvailableNodes(): NodeDefinition[] {
    this.ensureInitialized();

    const allDefs = this.actionRegistry ? this.actionRegistry.getAllNodeDefinitions() : [];

    for (const def of allDefs) {
      if (!def.provider) {
        def.provider = { id: 'core', name: 'Flowlib Core', icon: 'Blocks' };
      }
    }

    return allDefs;
  }

  /** Get the TemplateService or throw if not initialized. */
  private getTemplateServiceOrThrow(): TemplateService {
    if (!this.templateService) {
      throw new Error('TemplateService not available — JS expression engine failed to initialize');
    }
    return this.templateService;
  }

  /**
   * Resolve {{ expression }} templates in params using the provided context.
   * Used for test node execution where we need to resolve templates before running.
   *
   * @param params - The node parameters to resolve
   * @param context - The context to use for template resolution
   * @param skipKeys - Keys to skip (their values should not be resolved as templates)
   */
  private async resolveTemplateParams(
    params: Record<string, unknown>,
    context: Record<string, unknown>,
    skipKeys: string[] = [],
  ): Promise<Record<string, unknown>> {
    const templateService = this.getTemplateServiceOrThrow();
    const resolved: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(params)) {
      // Skip keys that shouldn't have their templates resolved
      if (skipKeys.includes(key)) {
        resolved[key] = value;
        continue;
      }

      if (typeof value === 'string' && templateService.isTemplate(value)) {
        try {
          const renderedValue = await templateService.render(value, context);
          resolved[key] = renderedValue;
          this.config.logger.debug('Resolved template param for test', {
            param: key,
            template: value,
            resolved: renderedValue,
          });
        } catch (error) {
          // On error, keep original value and log warning
          this.config.logger.warn('Failed to resolve template param for test', {
            param: key,
            template: value,
            error: error instanceof Error ? error.message : String(error),
          });
          resolved[key] = value;
        }
      } else {
        resolved[key] = value;
      }
    }

    return resolved;
  }

  /**
   * Test/execute a single node with the provided params and input data.
   * This is useful for testing node configuration in isolation.
   *
   * Templates in params (e.g., {{ some_input.data.variables.output.value }})
   * are resolved using the inputData as context before execution.
   *
   * @param nodeType - The type of node to execute
   * @param params - The node's configuration parameters (may contain {{ }} templates)
   * @param inputData - Mock input data used both as node inputs and as template context
   * @returns The node execution result
   */
  async testNode(
    nodeType: string,
    params: Record<string, unknown>,
    inputData: Record<string, unknown> = {},
  ): Promise<{ success: boolean; output?: Record<string, unknown>; error?: string }> {
    this.ensureInitialized();

    const action = this.actionRegistry ? this.actionRegistry.get(nodeType) : undefined;
    if (!action) {
      throw new ValidationError(`Unknown node type: ${nodeType}`);
    }

    const defaultParams: Record<string, unknown> = Object.fromEntries(
      (action.params.fields ?? [])
        .filter((f) => f.defaultValue !== undefined)
        .map((f) => [f.name, f.defaultValue]),
    );
    const mergedParams = { ...defaultParams, ...params };

    // Determine which param keys should NOT be resolved as templates
    const skipTemplateResolutionKeys: string[] = [];
    if (nodeType === 'core.template_string') {
      skipTemplateResolutionKeys.push('template');
    }

    // Resolve templates in params using inputData as context
    const resolvedParams = await this.resolveTemplateParams(
      mergedParams,
      inputData,
      skipTemplateResolutionKeys,
    );

    this.config.logger.debug('Test node with resolved params', {
      nodeType,
      defaultParams,
      originalParams: params,
      mergedParams,
      resolvedParams,
      inputDataKeys: Object.keys(inputData),
    });

    try {
      const { executeActionAsNode } = await import('@flowlib/actions');

      const mockContext: NodeExecutionContext = {
        nodeId: `test-${Date.now()}`,
        flowRunId: `test-run-${Date.now()}`,
        logger: this.config.logger,
        globalConfig: {},
        flowInputs: {},
        flowParams: { useBatchProcessing: false },
        incomingData: inputData,
        functions: {
          evaluator: this.jsExpressionService ?? undefined,
          markDownstreamNodesAsSkipped: () => {
            /* noop */
          },
          runTemplateReplacement: async (template: string, variables: Record<string, unknown>) => {
            if (!this.templateService) {
              return template;
            }
            const result = await this.templateService.render(template, variables);
            if (result === null || result === undefined) {
              return '';
            }
            if (typeof result === 'object') {
              return JSON.stringify(result);
            }
            return String(result);
          },
          submitPrompt: async (request: SubmitPromptRequest) =>
            this.baseAIClient.executePrompt(request),
          getCredential: async (credentialId: string) =>
            this.credentialsService.getDecryptedWithRefresh(credentialId),
        },
        allNodeOutputs: new Map(),
      } as unknown as NodeExecutionContext;

      const result = await executeActionAsNode(action, resolvedParams, mockContext);

      if (result.state === NodeExecutionStatus.SUCCESS) {
        let output: Record<string, unknown> | undefined;
        if (result.output?.data?.variables) {
          output = Object.fromEntries(
            Object.entries(result.output.data.variables).map(([k, v]) => [
              k,
              (v as { value: unknown }).value,
            ]),
          );
        } else if (result.output) {
          output = result.output as unknown as Record<string, unknown>;
        }
        return { success: true, output };
      } else if (result.state === NodeExecutionStatus.FAILED) {
        return { success: false, error: result.errors?.join(', ') || 'Node execution failed' };
      } else {
        return { success: true, output: { status: 'pending' } };
      }
    } catch (error) {
      this.config.logger.error('Test node execution failed', { error, nodeType });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Handle node configuration update events coming from the frontend.
   * Supports both legacy executors (AGENT) and action-based nodes.
   */
  async handleNodeConfigUpdate(event: NodeConfigUpdateEvent): Promise<NodeConfigUpdateResponse> {
    this.ensureInitialized();

    if (!event?.nodeType) {
      throw new ValidationError('nodeType is required for node config updates');
    }

    if (!event.params || typeof event.params !== 'object') {
      event.params = {};
    }

    const configContext = {
      logger: this.config.logger,
      services: {
        credentials: this.credentialsService,
        baseAIClient: this.baseAIClient,
      },
    };

    const nodeTypeStr = event.nodeType as string;
    const action = this.actionRegistry?.get(nodeTypeStr);
    if (action) {
      if (action.onConfigUpdate) {
        try {
          return await action.onConfigUpdate({ ...event, nodeType: nodeTypeStr }, configContext);
        } catch (error) {
          this.config.logger.error('Action config update handler failed', {
            error,
            nodeType: nodeTypeStr,
            nodeId: event.nodeId,
          });
          throw error;
        }
      }

      // No custom handler — return the static definition from the action registry
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const definition = this.actionRegistry!.toNodeDefinition(nodeTypeStr);
      if (definition) {
        return { definition, params: event.params };
      }
    }

    throw new ValidationError(`Unknown node type '${event.nodeType}' for config update`);
  }

  /**
   * Resolve dynamic options for a specific field on an action.
   *
   * Called by: `GET /actions/:actionId/fields/:fieldName/options?deps={...}`
   *
   * The action's `ParamField.loadOptions.handler` is invoked server-side with
   * the dependency values and returns an options list + optional default value.
   */
  async resolveFieldOptions(
    actionId: string,
    fieldName: string,
    dependencyValues: Record<string, unknown>,
  ): Promise<LoadOptionsResult> {
    this.ensureInitialized();

    if (!this.actionRegistry) {
      throw new ValidationError('Action registry not initialised');
    }

    const context = {
      logger: this.config.logger,
      services: {
        credentials: this.credentialsService,
      },
    };

    return this.actionRegistry.resolveFieldOptions(actionId, fieldName, dependencyValues, context);
  }

  /**
   * Render flow to React Flow format
   */
  async renderToReactFlow(
    flowId: string,
    options?: { version?: string | number | 'latest'; flowRunId?: string },
  ): Promise<ReactFlowData> {
    this.config.logger.debug(
      'renderToReactFlow called with arguments:',
      JSON.stringify({ flowId, options }, null, 2),
    );
    return this.reactFlowRendererService.renderToReactFlow(flowId, options);
  }

  // =====================================
  // PRIVATE SERVICE GETTERS
  // =====================================

  /**
   * Get flow service with initialization check
   */
  private get flowService() {
    this.ensureInitialized();
    return this.serviceFactory.getFlowService();
  }

  /**
   * Get flow versions service with initialization check
   */
  private get flowVersionsService() {
    this.ensureInitialized();
    return this.serviceFactory.getFlowVersionsService();
  }

  /**
   * Get flow runs service with initialization check
   */
  private get flowRunsService() {
    this.ensureInitialized();
    return this.serviceFactory.getFlowRunsService();
  }

  /**
   * Get orchestration service with initialization check
   */
  private get orchestrationService() {
    this.ensureInitialized();
    return this.serviceFactory.getOrchestrationService();
  }

  /**
   * Get node executions service with initialization check
   */
  private get nodeExecutionsService() {
    this.ensureInitialized();
    return this.serviceFactory.getNodeExecutionsService();
  }

  /**
   * Get node data service with initialization check
   */
  private get nodeDataService() {
    this.ensureInitialized();
    return this.serviceFactory.getNodeDataService();
  }

  /**
   * Get base AI client with initialization check
   */
  private get baseAIClient() {
    this.ensureInitialized();
    return this.serviceFactory.getBaseAIClient();
  }

  /**
   * Ensure a provider adapter is registered for the given credential.
   * Resolves the credential, extracts the API key, detects the provider,
   * and calls registerAdapter() if not already present.
   */
  private async ensureAdapterForCredential(
    credentialId: string,
    providerHint?: BatchProvider | string,
  ): Promise<void> {
    const client = this.baseAIClient;
    // If the provider hint is available and the adapter already exists, skip.
    if (providerHint && client.hasAdapter(providerHint as BatchProvider)) {
      return;
    }

    const credential = await this.credentialsService.getDecryptedWithRefresh(credentialId);
    const apiKey = (credential.config as Record<string, unknown>)?.apiKey as string | undefined;
    if (!apiKey) {
      throw new Error(`Credential "${credentialId}" does not contain an apiKey.`);
    }

    const detected = detectProviderFromCredential(credential);
    if (!detected) {
      throw new Error(`Unable to detect AI provider from credential "${credentialId}".`);
    }

    if (client.hasAdapter(detected)) {
      return;
    }

    const label =
      detected === BatchProvider.OPENAI
        ? 'OPENAI'
        : detected === BatchProvider.ANTHROPIC
          ? 'ANTHROPIC'
          : 'OPENROUTER';

    client.registerAdapter(label, apiKey);
  }

  /**
   * Get React Flow renderer service with initialization check
   */
  private get reactFlowRendererService() {
    this.ensureInitialized();
    return this.serviceFactory.getReactFlowRendererService();
  }

  /**
   * Get credentials service with initialization check
   */
  private get credentialsService() {
    this.ensureInitialized();
    return this.serviceFactory.getCredentialsService();
  }

  /**
   * Get triggers service with initialization check
   */
  private get triggersService() {
    this.ensureInitialized();
    return this.serviceFactory.getTriggersService();
  }

  /**
   * Get credentials service (public accessor)
   */
  public getCredentialsService() {
    return this.credentialsService;
  }

  // =====================================
  // PRIVATE INITIALIZATION METHODS
  // =====================================

  /**
   * Ensure default credentials exist.
   * Runs once after initialization completes — skips any that already exist by name.
   */
  private async ensureDefaultCredentials(): Promise<void> {
    const seeds = this.config.defaultCredentials;
    if (!seeds?.length) {
      return;
    }

    const existing = await this.listCredentials();
    const existingByName = new Map(existing.map((c) => [c.name, c]));

    for (const seed of seeds) {
      try {
        const { provider, ...rest } = seed;
        const metadata = { ...rest.metadata, ...(provider ? { provider } : {}) };
        const existingCred = existingByName.get(seed.name);

        if (existingCred) {
          try {
            // For OAuth2 credentials, merge the seed config with the existing
            // config so that tokens obtained during authorization are preserved.
            // The seed typically only provides clientId, clientSecret, and
            // oauth2Provider — overwriting the full config would erase
            // accessToken, refreshToken, expiresAt, etc.
            let mergedConfig = rest.config;
            if (rest.authType === 'oauth2') {
              const existingDecrypted = await this.credentialsService.get(existingCred.id);
              const existingConfig = existingDecrypted.config ?? {};
              mergedConfig = { ...existingConfig, ...rest.config };
            }

            await this.updateCredential(existingCred.id, {
              name: rest.name,
              type: rest.type,
              authType: rest.authType as CredentialAuthType,
              config: mergedConfig,
              description: rest.description,
              isShared: rest.isShared,
              metadata,
            });
            this.config.logger.debug(`Upserted credential "${seed.name}" (${existingCred.id})`);
          } catch {
            // Decryption failure (e.g. encryption key changed) — delete and recreate
            this.config.logger.warn(
              `Failed to update credential "${seed.name}", recreating with current encryption key`,
            );
            try {
              await this.credentialsService.forceDelete(existingCred.id);
            } catch {
              // best-effort delete
            }
            const created = await this.createCredential({
              name: rest.name,
              type: rest.type,
              authType: rest.authType as CredentialAuthType,
              config: rest.config,
              description: rest.description,
              isShared: rest.isShared,
              metadata,
            });
            // eslint-disable-next-line no-console
            console.log(`🔐 Re-seeded credential: ${created.name} (${created.id})`);
          }
        } else {
          const created = await this.createCredential({
            name: rest.name,
            type: rest.type,
            authType: rest.authType as CredentialAuthType,
            config: rest.config,
            description: rest.description,
            isShared: rest.isShared,
            metadata,
          });
          // eslint-disable-next-line no-console
          console.log(`🔐 Seeded credential: ${created.name} (${created.id})`);
        }
      } catch (error) {
        this.config.logger.warn(`Failed to upsert credential "${seed.name}"`, error);
      }
    }
  }

  /**
   * Initialize services
   */
  private async initializeServices(): Promise<void> {
    this.config.logger.debug('Initializing service factory...');

    this.serviceFactory = new ServiceFactory(
      this.config,
      this.actionRegistry,
      this.pluginManager,
      this.jsExpressionService ?? undefined,
      this.templateService ?? undefined,
    );
    await this.serviceFactory.initialize();
  }

  /**
   * Ensure core is initialized
   */
  private ensureInitialized(): asserts this is {
    serviceFactory: ServiceFactory;
  } {
    if (!this.initialized || !this.serviceFactory) {
      throw new DatabaseError('Flowlib Core not initialized. Call initialize() first.');
    }
  }

  // =====================================
  // ACTIONS API (Provider-Actions architecture)
  // =====================================

  /**
   * Get the action registry.
   */
  getActionRegistry(): ActionRegistry {
    this.ensureInitialized();
    if (!this.actionRegistry) {
      throw new DatabaseError('Action registry not initialized');
    }
    return this.actionRegistry;
  }

  /**
   * Register an action at runtime (e.g. from a plugin or external package).
   */
  registerAction(action: ActionDefinition): void {
    this.ensureInitialized();
    if (!this.actionRegistry) {
      throw new DatabaseError('Action registry not initialized');
    }
    this.actionRegistry.register(action);
  }

  /**
   * Get all registered providers.
   */
  getProviders(): ProviderDef[] {
    this.ensureInitialized();
    if (!this.actionRegistry) {
      return [];
    }
    return this.actionRegistry.getProviders();
  }

  /**
   * Get all actions for a specific provider.
   */
  getActionsForProvider(providerId: string): ActionDefinition[] {
    this.ensureInitialized();
    if (!this.actionRegistry) {
      return [];
    }
    return this.actionRegistry.getActionsForProvider(providerId);
  }

  // =====================================
  // AGENT TOOLS API
  // =====================================

  /**
   * Get all available agent tools
   */
  getAgentTools(): AgentToolDefinition[] {
    this.ensureInitialized();
    if (!this.actionRegistry) {
      return [];
    }
    const defs: AgentToolDefinition[] = [];
    for (const action of this.actionRegistry.getAll()) {
      const toolDef = this.actionRegistry.toAgentToolDefinition(action.id);
      if (toolDef) {
        defs.push(toolDef);
      }
    }
    return defs;
  }

  /**
   * Execute agent prompt with tools
   */
  async submitAgentPrompt(
    request: SubmitAgentPromptRequest,
  ): Promise<
    | AgentPromptResult
    | { type: 'batch_submitted'; batchJobId: string; nodeId: string; flowRunId: string }
  > {
    this.ensureInitialized();
    await this.ensureAdapterForCredential(request.credentialId, request.provider);
    return await this.baseAIClient.runAgentPrompt(request, request.provider);
  }

  // =====================================
  // CHAT ASSISTANT API
  // =====================================

  /**
   * Create a streaming chat session.
   *
   * Returns an AsyncGenerator<ChatStreamEvent> that framework adapters
   * serialize to SSE. The generator handles the full LLM loop including
   * tool calls.
   *
   * @example
   * ```typescript
   * const stream = await flowlib.createChatStream({
   *   messages: [{ role: 'user', content: 'Add a Gmail node' }],
   *   context: { flowId: 'flow_123' },
   * });
   *
   * for await (const event of stream) {
   *   // event.type: 'text_delta' | 'tool_call_start' | 'tool_call_result' | 'done' | 'error'
   * }
   * ```
   */
  async createChatStream(options: {
    messages: Array<{ role: string; content: string; toolCalls?: unknown[]; toolCallId?: string }>;
    context: {
      flowId?: string;
      selectedNodeId?: string;
      viewMode?: string;
      credentialId?: string;
      maxSteps?: number;
    };
    identity?: FlowlibIdentity;
  }): Promise<AsyncGenerator<import('./services/chat').ChatStreamEvent>> {
    this.ensureInitialized();
    const chatService = this.serviceFactory.getChatStreamService();
    return chatService.createStream({
      messages: options.messages as import('./services/chat').ChatMessage[],
      context: options.context as import('./services/chat').ChatContext,
      identity: options.identity,
    });
  }

  /**
   * Check if the chat assistant feature is enabled and configured.
   */
  isChatEnabled(): boolean {
    this.ensureInitialized();
    return this.serviceFactory.getChatStreamService().isEnabled();
  }

  // =====================================
  // CHAT MESSAGE PERSISTENCE API
  // =====================================

  /**
   * Get persisted chat messages for a flow (paginated, ordered by creation time).
   */
  async getChatMessages(
    flowId: string,
    options?: { limit?: number; page?: number },
  ): Promise<{
    data: import('./services/chat/chat-messages.model').ChatMessageRecord[];
    pagination: { page: number; limit: number; totalPages: number };
  }> {
    this.ensureInitialized();
    return this.serviceFactory.getDatabaseService().chatMessages.getByFlowId(flowId, options);
  }

  /**
   * Save chat messages for a flow (replaces existing messages).
   */
  async saveChatMessages(
    flowId: string,
    messages: Array<{
      role: 'user' | 'assistant' | 'system' | 'tool';
      content: string;
      toolMeta?: Record<string, unknown> | null;
    }>,
  ): Promise<import('./services/chat/chat-messages.model').ChatMessageRecord[]> {
    this.ensureInitialized();
    const db = this.serviceFactory.getDatabaseService();
    // Replace: delete all existing, then bulk insert
    await db.chatMessages.deleteByFlowId(flowId);
    return db.chatMessages.createMany(
      messages.map((m) => ({ flowId, role: m.role, content: m.content, toolMeta: m.toolMeta })),
    );
  }

  /**
   * Delete all chat messages for a flow.
   */
  async deleteChatMessages(flowId: string): Promise<void> {
    this.ensureInitialized();
    await this.serviceFactory.getDatabaseService().chatMessages.deleteByFlowId(flowId);
  }

  // =====================================
  // TRIGGERS API
  // =====================================

  /**
   * List all trigger registrations for a flow.
   */
  async listTriggersForFlow(flowId: string): Promise<FlowTriggerRegistration[]> {
    this.config.logger.debug('listTriggersForFlow called', { flowId });
    return this.triggersService.listTriggersForFlow(flowId);
  }

  /**
   * Get a single trigger registration by ID.
   */
  async getTrigger(triggerId: string): Promise<FlowTriggerRegistration | null> {
    this.config.logger.debug('getTrigger called', { triggerId });
    return this.triggersService.getTrigger(triggerId);
  }

  /**
   * Create a trigger registration.
   */
  async createTrigger(input: CreateTriggerInput): Promise<FlowTriggerRegistration> {
    this.config.logger.debug('createTrigger called', { flowId: input.flowId, type: input.type });
    return this.triggersService.createTrigger(input);
  }

  /**
   * Update a trigger registration.
   */
  async updateTrigger(
    triggerId: string,
    input: UpdateTriggerInput,
  ): Promise<FlowTriggerRegistration | null> {
    this.config.logger.debug('updateTrigger called', { triggerId });
    return this.triggersService.updateTrigger(triggerId, input);
  }

  /**
   * Delete a trigger registration.
   */
  async deleteTrigger(triggerId: string): Promise<void> {
    this.config.logger.debug('deleteTrigger called', { triggerId });
    return this.triggersService.deleteTrigger(triggerId);
  }

  /**
   * Sync trigger registrations for a flow from its definition.
   * Call this after publishing a new flow version. Also refreshes
   * the cron scheduler if any cron triggers were changed.
   */
  async syncTriggersForFlow(
    flowId: string,
    definition: { nodes: Array<{ id: string; type: string; params?: Record<string, unknown> }> },
  ): Promise<FlowTriggerRegistration[]> {
    this.config.logger.debug('syncTriggersForFlow called', { flowId });
    const result = await this.triggersService.syncTriggersForFlow(flowId, definition);

    // Refresh cron scheduler if it's running
    try {
      const scheduler = this.serviceFactory?.getCronScheduler();
      if (scheduler?.isRunning()) {
        await scheduler.refresh();
      }
    } catch {
      // Scheduler may not be started — that's fine
    }

    return result;
  }

  /**
   * Get all enabled cron triggers (for scheduler initialization).
   */
  async getEnabledCronTriggers(): Promise<FlowTriggerRegistration[]> {
    this.config.logger.debug('getEnabledCronTriggers called');
    return this.triggersService.getEnabledCronTriggers();
  }

  /**
   * Execute a cron trigger (called by the cron scheduler).
   */
  async executeCronTrigger(triggerId: string): Promise<{ flowRunId: string; flowId: string }> {
    this.config.logger.debug('executeCronTrigger called', { triggerId });
    return this.triggersService.executeCronTrigger(triggerId);
  }

  // =====================================
  // OAUTH2 API
  // =====================================

  /**
   * Get all available OAuth2 providers
   */
  getOAuth2Providers() {
    this.ensureInitialized();
    return this.serviceFactory.getCredentialsService().getOAuth2Service().getProviders();
  }

  /**
   * Get a specific OAuth2 provider by ID
   */
  getOAuth2Provider(providerId: string) {
    this.ensureInitialized();
    return this.serviceFactory.getCredentialsService().getOAuth2Service().getProvider(providerId);
  }

  /**
   * Start an OAuth2 authorization flow
   * Returns the authorization URL and state to redirect the user to
   */
  startOAuth2Flow(
    providerId: string,
    appConfig: { clientId: string; clientSecret: string; redirectUri: string },
    options?: {
      scopes?: string[];
      returnUrl?: string;
      credentialName?: string;
      existingCredentialId?: string;
    },
  ) {
    this.ensureInitialized();
    return this.serviceFactory
      .getCredentialsService()
      .getOAuth2Service()
      .startAuthorizationFlow(providerId, appConfig, options);
  }

  /**
   * Get pending OAuth2 state (for verifying callback)
   */
  getOAuth2PendingState(state: string) {
    this.ensureInitialized();
    return this.serviceFactory.getCredentialsService().getOAuth2Service().getPendingState(state);
  }

  /**
   * Handle OAuth2 callback - exchange code for tokens and create or update credential
   */
  async handleOAuth2Callback(
    code: string,
    state: string,
    appConfig?: { clientId: string; clientSecret: string; redirectUri: string },
  ): Promise<Credential> {
    this.ensureInitialized();

    const credentialsService = this.serviceFactory.getCredentialsService();
    const oauth2Service = credentialsService.getOAuth2Service();

    // Resolve appConfig from pending state if not provided by the caller
    const pending = oauth2Service.getPendingState(state);
    const resolvedAppConfig = appConfig ?? pending?.appConfig;
    if (!resolvedAppConfig) {
      throw new Error('Missing app credentials — cannot exchange OAuth code');
    }

    // Exchange code for tokens
    const { tokens, pendingState } = await oauth2Service.exchangeCodeForTokens(
      code,
      state,
      resolvedAppConfig,
    );

    // Get provider info
    const provider = oauth2Service.getProvider(pendingState.providerId);
    if (!provider) {
      throw new Error(`Unknown OAuth2 provider: ${pendingState.providerId}`);
    }

    // Build credential config
    const config = oauth2Service.buildCredentialConfig(
      tokens,
      pendingState.providerId,
      resolvedAppConfig,
    );

    // If we have an existing credential ID, update it instead of creating a new one
    if (pendingState.existingCredentialId) {
      const credential = await credentialsService.update(pendingState.existingCredentialId, {
        config,
        metadata: {
          oauth2Provider: pendingState.providerId,
          scopes: tokens.scope?.split(' ') || provider.defaultScopes,
        },
      });

      this.loggerManager.getBasicLogger().info('Updated OAuth2 credential with tokens', {
        credentialId: credential.id,
        providerId: pendingState.providerId,
      });

      return credential;
    }

    // Create new credential
    const credential = await credentialsService.create({
      name: pendingState.credentialName || provider.name,
      type: 'http-api',
      authType: 'oauth2',
      config,
      description: `OAuth2 credential for ${provider.name}`,
      metadata: {
        oauth2Provider: pendingState.providerId,
        scopes: tokens.scope?.split(' ') || provider.defaultScopes,
      },
    });

    this.loggerManager.getBasicLogger().info('Created OAuth2 credential', {
      credentialId: credential.id,
      providerId: pendingState.providerId,
    });

    return credential;
  }

  /**
   * Refresh an OAuth2 credential's access token
   */
  async refreshOAuth2Credential(credentialId: string): Promise<Credential> {
    this.ensureInitialized();

    // Use getDecryptedWithRefresh which handles the refresh automatically
    return this.serviceFactory.getCredentialsService().getDecryptedWithRefresh(credentialId);
  }
}
