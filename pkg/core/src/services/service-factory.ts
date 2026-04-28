// Framework-agnostic Service Factory for Flowlib core
import { FlowsService } from './flows/flows.service';
import { FlowRunsService } from './flow-runs/flow-runs.service';
import { NodeExecutionService } from './node-executions/node-execution.service';
import { FlowOrchestrationService } from './flow-orchestration.service';
import { DatabaseService } from './database/database.service';
import { NodeDataService } from './node-data.service';
import { GraphService } from './graph.service';
import { BatchJobsService } from './batch-jobs/batch-jobs.service';
import { BaseAIClient } from './ai/base-client';
import { CredentialsService } from './credentials/credentials.service';
import { EncryptionService } from './credentials/encryption.service';
import { FlowTriggersService } from './triggers/flow-triggers.service';
import { CronSchedulerService } from './triggers/cron-scheduler.service';
import { ChatStreamService } from './chat/chat-stream.service';
import { ExecutionEventBus, getExecutionEventBus } from './execution-event-bus';
import { DatabaseError } from 'src/types/common/errors.types';
import { Logger, FlowlibConfig } from 'src/schemas';
import { FlowVersionsService } from './flow-versions/flow-versions.service';
import { ReactFlowRendererService } from './react-flow-renderer.service';
import type { PluginHookRunner } from 'src/types/plugin.types';
import type {
  EncryptionAdapter,
  ExecutionEventBusAdapter,
  CronSchedulerAdapter,
  BatchPollerAdapter,
  ChatSessionStore,
  JobRunnerAdapter,
} from 'src/types/services';
import {
  AdapterBackedExecutionEventBus,
  cronSchedulerToAdapter,
  batchPollerFromAIClient,
} from './adapter-bridges';
import { InProcessJobRunner } from './job-runner/in-process-job-runner';

/**
 * Core Services container
 */
interface CoreServices {
  flowsService: FlowsService;
  flowVersionsService: FlowVersionsService;
  flowRunsService: FlowRunsService;
  nodeExecutionsService: NodeExecutionService;
  orchestrationService: FlowOrchestrationService;
  databaseService: DatabaseService;
  nodeDataService: NodeDataService;
  graphService: GraphService;
  batchJobsService: BatchJobsService;
  baseAIClient: BaseAIClient;
  reactFlowRendererService: ReactFlowRendererService;
  credentialsService: CredentialsService;
  triggersService: FlowTriggersService;
  cronScheduler: CronSchedulerService;
  chatStreamService: ChatStreamService;
  executionEventBus: ExecutionEventBus;
  // Adapter handles for `FlowlibInstance` lifecycle methods. These resolve
  // to either the user-supplied override (`config.services?.X`) or a
  // default-wrapping bridge created at init time.
  encryptionAdapter: EncryptionAdapter;
  cronSchedulerAdapter: CronSchedulerAdapter;
  batchPollerAdapter: BatchPollerAdapter;
  chatSessionStore: ChatSessionStore | null;
  /**
   * Background job runner (PR 13/14). Either the user-supplied
   * `config.services.jobRunner` adapter or a default
   * `InProcessJobRunner` whose handlers are registered by
   * `FlowOrchestrationService.initialize()`.
   */
  jobRunner: JobRunnerAdapter;
}

/**
 * Service Factory for creating and managing core services
 */
export class ServiceFactory {
  private services: CoreServices | null = null;
  private initialized = false;
  logger: Logger;

  constructor(
    private readonly config: FlowlibConfig,
    /** Action registry for chat system prompt context */
    private readonly actionRegistryRef?: unknown,
    /** Plugin hook runner for lifecycle hooks */
    private readonly pluginHookRunner?: PluginHookRunner,
    /** JS expression service for data mapper (sandbox) */
    private readonly jsExpressionServiceRef?: import('./templating/js-expression.service').JsExpressionService,
    /** Template service for resolving {{ }} expressions in node params */
    private readonly templateServiceRef?: import('./templating/template.service').TemplateService,
  ) {
    this.logger = config.logger;
  }

