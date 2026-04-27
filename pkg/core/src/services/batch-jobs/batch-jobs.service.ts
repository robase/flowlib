// Framework-agnostic Batch Jobs Service for Flowlib core
import type { DatabaseService } from '../database/database.service';
import { BatchJobsModel, UpdateBatchJobInput, BatchJob } from './batch-jobs.model';
import { BatchProvider, BatchStatus, BatchResult } from '../ai/base-client';
import { DatabaseError } from '../../types/common/errors.types';
import { Logger } from 'src/schemas';
import { BatchRequest } from '../node-data.service';
import { FlowOrchestrationService } from '../flow-orchestration.service';

/**
 * Batch Jobs Service implementation
 * Pure data layer for batch job state management
 */
export class BatchJobsService {
  private batchJobsModel!: BatchJobsModel;

  constructor(
    private readonly logger: Logger,
    private readonly databaseService: DatabaseService,
  ) {
    if (!databaseService) {
      throw new Error('DatabaseService is required for BatchJobsService operation');
    }
  }

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    this.logger.debug('Initializing batch jobs service');

    try {
      // Initialize the database service if not already done
      await this.databaseService.initialize();

      // Create the batch jobs model
      this.batchJobsModel = new BatchJobsModel(this.databaseService.adapter, this.logger);

      this.logger.info('Batch jobs service initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize batch jobs service', error);
      throw new DatabaseError('Failed to initialize batch jobs service', { error });
    }
  }

  /**
   * Create a new batch job
   */
  async createBatchJob(input: BatchRequest): Promise<BatchJob> {
    return this.batchJobsModel.create(input);
  }

  /**
   * Update batch job
   */
  async updateBatchJob(id: string, input: UpdateBatchJobInput): Promise<BatchJob> {
    return this.batchJobsModel.update(id, input);
  }

  /**
   * Get batch job by ID
   */
  async getBatchJob(id: string): Promise<BatchJob | null> {
    return this.batchJobsModel.findById(id);
  }

  /**
   * Get batch jobs by execution ID
   */
  async getBatchJobsByFlowRunId(executionId: string): Promise<BatchJob[]> {
    return this.batchJobsModel.findByExecutionId(executionId);
  }

  /**
   * Get batch jobs by execution and node ID
   */
  async getBatchJobsByExecutionAndNode(executionId: string, nodeId: string): Promise<BatchJob[]> {
    return this.batchJobsModel.findByExecutionAndNode(executionId, nodeId);
  }

  /**
   * Get pending batch jobs for polling
   */
  async getPendingBatchJobs(provider: BatchProvider): Promise<BatchJob[]> {
    const pendingJobs = await this.batchJobsModel.findAll({
      provider: [provider],
      status: [BatchStatus.SUBMITTED, BatchStatus.PROCESSING],
    });

    return pendingJobs;
  }

  /**
   * Delete batch job
   */
  async deleteBatchJob(id: string): Promise<void> {
    return this.batchJobsModel.delete(id);
  }

  /**
   * Mark jobs as cancelled for a specific execution
   */
  async markBatchJobAsCancelled(executionId: string): Promise<void> {
    this.logger.info('Marking batch jobs as cancelled for execution', { executionId });

    const batchJobs = await this.batchJobsModel.findByExecutionId(executionId);

    if (!batchJobs || batchJobs.length === 0) {
      this.logger.debug('No batch jobs found for execution', { executionId });
      return;
    }

    // Cancel all batch jobs for this execution
    const updatePromises = batchJobs.map((job) =>
      this.batchJobsModel.update(job.id, {
        status: BatchStatus.CANCELLED,
        error: 'Execution cancelled by user',
        completedAt: new Date().toISOString(),
      }),
    );

    await Promise.all(updatePromises);

    this.logger.info(`Cancelled ${batchJobs.length} batch job(s) for execution`, {
      executionId,
      cancelledJobIds: batchJobs.map((job) => job.id),
    });
  }

  /**
   * Mark job as completed
   */
  async markJobAsCompleted(id: string, result: BatchResult[]): Promise<void> {
    await this.batchJobsModel.update(id, {
      status: BatchStatus.COMPLETED,
      responseData: result,
      completedAt: new Date().toISOString(),
    });
  }

  /**
   * Mark job as failed
   */
  async markJobAsFailed(id: string, error: string): Promise<void> {
    await this.batchJobsModel.update(id, {
      status: BatchStatus.FAILED,
      error,
      completedAt: new Date().toISOString(),
    });
  }

  /**
   * Resume flow execution after batch completion
   */
  private async resumeFlowFromBatchCompletion(
    executionId: string,
    completedBatchNodeId: string,
    batchResult?: BatchResult[],
    batchError?: string,
    flowOrchestrationService?: FlowOrchestrationService,
  ): Promise<void> {
    // Log batch completion
    this.logger.info('Resuming flow from batch completion', {
      executionId,
      completedBatchNodeId,
      hasResult: !!batchResult,
      hasError: !!batchError,
    });

    if (!flowOrchestrationService) {
      this.logger.error('FlowOrchestrationService not provided for batch resume');
      return;
    }

    // Trigger flow orchestration resume
    await flowOrchestrationService.resumeFromBatchCompletion(
      executionId,
      completedBatchNodeId,
      batchResult,
      batchError,
    );
  }

  /**
   * Handle batch job timeouts (24+ hours)
   */
  async handleBatchTimeouts(): Promise<void> {
    // Define timeout threshold (25 hours to account for delays)
    const timeoutThreshold = new Date(Date.now() - 25 * 60 * 60 * 1000);

    // Find jobs that have timed out
    const timedOutJobs = await this.findTimedOutJobs(timeoutThreshold);

    // Process each timed out job
    for (const job of timedOutJobs) {
      // Log timeout
      this.logger.warn('Batch job timed out', {
        jobId: job.id,
        executionId: job.flowRunId,
        nodeId: job.nodeId,
        submittedAt: job.createdAt,
      });

      // Update job status to failed
      await this.updateBatchJob(job.id, {
        status: BatchStatus.FAILED,
        error: 'Batch processing timed out after 25 hours',
        completedAt: new Date().toISOString(),
      });
    }
  }

  /**
   * Find batch jobs that have timed out
   */
  private async findTimedOutJobs(timeoutThreshold: Date): Promise<BatchJob[]> {
    return this.batchJobsModel
      .findAll({
        status: [BatchStatus.SUBMITTED, BatchStatus.PROCESSING],
      })
      .then((jobs) =>
        jobs.filter((job) => {
          const submittedAt =
            typeof job.submittedAt === 'string' ? new Date(job.submittedAt) : job.submittedAt;
          return submittedAt < timeoutThreshold;
        }),
      );
  }

  /**
   * Close the service
   */
  async close(): Promise<void> {
    this.logger.info('Closing batch jobs service');
    this.logger.info('Batch jobs service closed successfully');
  }

  /**
   * Check if the service is initialized
   */
  isInitialized(): boolean {
    return !!this.batchJobsModel;
  }
}
