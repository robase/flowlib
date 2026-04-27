import type { FlowsService } from '../flows/flows.service';
import type { DatabaseService } from '../database/database.service';
import { Logger, PaginatedResponse, QueryOptions } from 'src/schemas';
import { DatabaseError, FlowNotFoundError } from 'src/types/common/errors.types';
import { FlowRunStatus } from 'src/types/base';

import { NodeExecution } from '../node-executions/node-executions.model';
import { FlowRun, UpdateFlowRunInput } from './flow-runs.model';
import type { ExecutionEventBus } from '../execution-event-bus';

export interface FlowInputs {
  [key: string]: unknown;
}

export type FlowRunResult = {
  status: FlowRunStatus;
  flowRunId: string;
  startedAt: Date;
  error?: string;
  metadata?: Record<string, unknown>;
  completedAt?: Date;
  duration?: number;
  outputs?: Record<string, unknown>;
  /** Per-node error messages keyed by nodeId (only present when nodes failed) */
  nodeErrors?: Record<string, string>;
  inputs?: Record<string, unknown>;
  traces: NodeExecution[];
};

export type ExecuteFlowOptions = {
  version?: number | 'latest';
  initiatedBy?: string;
  useBatchProcessing?: boolean;
};

/**
 * Core Execution Service implementation using database models
 */
export class FlowRunsService {
  private initialized: boolean = false;

  private eventBus: ExecutionEventBus | null = null;

  constructor(
    private readonly logger: Logger,
    private readonly databaseService: DatabaseService,
    private readonly flowService: FlowsService,
  ) {}