  /**
   * Initialize all services
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      this.logger.debug('Service factory already initialized');
      return;
    }

    this.logger.info('Initializing service factory');

    try {
      // 1. Create database service first (no dependencies)
      // Schema verification always runs on startup to catch missing tables/columns.
      this.logger.debug('Creating DatabaseService...');
      const dbStart = Date.now();
      const verificationOpts = {
        strict: false,
        plugins: (this.config.plugins || []) as import('src/types/plugin.types').FlowlibPlugin[],
      };
      const databaseService = new DatabaseService(
        this.config.database,
        this.logger,
        verificationOpts,
        (this.config.plugins || []) as import('src/types/plugin.types').FlowlibPlugin[],
      );
      await databaseService.initialize();
      this.logger.info(`DatabaseService initialized in ${Date.now() - dbStart}ms`);

      // 3. Create BatchJobsService (database only, no AI client)
      const batchJobsService = new BatchJobsService(this.logger, databaseService);

      // 4. Create BaseAIClient (adapters are registered dynamically from credentials)
      const baseAIClient = new BaseAIClient(this.logger, batchJobsService);

      // 5. Create other services
      const flowVersionsService = new FlowVersionsService(this.logger, databaseService);
      const flowsService = new FlowsService(this.logger, databaseService);
      const nodeExecutionsService = new NodeExecutionService(this.logger, databaseService);
      // Honor `config.execution.persistence` — `'per-run'` mode buffers node
      // executions in-memory and flushes them as a JSON blob into
      // `flow_runs.node_outputs` at terminal-state. Default `'per-node'`
      // matches the historical behavior (one row per node per state change).
      nodeExecutionsService.setPersistenceMode(this.config.execution?.persistence ?? 'per-node');
      const flowRunsService = new FlowRunsService(this.logger, databaseService, flowsService);
      const nodeDataService = new NodeDataService(
        this.config,
        this.logger,
        databaseService,
        baseAIClient,
      );
      const graphService = new GraphService(this.logger, nodeExecutionsService);
      const reactFlowRendererService = new ReactFlowRendererService(
        this.logger,
        flowsService,
        flowVersionsService,
        flowRunsService,
        nodeExecutionsService,
      );

      // 5b. Create credentials service with encryption.
      // Honor an injected EncryptionAdapter if the host provided one (PR 2);
      // otherwise build the default in-process EncryptionService. The default
      // class is structurally compatible with EncryptionAdapter — the
      // optional `EncryptionContext` parameter is silently ignored by it
      // (per-tenant DEK lookup is PR 12 territory).
      const overrides = this.config.services;
      const encryptionAdapter: EncryptionAdapter =
        (overrides?.encryption as EncryptionAdapter | undefined) ??
        new EncryptionService({ masterKey: this.config.encryptionKey });
      const credentialsService = new CredentialsService(
        databaseService.adapter,
        encryptionAdapter,
        this.logger,
      );

      // 5d. Create triggers service (needs orchestration, wired after orchestration is created)
      // Placeholder — we wire the real orchestrationService reference below.

      // PR 5/14: when the host has supplied a `BatchPollerAdapter` override
      // (typical for serverless / edge runtimes that drive scheduling
      // externally — e.g. Cloudflare Cron Triggers calling
      // `flowlib.maintenance.pollBatchJobs()`), suppress the in-process
      // `setInterval` loops in the orchestration service. The `runMaintenance`
      // / `maintenance.*` entry points still work in this mode.
      const externalScheduler = !!(this.config.services as { batchPoller?: unknown } | undefined)
        ?.batchPoller;

      // 5e. Resolve background job runner adapter (PR 13/14). When the
      // host hasn't supplied an override, build the default in-process
      // runner — `FlowOrchestrationService.initialize()` then registers
      // its FLOW_RUN / BATCH_JOB_RESUME handlers on it. External
      // adapters (Cloudflare Queues, SQS) are expected to register
      // matching consumer-side handlers in their own consumer Worker.
      const jobRunner: JobRunnerAdapter =
        (overrides?.jobRunner as JobRunnerAdapter | undefined) ??
        new InProcessJobRunner({ logger: this.logger });

      // 6. Create orchestration service with proper dependencies
      const orchestrationService = new FlowOrchestrationService(
        this.logger,
        flowRunsService,
        nodeExecutionsService,
        flowsService,
        nodeDataService,
        graphService,
        batchJobsService,
        credentialsService, // Add credentials service
        baseAIClient, // Add baseAIClient for agent prompt support
        nodeExecutionsService, // Unified service handles both node + tool traces
        // Execution config: heartbeat, flow timeout, stale-run detection
        {
          heartbeatIntervalMs: this.config.execution?.heartbeatIntervalMs ?? 30_000,
          flowTimeoutMs: this.config.execution?.flowTimeoutMs ?? 600_000,
          staleRunCheckIntervalMs: this.config.execution?.staleRunCheckIntervalMs ?? 60_000,
          externalScheduler,
        },
        this.pluginHookRunner, // Plugin hooks for flow/node execution lifecycle
        this.jsExpressionServiceRef, // JS expression engine for data mapper
        this.templateServiceRef, // Template service for {{ }} expression resolution
        jobRunner, // PR 13/14 — pluggable background job runner
      );

      // 6b. Create triggers service (depends on orchestration)
      const triggersService = new FlowTriggersService(
        this.logger,
        databaseService,
        flowsService,
        flowVersionsService,
        orchestrationService,
      );

      // 6c. Create cron scheduler (depends on triggers service)
      const cronScheduler = new CronSchedulerService(this.logger, triggersService);

      // 6d. Create chat stream service
      const chatStreamService = new ChatStreamService(
        this.logger,
        credentialsService,
        flowsService,
        flowVersionsService,
        (this.actionRegistryRef as import('@flowlib/actions/registry').ActionRegistry) ?? null,
        null, // flowlib instance wired post-init via chatStreamService.setFlowlibInstance()
      );

      // 6e. Wire execution event bus to services that write state.
      // Honor an injected ExecutionEventBusAdapter if the host provided one
      // (PR 2). The bridge subclass keeps the in-process EventEmitter as a
      // fallback so same-isolate subscribers still work, and additionally
      // forwards every emit through the adapter for out-of-process delivery
      // (e.g. a Cloudflare Durable Object). PR 8 will remove the bridge by
      // making the default class itself implement the adapter.
      const eventBusOverride = overrides?.eventBus as ExecutionEventBusAdapter | undefined;
      const executionEventBus: ExecutionEventBus = eventBusOverride
        ? new AdapterBackedExecutionEventBus(eventBusOverride)
        : getExecutionEventBus();
      flowRunsService.setEventBus(executionEventBus);
      nodeExecutionsService.setEventBus(executionEventBus);

      // 6f. Resolve cron / batch poller adapters. Defaults wrap the
      // existing in-process services; hosts can pass no-op adapters when
      // their platform handles scheduling externally (Cloudflare Cron
      // Triggers, Vercel Cron). PR 5 will fully decouple the lifecycle.
      const cronSchedulerAdapter: CronSchedulerAdapter =
        (overrides?.cronScheduler as CronSchedulerAdapter | undefined) ??
        cronSchedulerToAdapter(cronScheduler);
      const batchPollerAdapter: BatchPollerAdapter =
        (overrides?.batchPoller as BatchPollerAdapter | undefined) ??
        batchPollerFromAIClient(baseAIClient);

      // 6g. Resolve chat session store override. The in-process
      // `ActiveChatSessions` is owned by `ChatStreamService` and isn't a
      // simple `Map<id, session>` (it carries subscribers and timers), so
      // there is no default `ChatSessionStore` instance to expose here.
      // The override is held for the next wave of PRs (5/14) when chat
      // sessions move behind this contract.
      const chatSessionStoreOverride =
        (overrides?.chatSessionStore as ChatSessionStore | undefined) ?? null;

      // Initialize services
      await Promise.all([
        batchJobsService.initialize(),
        flowsService.initialize(),
        flowRunsService.initialize(),
        nodeExecutionsService.initialize(),
        orchestrationService.initialize(),
        nodeDataService.initialize(),
        reactFlowRendererService.initialize(),
        triggersService.initialize(),
      ]);

      // Store services
      this.services = {
        flowsService,
        flowVersionsService,
        flowRunsService,
        nodeExecutionsService,
        orchestrationService,
        databaseService,
        nodeDataService,
        graphService,
        batchJobsService,
        baseAIClient,
        reactFlowRendererService,
        credentialsService,
        triggersService,
        cronScheduler,
        chatStreamService,
        executionEventBus,
        encryptionAdapter,
        cronSchedulerAdapter,
        batchPollerAdapter,
        chatSessionStore: chatSessionStoreOverride,
        jobRunner,
      };

      this.initialized = true;
      this.logger.info('Service factory initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize service factory', error);
      throw new DatabaseError('Failed to initialize service factory', { error });
    }
  }

  /**
   * Get all services
   */
  getServices(): CoreServices {
    if (!this.services) {
      throw new Error('Service factory not initialized');
    }
    return this.services;
  }

