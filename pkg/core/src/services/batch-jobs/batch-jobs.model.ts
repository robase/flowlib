// Batch Jobs Model for Flowlib core — adapter-based implementation
import type { FlowlibAdapter, WhereClause } from '../../database/adapter';
import { Logger } from 'src/schemas';
import { DatabaseError } from 'src/types/common/errors.types';
import { BatchProvider, BatchStatus, BatchResult } from '../ai/base-client';
import { BatchRequest } from '../node-data.service';

/**
 * Batch Job entity
 */
export interface BatchJob {
  id: string;
  flowRunId: string;
  nodeId: string;
  provider: BatchProvider;
  batchId?: string;
  status: BatchStatus;
  requestData: BatchRequest;
  responseData?: BatchResult[];
  error?: string;
  submittedAt: Date | string;
  completedAt?: Date | string;
  createdAt: Date | string;
  updatedAt: Date | string;
}

/**
 * Input for updating a batch job
 */
export interface UpdateBatchJobInput {
  batchId?: string;
  status?: BatchStatus;
  responseData?: BatchResult[];
  error?: string;
  completedAt?: Date | string;
}

/**
 * Batch job query parameters
 */
interface _BatchJobQuery {
  flowRunId?: string;
  nodeId?: string;
  provider?: BatchProvider;
  status?: BatchStatus;
  limit?: number;
  offset?: number;
}

const TABLE = 'flowlib_batch_jobs';

/**
 * Batch Jobs CRUD operations class — uses FlowlibAdapter.
 */
export class BatchJobsModel {
  constructor(
    private readonly adapter: FlowlibAdapter,
    private readonly logger: Logger,
  ) {}

  /**
   * Create a new batch job
   */
  async create(input: BatchRequest): Promise<BatchJob> {
    try {
      const now = new Date();
      const result = await this.adapter.create({
        model: TABLE,
        data: {
          flow_run_id: input.flowRunId,
          node_id: input.nodeId,
          provider: input.provider,
          status: BatchStatus.SUBMITTED,
          request_data: input,
          submitted_at: now,
          created_at: now,
          updated_at: now,
        },
      });
      return this.normalize(result);
    } catch (error) {
      this.logger.error('Failed to create batch job', { input, error });
      throw new DatabaseError('Failed to create batch job', { error });
    }
  }

  /**
   * Get all batch jobs with optional filtering
   */
  async findAll(query: {
    provider?: BatchProvider[];
    status?: BatchStatus[];
  }): Promise<BatchJob[]> {
    try {
      const where: WhereClause[] = [];

      if (query.provider && query.provider.length > 0) {
        where.push({ field: 'provider', operator: 'in', value: query.provider });
      }
      if (query.status && query.status.length > 0) {
        where.push({ field: 'status', operator: 'in', value: query.status });
      }

      const results = await this.adapter.findMany<Record<string, unknown>>({
        model: TABLE,
        where: where.length > 0 ? where : undefined,
        sortBy: { field: 'created_at', direction: 'desc' },
      });
      return results.map((r) => this.normalize(r));
    } catch (error) {
      this.logger.error('Failed to retrieve batch jobs', { error });
      throw new DatabaseError('Failed to retrieve batch jobs', { error });
    }
  }

  /**
   * Get batch jobs by execution ID
   */
  async findByExecutionId(executionId: string): Promise<BatchJob[]> {
    try {
      const results = await this.adapter.findMany<Record<string, unknown>>({
        model: TABLE,
        where: [{ field: 'flow_run_id', value: executionId }],
      });
      return results.map((r) => this.normalize(r));
    } catch (error) {
      this.logger.error('Failed to get batch job by execution ID', {
        batchJobExecutionId: executionId,
        error,
      });
      throw new DatabaseError('Failed to get batch job by ID', { error });
    }
  }