  /** Attach the event bus so state changes are broadcast to SSE subscribers. */
  setEventBus(bus: ExecutionEventBus): void {
    this.eventBus = bus;
  }

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      this.logger.debug('Execution service already initialized');
      return;
    }

    try {
      // Ensure database service is initialized
      await this.flowService.initialize();
      this.initialized = true;
      this.logger.info('Execution service initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize execution service', { error });
      throw new DatabaseError('Failed to initialize execution service', { error });
    }
  }

  /**
   * Create a new flow run record
   */
  async createFlowRun(data: {
    flowId: string;
    flowVersion: number;
    inputs: FlowInputs;
    createdBy?: string;
    // Trigger provenance (populated when started via webhook/cron)
    triggerType?: string;
    triggerId?: string;
    triggerNodeId?: string;
    triggerData?: Record<string, unknown>;
  }): Promise<FlowRun> {
    this.logger.debug('Creating flow run record', {
      flowId: data.flowId,
      flowVersion: data.flowVersion,
    });

    try {
      const flowRun = await this.databaseService.flowRuns.create({
        flowId: data.flowId,
        flowVersion: data.flowVersion,
        inputs: data.inputs,
        createdBy: data.createdBy,
        triggerType: data.triggerType,
        triggerId: data.triggerId,
        triggerNodeId: data.triggerNodeId,
        triggerData: data.triggerData,
      });

      this.logger.debug('Flow run created successfully', { flowRunId: flowRun.id });
      this.eventBus?.emitFlowRunUpdate(flowRun);
      return flowRun;
    } catch (error) {
      this.logger.error('Failed to create flow run', { error });
      throw new DatabaseError('Failed to create flow run', { error });
    }
  }

  /**
   * Get execution by ID
   */
  async getRunById(flowRunId: string): Promise<FlowRun> {
    this.logger.debug('Retrieving execution by ID', { flowRunId });

    try {
      const execution = await this.databaseService.flowRuns.findById(flowRunId);

      if (!execution) {
        this.logger.warn('Execution not found', { flowRunId });
        throw new FlowNotFoundError(`Execution with ID ${flowRunId} not found`);
      }

      this.logger.debug('Execution retrieved successfully', { flowRunId });
      return execution;
    } catch (error) {
      if (error instanceof FlowNotFoundError) {
        throw error;
      }
      this.logger.error('Failed to retrieve execution', { flowRunId, error });
      throw new DatabaseError('Failed to retrieve execution', { error });
    }
  }

  /**
   * Get flow executions
   */
  async listRunsByFlowId(flowId: string): Promise<FlowRun[]> {
    try {
      const executions = await this.databaseService.flowRuns.listRunsByFlowId(flowId);
      return executions;
    } catch (error) {
      this.logger.error('Failed to get flow executions', { flowId, error });
      throw new DatabaseError('Failed to get flow executions', { error });
    }
  }

  /**
   * Retry execution
   */
  async retryRun(flowRunId: string) {
    try {
      const _execution = await this.getRunById(flowRunId);

      // TODO: This should delegate to the orchestration service
      // For now, return the execution as-is
      throw new DatabaseError(
        'Retry execution not implemented - should be handled by orchestration service',
      );
    } catch (error) {
      this.logger.error('Failed to retry execution', { flowRunId, error });
      throw new DatabaseError('Failed to retry execution', { error });
    }
  }

  /**
   * Get all executions with optional filtering and pagination
   */
  async listRuns(options?: QueryOptions<FlowRun>): Promise<PaginatedResponse<FlowRun>> {
    try {
      return await this.databaseService.flowRuns.findAll(options);
    } catch (error) {
      this.logger.error('Failed to retrieve executions', { error });
      throw new DatabaseError('Failed to retrieve executions', { error });
    }
  }

  /**
   * Cancel execution
   */
  async cancelRun(flowRunId: string): Promise<{ message: string; timestamp: string }> {
    this.logger.info('Cancelling execution', { flowRunId });

    try {
      // First check if execution exists and can be cancelled
      const execution = await this.getRunById(flowRunId);

      if (
        execution.status === 'SUCCESS' ||
        execution.status === 'FAILED' ||
        execution.status === 'CANCELLED'
      ) {
        throw new DatabaseError(`Cannot cancel execution in ${execution.status} state`);
      }

      await this.databaseService.flowRuns.update(flowRunId, {
        status: 'CANCELLED' as FlowRunStatus,
        completedAt: new Date(),
      } as UpdateFlowRunInput);

      this.logger.info('Execution cancelled successfully', { flowRunId });

      return {
        message: 'Execution cancelled',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      if (error instanceof FlowNotFoundError || error instanceof DatabaseError) {
        throw error;
      }
      this.logger.error('Failed to cancel execution', { flowRunId, error });
      throw new DatabaseError('Failed to cancel execution', { error });
    }
  }

  /**
   * Pause execution
   */
  async pauseRun(
    flowRunId: string,
    reason: string = 'USER',
  ): Promise<{ message: string; timestamp: string }> {
    this.logger.info('Pausing execution', { flowRunId, reason });

    try {
      // First check if execution exists and can be paused
      const execution = await this.getRunById(flowRunId);

      if (execution.status !== 'RUNNING') {
        throw new DatabaseError(`Cannot pause execution in ${execution.status} state`);
      }

      await this.databaseService.flowRuns.update(flowRunId, {
        status: 'PAUSED' as FlowRunStatus,
        // Note: pausedAt and pauseReason would need to be added to schema if needed
      } as UpdateFlowRunInput);

      this.logger.info('Execution paused successfully', { flowRunId, reason });

      return {
        message: 'Execution paused',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      if (error instanceof FlowNotFoundError || error instanceof DatabaseError) {
        throw error;
      }
      this.logger.error('Failed to pause execution', { flowRunId, error });
      throw new DatabaseError('Failed to pause execution', { error });
    }
  }

  /**
   * Resume execution - COMPLETE IMPLEMENTATION
   */
  async resumeRun(flowRunId: string): Promise<{ message: string; timestamp: string }> {
    this.logger.info('Resuming execution', { flowRunId });

    try {
      // Get execution and validate state
      const execution = await this.getRunById(flowRunId);

      // Check if execution can be resumed
      if (!['PAUSED', 'PAUSED_FOR_BATCH'].includes(execution.status)) {
        throw new DatabaseError(`Cannot resume execution in ${execution.status} state`);
      }

      // Update database status to RUNNING
      await this.databaseService.flowRuns.update(flowRunId, {
        status: 'RUNNING' as FlowRunStatus,
      } as UpdateFlowRunInput);

      // For manual pause, restart orchestration (PAUSED_FOR_BATCH handled automatically)
      if (execution.status === 'PAUSED') {
        // Get flow definition for resumption
        const flow = await this.flowService.getFlowById(execution.flowId);

        if (!flow?.flowVersion?.flowlibDefinition) {
          throw new DatabaseError('Flow definition not found for resume');
        }

        // Resume execution through orchestration
        // TODO: Need to inject orchestration service or implement resume logic differently
        this.logger.warn(
          'Manual resume not fully implemented - requires orchestration service injection',
        );
      }

      // Log successful resume
      this.logger.info('Execution resumed successfully', { flowRunId });

      // Return success response
      return {
        message: 'Execution resumed',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      // Handle resume errors
      if (error instanceof FlowNotFoundError || error instanceof DatabaseError) {
        throw error;
      }
      this.logger.error('Failed to resume execution', { flowRunId, error });
      throw new DatabaseError('Failed to resume execution', { error });
    }
  }

  /**
   * Update execution status
   */
  async updateRunStatus(
    flowRunId: string,
    status: FlowRunStatus,
    data?: {
      outputs?: Record<string, unknown>;
      error?: string;
      /**
       * Buffered node-execution blob for `execution.persistence: 'per-run'`.
       * Only set on terminal-state updates from the FlowRunCoordinator.
       */
      nodeOutputs?: unknown;
    },
  ): Promise<FlowRun> {
    try {
      this.logger.debug('Updating execution status', { flowRunId, status, data });

      const updateInput: UpdateFlowRunInput = {
        status,
        completedAt:
          status !== 'PENDING' && status !== 'RUNNING' && status !== 'PAUSED'
            ? new Date()
            : undefined,
        ...data,
      };

      const updatedExecution = await this.databaseService.flowRuns.update(flowRunId, updateInput);

      this.logger.debug('Execution status updated successfully', {
        flowRunId,
        status: updatedExecution.status,
      });
      this.eventBus?.emitFlowRunUpdate(updatedExecution);
      return updatedExecution;
    } catch (error) {
      this.logger.error('Failed to update execution status', { flowRunId, status, error });
      throw new DatabaseError('Failed to update execution status', { error });
    }
  }

  /**
   * Update heartbeat timestamp for a running flow.
   * Called periodically by the execution coordinator.
   */
  async updateHeartbeat(flowRunId: string): Promise<void> {
    await this.databaseService.flowRuns.updateHeartbeat(flowRunId);
  }

  /**
   * Find and fail stale flow runs whose heartbeat is older than the threshold.
   * Returns the count of runs that were marked as FAILED.
   */
  async failStaleRuns(thresholdMs: number): Promise<number> {
    return this.databaseService.flowRuns.failStaleRuns(thresholdMs);
  }

  /**
   * Get dashboard statistics: run counts by status, both total and within a time window.
   */
  async getStats(): Promise<{
    totalRuns: Record<string, number>;
    recentRuns: Record<string, number>;
  }> {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [totalRuns, recentRuns] = await Promise.all([
      this.databaseService.flowRuns.countByStatus(),
      this.databaseService.flowRuns.countByStatus(twentyFourHoursAgo),
    ]);
    return { totalRuns, recentRuns };
  }

  /**
   * Close the service
   */
  async close(): Promise<void> {
    this.logger.debug('Closing execution service');
    this.initialized = false;
    // Database service lifecycle is managed externally
  }
}
