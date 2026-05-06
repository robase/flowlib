import type { FlowRunsService } from './flow-runs/flow-runs.service';
import type { NodeExecutionService } from './node-executions/node-execution.service';
import type { FlowsService } from './flows/flows.service';
import type { CredentialsService } from './credentials/credentials.service';
import type { JsExpressionService } from './templating/js-expression.service';
import type { TemplateService } from './templating/template.service';
import type { BatchJobsService } from './batch-jobs/batch-jobs.service';
import { FlowRunResult } from './flow-runs/flow-runs.service';
import { Logger } from 'src/schemas';
import { DatabaseError, ValidationError } from 'src/types/common/errors.types';
import { FlowRunStatus } from 'src/types/base';
import { FlowRun } from './flow-runs/flow-runs.model';
import { Flow } from './flows/flows.model';
import { FlowlibDefinition } from './flow-versions/schemas-fresh';
import { NodeDataService } from './node-data.service';
import { GraphService } from './graph.service';
import type { FlowVersion } from '@flowlib/db';
import { BaseAIClient, BatchStatus } from './ai/base-client';
import { NodeExecutionCoordinator } from './flow-orchestration/node-execution-coordinator';
import { FlowRunCoordinator } from './flow-orchestration/flow-run-coordinator';
import type { PluginHookRunner } from 'src/types/plugin.types';
import type { JobRunnerAdapter } from 'src/types/services';
import { JOB_TYPES, type BatchJobResumeJobPayload, type FlowRunJobPayload } from './job-runner';
import { InProcessJobRunner } from './job-runner/in-process-job-runner';

/**
 * Core Flow Orchestration Service implementation
 * Manages the complete flow execution lifecycle using service layer abstractions
 */
export class FlowOrchestrationService {
  private initialized: boolean = false;
  private batchPollingInterval?: NodeJS.Timeout;
  private staleRunCheckInterval?: NodeJS.Timeout;
  private isPollingActive: boolean = false;
  private readonly nodeExecutionCoordinator: NodeExecutionCoordinator;
  private readonly flowRunCoordinator: FlowRunCoordinator;
  private readonly flowTimeoutMs: number;
  private readonly staleRunCheckIntervalMs: number;
  /**
   * When true, the in-process `setInterval` lifecycle loops
   * (`startStaleRunDetector`, `startFlowResumptionPolling`) become no-ops;
   * the host is expected to drive single-tick `detectStaleRuns()` /
   * `pollBatchJobs()` calls from an external scheduler. PR 5/14.
   */
  private readonly externalSchedulerEnabled: boolean;