  /**
   * Get batch job by ID
   */
  async findById(id: string): Promise<BatchJob | null> {
    try {
      const result = await this.adapter.findOne<Record<string, unknown>>({
        model: TABLE,
        where: [{ field: 'id', value: id }],
      });
      return result ? this.normalize(result) : null;
    } catch (error) {
      this.logger.error('Failed to get batch job by ID', { batchJobId: id, error });
      throw new DatabaseError('Failed to get batch job by ID', { error });
    }
  }

  /**
   * Update batch job
   */
  async update(id: string, input: UpdateBatchJobInput): Promise<BatchJob> {
    try {
      const updateData: Record<string, unknown> = {
        updated_at: new Date(),
      };

      if (input.batchId !== undefined) {
        updateData.batch_id = input.batchId;
      }
      if (input.status !== undefined) {
        updateData.status = input.status;
      }
      if (input.responseData !== undefined) {
        updateData.response_data = input.responseData;
      }
      if (input.error !== undefined) {
        updateData.error = input.error;
      }
      if (input.completedAt !== undefined) {
        updateData.completed_at = new Date(input.completedAt as string);
      }

      const result = await this.adapter.update<Record<string, unknown>>({
        model: TABLE,
        where: [{ field: 'id', value: id }],
        update: updateData,
      });

      if (!result) {
        throw new DatabaseError('Batch job not found');
      }
      return this.normalize(result);
    } catch (error) {
      this.logger.error('Failed to update batch job', { batchJobId: id, error });
      throw new DatabaseError('Failed to update batch job', { error });
    }
  }

  /**
   * Delete batch job
   */
  async delete(id: string): Promise<void> {
    try {
      await this.adapter.delete({
        model: TABLE,
        where: [{ field: 'id', value: id }],
      });
    } catch (error) {
      this.logger.error('Failed to delete batch job', { batchJobId: id, error });
      throw new DatabaseError('Failed to delete batch job', { error });
    }
  }

  /**
   * Get batch jobs by execution ID and node ID
   */
  async findByExecutionAndNode(executionId: string, nodeId: string): Promise<BatchJob[]> {
    try {
      const results = await this.adapter.findMany<Record<string, unknown>>({
        model: TABLE,
        where: [
          { field: 'flow_run_id', value: executionId },
          { field: 'node_id', value: nodeId },
        ],
        sortBy: { field: 'created_at', direction: 'desc' },
      });
      return results.map((r) => this.normalize(r));
    } catch (error) {
      this.logger.error('Failed to get batch jobs by execution and node', {
        executionId,
        nodeId,
        error,
      });
      throw new DatabaseError('Failed to get batch jobs by execution and node', { error });
    }
  }

  /**
   * Normalize database results to standard BatchJob type
   */
  private normalize(raw: Record<string, unknown>): BatchJob {
    return {
      id: String(raw.id),
      flowRunId: String(raw.flow_run_id ?? raw.flowRunId),
      nodeId: String(raw.node_id ?? raw.nodeId),
      provider: (raw.provider || 'OPENAI') as BatchProvider,
      batchId: (raw.batch_id ?? raw.batchId) ? String(raw.batch_id ?? raw.batchId) : undefined,
      status: (raw.status || 'SUBMITTED') as BatchStatus,
      requestData: (raw.request_data ?? raw.requestData ?? {}) as BatchRequest,
      responseData: (raw.response_data ?? raw.responseData ?? undefined) as
        | BatchResult[]
        | undefined,
      error: raw.error ? String(raw.error) : undefined,
      submittedAt: (raw.submitted_at ?? raw.submittedAt ?? new Date()) as Date | string,
      completedAt: (raw.completed_at ?? raw.completedAt ?? undefined) as Date | string | undefined,
      createdAt: (raw.created_at ?? raw.createdAt ?? new Date()) as Date | string,
      updatedAt: (raw.updated_at ?? raw.updatedAt ?? new Date()) as Date | string,
    };
  }
}