  /**
   * Get flow service
   */
  getFlowService(): FlowsService {
    return this.getServices().flowsService;
  }

  /**
   * Get execution service
   */
  getFlowRunsService(): FlowRunsService {
    return this.getServices().flowRunsService;
  }

  /**
   * Get execution trace service
   */
  getNodeExecutionsService(): NodeExecutionService {
    return this.getServices().nodeExecutionsService;
  }

  /**
   * Get orchestration service
   */
  getOrchestrationService(): FlowOrchestrationService {
    return this.getServices().orchestrationService;
  }

  /**
   * Get the config the factory was constructed with. Useful for callers that
   * need a non-service config field (e.g. `execution.sseHeartbeatIntervalMs`).
   */
  getConfig(): FlowlibConfig {
    return this.config;
  }

  getFlowVersionsService() {
    return this.getServices().flowVersionsService;
  }

  /**
   * Get database service
   */
  getDatabaseService(): DatabaseService {
    return this.getServices().databaseService;
  }

  /**
   * Get node data service
   */
  getNodeDataService(): NodeDataService {
    return this.getServices().nodeDataService;
  }

  /**
   * Get graph service
   */
  getGraphService(): GraphService {
    return this.getServices().graphService;
  }

  /**
   * Get base AI client
   */
  getBaseAIClient(): BaseAIClient {
    return this.getServices().baseAIClient;
  }