  constructor(
    private readonly logger: Logger,
    private readonly flowRunsService: FlowRunsService,
    private readonly nodeExecutionService: NodeExecutionService,
    private readonly flowsService: FlowsService,
    private readonly nodeDataService: NodeDataService,
    private readonly graphService: GraphService,
    private readonly batchJobsService: BatchJobsService,
    private readonly credentialsService?: CredentialsService, // Optional for now to avoid breaking changes
    private readonly baseAIClient?: BaseAIClient,
    private readonly nodeExecutionServiceForTools?: NodeExecutionService,
    executionConfig?: {
      heartbeatIntervalMs?: number;
      flowTimeoutMs?: number;
      staleRunCheckIntervalMs?: number;
      /**
       * When true, in-process maintenance timers are skipped and the host
       * is responsible for invoking `flowlib.maintenance.detectStaleRuns()`
       * + `pollBatchJobs()` from an external scheduler (Cloudflare Cron
       * Triggers, Vercel Cron, etc.). PR 5/14.
       */
      externalScheduler?: boolean;
    },
    private readonly pluginHookRunner?: PluginHookRunner,
    private readonly jsExpressionService?: JsExpressionService,
    private readonly templateService?: TemplateService,
    /**
     * Pluggable background job runner (PR 13/14). When omitted, the
     * legacy fire-and-forget `.then()` path is used. When provided,
     * the orchestration service routes:
     *
     *  - async flow execution → `enqueue('flow-run', { flowRunId, ... })`
     *  - batch resumption    → `enqueue('batch-job-resume', { ... })`
     *
     * If the runner is the default `InProcessJobRunner`, this service
     * also registers handlers on it so the in-memory queue can drive
     * the work; external runners (Cloudflare Queues, SQS) are expected
     * to register their own consumer-side handlers separately.
     */
    private readonly jobRunner?: JobRunnerAdapter,
  ) {
    if (!baseAIClient) {
      throw new Error('BaseAIClient is required for FlowOrchestrationService');
    }

    this.flowTimeoutMs = executionConfig?.flowTimeoutMs ?? 600_000; // 10 min default
    this.staleRunCheckIntervalMs = executionConfig?.staleRunCheckIntervalMs ?? 60_000; // 1 min default
    this.externalSchedulerEnabled = executionConfig?.externalScheduler ?? false;

    this.nodeExecutionCoordinator = new NodeExecutionCoordinator({
      logger,
      nodeExecutionService,
      nodeDataService,
      graphService,
      credentialsService,
      nodeExecutionServiceForTools: nodeExecutionServiceForTools ?? nodeExecutionService,
      templateService,
      jsExpressionService,
      baseAIClient,
      pluginHookRunner,
    });

    this.flowRunCoordinator = new FlowRunCoordinator({
      logger,
      flowRunsService,
      nodeExecutionCoordinator: this.nodeExecutionCoordinator,
      graphService,
      nodeExecutionService,
      batchJobsService,
      flowsService,
      heartbeatIntervalMs: executionConfig?.heartbeatIntervalMs ?? 30_000,
      pluginHookRunner,
    });
  }

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      this.logger.debug('Flow orchestration service already initialized');
      return;
    }

    this.logger.debug('Initializing flow orchestration service');

    try {
      // Ensure dependent services are initialized
      await this.flowsService.initialize();
      await this.flowRunsService.initialize();
      await this.nodeExecutionService.initialize();
      await this.batchJobsService.initialize();

      // Startup recovery: fail any flow runs that were RUNNING/PENDING when
      // the server previously stopped.  Their heartbeats will be stale.
      await this.recoverStaleRuns();

      // Register in-process handlers for the canonical job types if the
      // host is using the default in-process runner. External adapters
      // (Cloudflare Queues, SQS) configure their consumer side
      // separately and don't expose a `registerHandler` method.
      this.registerInProcessJobHandlers();

      // Start flow resumption polling for completed batches
      await this.startMaintenancePolling();

      this.initialized = true;
      this.logger.info('Flow orchestration service initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize flow orchestration service', { error });
      throw new DatabaseError('Failed to initialize flow orchestration service', { error });
    }
  }

  // ─── Stale run detection ──────────────────────────────────────────────

  /**
   * Startup recovery: mark all RUNNING/PENDING runs with stale heartbeats as FAILED.
   * This handles flows that were mid-execution when the server last stopped.
   */
  private async recoverStaleRuns(): Promise<void> {
    try {
      const failedCount = await this.flowRunsService.failStaleRuns(this.flowTimeoutMs);
      if (failedCount > 0) {
        this.logger.warn(`Startup recovery: marked ${failedCount} stale flow run(s) as FAILED`);
      }
    } catch (error) {
      this.logger.error('Failed to recover stale runs on startup', { error });
      // Non-fatal — don't block initialization
    }
  }

  /**
   * Start a periodic check for stale flow runs.
   * Runs at the configured `staleRunCheckIntervalMs`.
   *
   * No-op when `executionConfig.externalScheduler === true` (PR 5/14):
   * the host drives stale-run detection via
   * `flowlib.maintenance.detectStaleRuns()` from an external cron tick.
   */
  private startStaleRunDetector(): void {
    if (this.staleRunCheckInterval) {
      return;
    }

    if (this.externalSchedulerEnabled) {
      this.logger.info(
        'Skipping in-process stale run detector — externalScheduler enabled (PR 5/14)',
      );
      return;
    }

    this.logger.info('Starting stale run detector', {
      flowTimeoutMs: this.flowTimeoutMs,
      checkIntervalMs: this.staleRunCheckIntervalMs,
    });

    this.staleRunCheckInterval = setInterval(async () => {
      try {
        const failedCount = await this.flowRunsService.failStaleRuns(this.flowTimeoutMs);
        if (failedCount > 0) {
          this.logger.warn(`Stale run detector: marked ${failedCount} run(s) as FAILED`);
        }
      } catch (error) {
        this.logger.error('Error in stale run detector', { error });
      }
    }, this.staleRunCheckIntervalMs);
  }

  /**
   * Stop the periodic stale run detector.
   */
  private stopStaleRunDetector(): void {
    if (this.staleRunCheckInterval) {
      clearInterval(this.staleRunCheckInterval);
      this.staleRunCheckInterval = undefined;
    }
  }

  /**
   * Execute a flow by ID with inputs and options
   */
  async executeFlow(
    flowId: string,
    inputs: Record<string, unknown> = {},
    options?: { version?: number | 'latest'; initiatedBy?: string; useBatchProcessing?: boolean },
  ): Promise<FlowRunResult> {
    this.logger.info('Starting flow execution', { flowId, inputs });

    try {
      // Get the flow using the injected FlowsService
      this.logger.debug('Getting flow', { flowId, options });

      const flow = await this.flowsService.getFlowById(flowId, {
        flowVersion: { version: options?.version || 'latest' },
      });
      if (!flow) {
        throw new ValidationError(`No flow found with ID: ${flowId}`);
      }

      this.logger.debug('Flow version found', {
        flowId,
        version: flow.flowVersion,
      });

      // Execute the flow - flow run will be created in initiateFlowRun
      const flowResult = await this.initiateFlowRun(
        flow,
        inputs,
        options?.initiatedBy,
        options?.useBatchProcessing,
      );

      return flowResult;
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error;
      }
      this.logger.error('Failed to execute flow', {
        flowId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw new DatabaseError('Failed to execute flow', { error });
    }
  }

  /**
   * Start a flow execution asynchronously - returns immediately with flow run ID.
   * The flow executes in the background.
   */
  async executeFlowAsync(
    flowId: string,
    inputs: Record<string, unknown> = {},
    options?: {
      version?: number | 'latest';
      initiatedBy?: string;
      useBatchProcessing?: boolean;
      // Trigger provenance (populated when started via webhook/cron)
      triggerType?: string;
      triggerId?: string;
      triggerNodeId?: string;
      triggerData?: Record<string, unknown>;
      /**
       * When true, create the PENDING run row but DO NOT enqueue to the
       * `JobRunnerAdapter`. The caller is responsible for dispatching
       * execution itself (typically by calling `runs.executePending(id)`
       * inside a `waitUntil` / setImmediate). Useful for hosts that want
       * latency-sensitive paths (e.g. UI-initiated manual runs) to skip
       * the external queue's delivery floor while still using the same
       * canonical run-creation logic.
       */
      skipDispatch?: boolean;
    },
  ): Promise<FlowRunResult> {
    this.logger.info('Starting async flow execution', { flowId, inputs });

    try {
      // Get the flow using the injected FlowsService
      const flow = await this.flowsService.getFlowById(flowId, {
        flowVersion: { version: options?.version || 'latest' },
      });
      if (!flow) {
        throw new ValidationError(`No flow found with ID: ${flowId}`);
      }

      // Validate flow definition exists
      if (!flow.flowVersion.flowlibDefinition) {
        throw new ValidationError('Flow version does not contain a valid flow definition');
      }

      // Create execution record immediately
      const execution = await this.flowRunsService.createFlowRun({
        flowId: flow.id,
        flowVersion: flow.flowVersion.version,
        inputs,
        createdBy: options?.initiatedBy,
        triggerType: options?.triggerType,
        triggerId: options?.triggerId,
        triggerNodeId: options?.triggerNodeId,
        triggerData: options?.triggerData,
      });

      this.logger.info('Created execution record for async execution', {
        flowRunId: execution.id,
        flowId: flow.id,
      });

      // Start execution in background (fire and forget)
      const typedDefinition = flow.flowVersion.flowlibDefinition as FlowlibDefinition;

      // Inject trigger context into flowInputs if present (see D1 in FLOW-TRIGGERS-PLAN.md)
      // Trigger actions read from context.flowInputs.__triggerData at runtime.
      const augmentedInputs: Record<string, unknown> = {
        ...execution.inputs,
        ...(execution.triggerData
          ? {
              __triggerData: execution.triggerData,
              __triggerNodeId: execution.triggerNodeId,
            }
          : {}),
      };

      // Route the actual flow-running work through the JobRunnerAdapter
      // when one is wired (PR 13/14). The default in-process runner
      // schedules the registered handler on a microtask, preserving
      // today's fire-and-forget semantics. External adapters
      // (Cloudflare Queues, SQS) ship the payload to a consumer Worker
      // — `executeFlowAsync` still returns the freshly-created run id
      // synchronously so callers (HTTP handlers, trigger services) can
      // respond immediately.
      if (this.jobRunner && !options?.skipDispatch) {
        const payload: FlowRunJobPayload = {
          flowRunId: execution.id,
          flowId: flow.id,
          useBatchProcessing: options?.useBatchProcessing,
        };
        await this.jobRunner.enqueue(JOB_TYPES.FLOW_RUN, payload, {
          // Per-flow-run idempotency: enqueueing the same `flowRunId`
          // twice (e.g. retried request) MUST run the flow once.
          idempotencyKey: execution.id,
        });
      } else if (this.jobRunner && options?.skipDispatch) {
        // Caller is dispatching itself — most commonly via `waitUntil` in
        // the same isolate. Just create the row; do not enqueue.
        this.logger.debug('skipDispatch: PENDING run created without enqueue', {
          flowRunId: execution.id,
          flowId: flow.id,
        });
      } else {
        this.flowRunCoordinator
          .executeFlowDefinition(
            execution,
            typedDefinition,
            augmentedInputs,
            options?.useBatchProcessing,
          )
          .then((result) => {
            this.logger.info('Async flow execution completed', {
              flowRunId: execution.id,
              status: result.status,
            });
          })
          .catch(async (error) => {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error('Async flow execution failed', {
              flowRunId: execution.id,
              error: errorMessage,
            });
            // Mark as failed
            await this.flowRunsService.updateRunStatus(execution.id, FlowRunStatus.FAILED, {
              error: errorMessage,
            });
          });
      }

      // Return immediately with PENDING status
      return {
        flowRunId: execution.id,
        status: FlowRunStatus.PENDING,
        inputs: execution.inputs,
        outputs: {},
        startedAt:
          typeof execution.startedAt === 'string'
            ? new Date(execution.startedAt)
            : execution.startedAt,
        traces: [],
      };
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error;
      }
      this.logger.error('Failed to start async flow execution', {
        flowId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError('Failed to start flow execution', { error });
    }
  }

  /**
   * Execute a complete flow (synchronous - waits for completion)
   */
  async initiateFlowRun(
    flow: Flow & {
      flowVersion: FlowVersion;
    },
    inputs: Record<string, unknown> = {},
    initiatedBy?: string,
    useBatchProcessing?: boolean,
  ): Promise<FlowRunResult> {
    this.logger.info('Starting flow orchestration', {
      flowId: flow.id,
      flowVersion: flow.flowVersion.version,
    });

    // Validate flow and version
    if (!flow.flowVersion.flowlibDefinition) {
      const error = 'Flow version does not contain a valid flow definition';
      this.logger.error(error, {
        flowId: flow.id,
        flowVersion: flow.flowVersion.version,
      });
      throw new ValidationError(error);
    }

    let execution: FlowRun | undefined;
    let finalExecutionResult: FlowRunResult;

    try {
      // Create execution record using FlowRunsService
      execution = await this.flowRunsService.createFlowRun({
        flowId: flow.id,
        flowVersion: flow.flowVersion.version,
        inputs,
        createdBy: initiatedBy,
      });

      this.logger.info('Created execution record', {
        flowRunId: execution.id,
        flowId: flow.id,
      });

      // Execute the flow definition - cast runtime type to inferred type
      const typedDefinition = flow.flowVersion.flowlibDefinition as FlowlibDefinition;
      finalExecutionResult = await this.flowRunCoordinator.executeFlowDefinition(
        execution,
        typedDefinition,
        execution.inputs,
        useBatchProcessing,
      );

      this.logger.info('Flow execution completed', {
        flowRunId: execution.id,
        status: finalExecutionResult.status,
      });

      return finalExecutionResult;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('Flow execution failed', {
        flowRunId: execution?.id,
        flowId: flow.id,
        error: errorMessage,
      });

      // If we have an execution record, mark it as failed
      if (execution) {
        await this.flowRunsService.updateRunStatus(execution.id, FlowRunStatus.FAILED, {
          error: errorMessage,
        });

        // Get traces for the failed execution
        const traces = await this.nodeExecutionService.listNodeExecutionsByFlowRunId(execution.id);

        // Build failed result with available data
        finalExecutionResult = {
          flowRunId: execution.id,
          status: FlowRunStatus.FAILED,
          inputs: execution.inputs,
          outputs: {},
          error: errorMessage,
          startedAt:
            typeof execution.startedAt === 'string'
              ? new Date(execution.startedAt)
              : execution.startedAt,
          completedAt: new Date(),
          duration: execution.duration || 0,
          traces,
        };

        return finalExecutionResult;
      }

      // Re-throw error if we couldn't create execution record
      throw new DatabaseError('Failed to orchestrate flow execution', { error, flowId: flow.id });
    }
  }

  /**
   * Execute a flow definition
   */

  /**
   * Execute a flow up to a specific target node.
   * Only executes the upstream nodes required to produce output for the target node.
   */
  async executeFlowToNode(
    flowId: string,
    targetNodeId: string,
    inputs: Record<string, unknown> = {},
    options?: { version?: number | 'latest'; initiatedBy?: string; useBatchProcessing?: boolean },
  ): Promise<FlowRunResult> {
    this.logger.info('Starting partial flow execution to node', { flowId, targetNodeId, inputs });

    try {
      // Get the flow using the injected FlowsService
      const flow = await this.flowsService.getFlowById(flowId, {
        flowVersion: { version: options?.version || 'latest' },
      });
      if (!flow) {
        throw new ValidationError(`No flow found with ID: ${flowId}`);
      }

      // Validate flow and version
      if (!flow.flowVersion.flowlibDefinition) {
        throw new ValidationError('Flow version does not contain a valid flow definition');
      }

      const definition = flow.flowVersion.flowlibDefinition as FlowlibDefinition;

      // Verify target node exists in the definition
      const targetNode = definition.nodes.find((n) => n.id === targetNodeId);
      if (!targetNode) {
        throw new ValidationError(`Target node not found in flow: ${targetNodeId}`);
      }

      // Create execution record
      const execution = await this.flowRunsService.createFlowRun({
        flowId: flow.id,
        flowVersion: flow.flowVersion.version,
        inputs,
        createdBy: options?.initiatedBy,
      });

      this.logger.info('Created execution record for partial flow', {
        flowRunId: execution.id,
        flowId: flow.id,
        targetNodeId,
      });

      // Execute the flow to the target node
      const result = await this.flowRunCoordinator.executeFlowToNode(
        execution,
        definition,
        targetNodeId,
        execution.inputs,
        options?.useBatchProcessing,
      );

      this.logger.info('Partial flow execution completed', {
        flowRunId: execution.id,
        targetNodeId,
        status: result.status,
      });

      return result;
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error;
      }
      this.logger.error('Failed to execute partial flow', {
        flowId,
        targetNodeId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError('Failed to execute partial flow', { error });
    }
  }

  /**
   * Execute a flow run that already exists in PENDING state.
   *
   * Loads the run by id, re-loads the flow at the run's pinned version,
   * and runs the orchestration coordinator against it. Used by external
   * job runner consumers (Cloudflare Queues, SQS) that pick up FLOW_RUN
   * jobs produced by `executeFlowAsync()`. The in-process job handler
   * delegates here too so there's a single execution path.
   *
   * Failures are caught and persisted as FAILED on the run; this method
   * does NOT throw to the caller (consumers shouldn't retry on flow-level
   * errors — only on infrastructure errors).
   */
  async executePendingRun(
    flowRunId: string,
    options?: { useBatchProcessing?: boolean },
  ): Promise<void> {
    let run: FlowRun;
    try {
      run = await this.flowRunsService.getRunById(flowRunId);
    } catch (err) {
      this.logger.error('executePendingRun: missing flow run', {
        flowRunId,
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    const flow = await this.flowsService.getFlowById(run.flowId, {
      flowVersion: { version: run.flowVersion },
    });
    if (!flow?.flowVersion?.flowlibDefinition) {
      await this.flowRunsService.updateRunStatus(flowRunId, FlowRunStatus.FAILED, {
        error: 'Flow definition missing at execution time',
      });
      return;
    }
    const augmentedInputs: Record<string, unknown> = {
      ...run.inputs,
      ...(run.triggerData
        ? {
            __triggerData: run.triggerData,
            __triggerNodeId: run.triggerNodeId,
          }
        : {}),
    };

    // Manual (UI-initiated) runs need per-node persistence so the Logs panel
    // can read live state via `/flow-runs/:id/node-executions` while the run
    // is in progress — that endpoint reads from this isolate's in-memory
    // buffer, which is empty in cross-isolate setups (queue consumer writes
    // to a different isolate's buffer than the API handler reads from).
    // Cron / webhook / batch runs aren't watched live, so they keep the
    // default `'per-run'` mode — one big flush at terminal state, far fewer
    // DB writes during the run. The decision is per-run, not per-config.
    if (run.triggerType === 'manual') {
      this.nodeExecutionService.forceFlowRunPerNode(flowRunId);
    }

    try {
      await this.flowRunCoordinator.executeFlowDefinition(
        run,
        flow.flowVersion.flowlibDefinition as FlowlibDefinition,
        augmentedInputs,
        options?.useBatchProcessing,
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('Async flow execution failed (executePendingRun)', {
        flowRunId,
        error: errorMessage,
      });
      await this.flowRunsService.updateRunStatus(flowRunId, FlowRunStatus.FAILED, {
        error: errorMessage,
      });
    }
  }

  /**
   * Resume flow execution after batch completion
   */
  async resumeFromBatchCompletion(
    flowRunId: string,
    completedBatchNodeId: string,
    batchResult?: unknown,
    batchError?: string,
  ): Promise<FlowRunResult> {
    return this.flowRunCoordinator.resumeFromBatchCompletion(
      flowRunId,
      completedBatchNodeId,
      batchResult,
      batchError,
    );
  }

  /**
   * Continue flow execution after batch completion
   */
  async continueFlowRunFromBatch(
    flowRunId: string,
    definition: FlowlibDefinition,
    flowInputs: Record<string, unknown> = {},
  ): Promise<FlowRunResult> {
    return this.flowRunCoordinator.continueFlowRunFromBatch(flowRunId, definition, flowInputs);
  }

  /**
   * Get execution with traces
   */
  async getExecutionWithTraces(flowRunId: string): Promise<FlowRunResult | null> {
    try {
      const execution = await this.flowRunsService.getRunById(flowRunId);

      const traces = await this.nodeExecutionService.listNodeExecutionsByFlowRunId(flowRunId);

      return {
        flowRunId: execution.id,
        status: execution.status,
        inputs: execution.inputs,
        outputs: execution.outputs || {},
        error: execution.error,
        startedAt:
          typeof execution.startedAt === 'string'
            ? new Date(execution.startedAt)
            : execution.startedAt,
        completedAt: execution.completedAt
          ? typeof execution.completedAt === 'string'
            ? new Date(execution.completedAt)
            : execution.completedAt
          : undefined,
        duration: execution.duration,
        traces,
      };
    } catch (error) {
      this.logger.error('Failed to get execution with traces', { flowRunId, error });
      throw new DatabaseError('Failed to get execution with traces', { error });
    }
  }

  /**
   * Cancel a running execution
   */
  async cancelExecution(flowRunId: string): Promise<void> {
    try {
      const execution = await this.flowRunsService.getRunById(flowRunId);

      if (execution.status !== 'RUNNING' && execution.status !== 'PENDING') {
        throw new DatabaseError(`Cannot cancel execution in ${execution.status} state`);
      }

      // Fire the per-run AbortController so in-flight SDK calls on this
      // process are aborted synchronously. This is best-effort — in a
      // multi-process deploy, the run may be executing on another server,
      // in which case the DB flag + stale-run reaper handle cleanup.
      const aborted = this.flowRunCoordinator.abortRun(flowRunId, 'cancelled by user');

      await this.flowRunsService.updateRunStatus(flowRunId, 'CANCELLED' as FlowRunStatus);

      this.logger.info('Execution cancelled', { flowRunId, abortedInProcess: aborted });
    } catch (error) {
      this.logger.error('Failed to cancel execution', { flowRunId, error });
      throw error;
    }
  }

  /**
   * Start polling for completed batch jobs to resume flows.
   *
   * No-op when `executionConfig.externalScheduler === true` (PR 5/14):
   * the host drives batch resumption via
   * `flowlib.maintenance.pollBatchJobs()` from an external cron tick.
   */
  async startFlowResumptionPolling(intervalMs: number = 30000): Promise<void> {
    if (this.isPollingActive) {
      this.logger.debug('Flow resumption polling is already active');
      return;
    }

    if (this.externalSchedulerEnabled) {
      this.logger.info(
        'Skipping in-process batch resumption poller — externalScheduler enabled (PR 5/14)',
      );
      return;
    }

    this.logger.info('Starting flow resumption polling', { intervalMs });
    this.isPollingActive = true;

    const pollOnce = async () => {
      if (!this.isPollingActive) {
        return;
      }

      try {
        await this.pollForCompletedBatches();
      } catch (error) {
        this.logger.error('Error during flow resumption polling', { error });
      }
    };

    // Run initial poll
    await pollOnce();

    // Set up recurring polling
    this.batchPollingInterval = setInterval(pollOnce, intervalMs);
  }

  /**
   * Start all recurring maintenance loops owned by flow orchestration.
   */
  async startMaintenancePolling(): Promise<void> {
    await this.startFlowResumptionPolling();
    this.startStaleRunDetector();
  }

  /**
   * Stop polling for completed batch jobs
   */
  async stopFlowResumptionPolling(): Promise<void> {
    if (!this.isPollingActive) {
      this.logger.debug('Flow resumption polling is not active');
      return;
    }

    this.logger.info('Stopping flow resumption polling');
    this.isPollingActive = false;

    if (this.batchPollingInterval) {
      clearInterval(this.batchPollingInterval);
      this.batchPollingInterval = undefined;
    }
  }

  /**
   * Stop all recurring maintenance loops owned by flow orchestration.
   */
  async stopMaintenancePolling(): Promise<void> {
    await this.stopFlowResumptionPolling();
    this.stopStaleRunDetector();
  }

  /**
   * Run a single pass that resumes flows paused for batch processing.
   */
  async runBatchResumptionSweep(): Promise<{
    readyCount: number;
    resumedCount: number;
    failedCount: number;
  }> {
    const flowsToResume = await this.findFlowsReadyForResumption();

    if (flowsToResume.length === 0) {
      this.logger.debug('No flows found ready for resumption');
      return {
        readyCount: 0,
        resumedCount: 0,
        failedCount: 0,
      };
    }

    this.logger.info('Found flows ready for resumption', {
      count: flowsToResume.length,
      flowRunIds: flowsToResume.map((f) => f.flowRunId),
    });

    let resumedCount = 0;
    let failedCount = 0;

    for (const flowResumption of flowsToResume) {
      try {
        // Route through the pluggable runner (PR 13/14) only when an
        // EXTERNAL adapter is plugged in (e.g. Cloudflare Queues, SQS).
        // External adapters don't expose `processNextBatch` — they ship
        // jobs to a consumer Worker. For the default in-process runner,
        // we call `resumeFromBatchCompletion` directly so callers see
        // the resumed status in the same await — the enqueue→microtask→
        // handler indirection adds only race-conditions for in-process.
        const externalRunner =
          this.jobRunner && typeof this.jobRunner.processNextBatch !== 'function';

        if (externalRunner) {
          // `findFlowsReadyForResumption` types `batchResult` as
          // `unknown` (JSON column from the DB); cast at the boundary.
          const payload: BatchJobResumeJobPayload = {
            flowRunId: flowResumption.flowRunId,
            nodeId: flowResumption.nodeId,
            batchResult: flowResumption.batchResult as BatchJobResumeJobPayload['batchResult'],
            batchError: flowResumption.batchError,
          };
          await this.jobRunner?.enqueue(JOB_TYPES.BATCH_JOB_RESUME, payload, {
            idempotencyKey: `${flowResumption.flowRunId}:${flowResumption.nodeId}`,
          });
        } else {
          await this.resumeFromBatchCompletion(
            flowResumption.flowRunId,
            flowResumption.nodeId,
            flowResumption.batchResult,
            flowResumption.batchError,
          );
        }

        resumedCount += 1;
        this.logger.info('Flow resumption enqueued', {
          flowRunId: flowResumption.flowRunId,
          nodeId: flowResumption.nodeId,
        });
      } catch (error) {
        failedCount += 1;
        this.logger.error('Failed to resume flow', {
          flowRunId: flowResumption.flowRunId,
          nodeId: flowResumption.nodeId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      readyCount: flowsToResume.length,
      resumedCount,
      failedCount,
    };
  }

  /**
   * Run a single stale-run failure sweep.
   */
  async runStaleRunSweep(): Promise<{ failedCount: number }> {
    const failedCount = await this.flowRunsService.failStaleRuns(this.flowTimeoutMs);
    if (failedCount > 0) {
      this.logger.warn(`Stale run sweep: marked ${failedCount} run(s) as FAILED`);
    }

    return { failedCount };
  }

  // ─── PR 5/14: external-scheduler entry points ─────────────────────────
  // The stale-run detector and batch-resumption poller above are also
  // exposed here as `{ count }` methods for hosts that drive them from
  // an external scheduler (Cloudflare Cron Triggers, Vercel Cron). They
  // perform exactly one tick — the long-lived `setInterval` wrappers
  // (`startStaleRunDetector`, `startFlowResumptionPolling`) become
  // no-ops when the host opts into external scheduling via the
  // `BatchPollerAdapter` override (PR 2/14).

  /**
   * Run a single stale-run detection tick. Equivalent to one iteration of
   * the in-process `staleRunCheckInterval` loop. Safe to invoke from an
   * external cron entry point on workers/edge runtimes.
   */
  async detectStaleRuns(): Promise<{ count: number }> {
    const { failedCount } = await this.runStaleRunSweep();
    return { count: failedCount };
  }

  /**
   * Run a single batch-resumption tick. Equivalent to one iteration of the
   * in-process `batchPollingInterval` loop, but reports only how many
   * paused flows were successfully resumed (failed/total are still
   * available via `runBatchResumptionSweep()`).
   */
  async pollBatchJobs(): Promise<{ count: number }> {
    const { resumedCount } = await this.runBatchResumptionSweep();
    return { count: resumedCount };
  }

  /**
   * Poll for completed batch jobs and resume corresponding flows
   */
  private async pollForCompletedBatches(): Promise<void> {
    try {
      await this.runBatchResumptionSweep();
    } catch (error) {
      this.logger.error('Error polling for completed batches', { error });
    }
  }

  /**
   * Find flows that are paused for batch processing but have completed batch jobs
   */
  private async findFlowsReadyForResumption(): Promise<
    Array<{
      flowRunId: string;
      nodeId: string;
      batchResult?: unknown;
      batchError?: string;
    }>
  > {
    try {
      // Get all flows paused for batch processing
      const pausedFlowsResult = await this.flowRunsService.listRuns({
        filter: {
          status: [FlowRunStatus.PAUSED_FOR_BATCH],
        },
      });

      const flowsToResume: Array<{
        flowRunId: string;
        nodeId: string;
        batchResult?: unknown;
        batchError?: string;
      }> = [];

      // Check each paused flow for completed batch jobs
      for (const flowRun of pausedFlowsResult.data) {
        const batchJobs = await this.batchJobsService.getBatchJobsByFlowRunId(flowRun.id);

        // Find completed batch jobs for this execution (completed, failed, or cancelled)
        const completedBatchJobs = batchJobs.filter(
          (job) =>
            job.status === BatchStatus.COMPLETED ||
            job.status === BatchStatus.FAILED ||
            job.status === BatchStatus.CANCELLED,
        );

        // If there are completed batch jobs, this flow is ready for resumption
        for (const batchJob of completedBatchJobs) {
          flowsToResume.push({
            flowRunId: flowRun.id,
            nodeId: batchJob.nodeId,
            batchResult:
              batchJob.status === BatchStatus.COMPLETED ? batchJob.responseData : undefined,
            batchError:
              batchJob.status === BatchStatus.FAILED || batchJob.status === BatchStatus.CANCELLED
                ? batchJob.error
                : undefined,
          });
        }
      }

      return flowsToResume;
    } catch (error) {
      this.logger.error('Failed to find flows ready for resumption', { error });
      return [];
    }
  }

  /**
   * Register handlers on the in-process job runner for the canonical
   * job types this service produces. Called once from `initialize()`.
   *
   * No-op if no `jobRunner` was injected, or if the injected runner is
   * an external adapter (i.e. doesn't expose `registerHandler`). Hosts
   * using external runners (Cloudflare Queues, SQS) are expected to
   * register their own consumer-side handlers in their Queue/SQS
   * consumer Worker.
   */
  private registerInProcessJobHandlers(): void {
    if (!this.jobRunner) {
      return;
    }
    if (!(this.jobRunner instanceof InProcessJobRunner)) {
      this.logger.debug(
        'JobRunnerAdapter is not InProcessJobRunner — skipping in-process handler registration; ' +
          'host must wire consumer-side handlers for FLOW_RUN and BATCH_JOB_RESUME externally',
      );
      return;
    }

    this.jobRunner.registerHandler<FlowRunJobPayload>(JOB_TYPES.FLOW_RUN, async (payload) => {
      await this.executePendingRun(payload.flowRunId, {
        useBatchProcessing: payload.useBatchProcessing,
      });
    });

    this.jobRunner.registerHandler<BatchJobResumeJobPayload>(
      JOB_TYPES.BATCH_JOB_RESUME,
      async (payload) => {
        await this.resumeFromBatchCompletion(
          payload.flowRunId,
          payload.nodeId,
          payload.batchResult,
          payload.batchError,
        );
      },
    );
  }

  /**
   * Close the service
   */
  async close(): Promise<void> {
    this.logger.debug('Closing flow orchestration service');

    // Stop all heartbeat timers for in-progress flows
    this.flowRunCoordinator.stopAllHeartbeats();

    // Stop batch polling if it's running
    await this.stopMaintenancePolling();

    this.initialized = false;
    // Service lifecycle is managed externally
  }
}