  /**
   * Get React Flow renderer service
   */
  getReactFlowRendererService(): ReactFlowRendererService {
    return this.getServices().reactFlowRendererService;
  }

  /**
   * Get credentials service
   */
  getCredentialsService(): CredentialsService {
    return this.getServices().credentialsService;
  }

  /**
   * Get triggers service
   */
  getTriggersService(): FlowTriggersService {
    return this.getServices().triggersService;
  }

  /**
   * Get cron scheduler service
   */
  getCronScheduler(): CronSchedulerService {
    return this.getServices().cronScheduler;
  }

  /**
   * Get chat stream service
   */
  getChatStreamService(): ChatStreamService {
    return this.getServices().chatStreamService;
  }

  /**
   * Get execution event bus for SSE streaming
   */
  getExecutionEventBus(): ExecutionEventBus {
    return this.getServices().executionEventBus;
  }

  // ─── Adapter accessors (PR 2/14) ───────────────────────────────────
  // These return the resolved adapter for each pluggable service —
  // either the user-supplied override or a default-wrapping bridge.

  /** Encryption adapter (override or default `EncryptionService`). */
  getEncryptionAdapter(): EncryptionAdapter {
    return this.getServices().encryptionAdapter;
  }

  /** Cron scheduler adapter (override or default `CronSchedulerService`). */
  getCronSchedulerAdapter(): CronSchedulerAdapter {
    return this.getServices().cronSchedulerAdapter;
  }

  /** Batch poller adapter (override or default `BaseAIClient` polling loop). */
  getBatchPollerAdapter(): BatchPollerAdapter {
    return this.getServices().batchPollerAdapter;
  }

  /**
   * Chat session store override, if the host supplied one. Returns `null`
   * when running with the default in-process `ActiveChatSessions` (which is
   * owned by `ChatStreamService` and not exposed here).
   */
  getChatSessionStoreOverride(): ChatSessionStore | null {
    return this.getServices().chatSessionStore;
  }

  /**
   * Background job runner (PR 13/14) — override or default
   * `InProcessJobRunner`. Hosts use this from `FlowlibInstance`
   * lifecycle / maintenance methods to drive the in-process queue.
   */
  getJobRunner(): JobRunnerAdapter {
    return this.getServices().jobRunner;
  }

  /**
   * Health check for all services
   */
  async healthCheck(): Promise<{
    healthy: boolean;
    services: Record<string, boolean>;
    timestamp: string;
  }> {
    const serviceResults: Record<string, boolean> = {};
    let allHealthy = true;

    if (!this.services) {
      return {
        healthy: false,
        services: { factory: false },
        timestamp: new Date().toISOString(),
      };
    }

    try {
      // Test database connectivity
      await this.services.databaseService.healthCheck();
      serviceResults.database = true;
    } catch (error) {
      this.logger.error('Database health check failed', error);
      serviceResults.database = false;
      allHealthy = false;
    }

    // For other services, we'll just check if they're initialized
    serviceResults.nodeData = !!this.services.nodeDataService;
    serviceResults.flow = !!this.services.flowsService;
    serviceResults.execution = !!this.services.flowRunsService;
    serviceResults.executionTrace = !!this.services.nodeExecutionsService;
    serviceResults.orchestration = !!this.services.orchestrationService;
    serviceResults.graph = !!this.services.graphService;

    return {
      healthy: allHealthy,
      services: serviceResults,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Close all services and cleanup
   */
  async close(): Promise<void> {
    if (!this.services) {
      this.logger.debug('Service factory not initialized, nothing to close');
      return;
    }

    this.logger.info('Closing service factory');

    try {
      await Promise.all([
        this.services.flowsService.close(),
        this.services.flowRunsService.close(),
        this.services.nodeExecutionsService.close(),
        this.services.orchestrationService.close(),
        this.services.databaseService.close(),
        this.services.nodeDataService.close(),
        // Note: GraphService doesn't have a close method as it's stateless
      ]);

      this.services = null;
      this.initialized = false;
      this.logger.info('Service factory closed successfully');
    } catch (error) {
      this.logger.error('Error closing service factory', error);
      throw new DatabaseError('Error closing service factory', { error });
    }
  }

  /**
   * Check if the factory is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}
