// Flow Runs Model for Flowlib core — adapter-based implementation
import type { FlowlibAdapter, WhereClause } from '../../database/adapter';
import { DatabaseError } from 'src/types/common/errors.types';
import {
  Logger,
  PaginatedResponse,
  PaginationQuery,
  QueryOptions,
  SortingQuery,
} from 'src/schemas';
import { FlowRunStatus } from 'src/types/base';

/**
 * Flow Execution entity
 */
export interface FlowRun {
  id: string;
  flowId: string;
  flowVersion: number;
  status: FlowRunStatus;
  inputs: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  error?: string;
  startedAt: Date | string;
  completedAt?: Date | string;
  duration?: number;
  createdBy?: string;
  triggerType?: string | null;
  triggerId?: string | null;
  triggerNodeId?: string | null;
  triggerData?: Record<string, unknown> | null;
  lastHeartbeatAt?: Date | string | null;
  /**
   * Buffered node executions (JSON blob) for runs captured under
   * `execution.persistence: 'per-run'`. Populated only when the flow run
   * reaches a terminal state — never during in-flight runs.
   *
   * Stored as a JSON-encoded array of `NodeExecution` rows. Consumers should
   * read this through `NodeExecutionService.listNodeExecutionsByFlowRunId`,
   * which transparently merges per-node and per-run sources.
   */
  nodeOutputs?: unknown;
}

/**
 * Input for creating a new flow execution
 */
export interface CreateFlowRunInput {
  flowId: string;
  flowVersion: number;
  inputs: Record<string, unknown>;
  createdBy?: string;
  triggerType?: string;
  triggerId?: string;
  triggerNodeId?: string;
  triggerData?: Record<string, unknown>;
}

/**
 * Input for updating a flow execution
 */
export interface UpdateFlowRunInput {
  status?: FlowRunStatus;
  outputs?: Record<string, unknown>;
  error?: string;
  completedAt?: Date | string;
  duration?: number;
  lastHeartbeatAt?: Date | string;
  /**
   * Buffered node-execution blob for `execution.persistence: 'per-run'`.
   * Pass `null` to clear; pass an array of `NodeExecution`-shaped records
   * to flush the buffered traces alongside the terminal state update.
   */
  nodeOutputs?: unknown;
}

/**
 * Flow execution query parameters
 */
interface _FlowRunQuery {
  flowId: string;
  pagination?: PaginationQuery;
  sort?: SortingQuery<FlowRun>;
}

const TABLE = 'flowlib_flow_executions';

/**
 * Flow Runs CRUD operations class — uses FlowlibAdapter.
 */
export class FlowRunsModel {
  constructor(
    private readonly adapter: FlowlibAdapter,
    private readonly logger: Logger,
  ) {}

  /**
   * Create a new flow execution
   */
  async create(input: CreateFlowRunInput): Promise<FlowRun> {
    try {
      const result = await this.adapter.create({
        model: TABLE,
        data: {
          flow_id: input.flowId,
          flow_version: input.flowVersion,
          status: FlowRunStatus.PENDING,
          inputs: input.inputs,
          created_by: input.createdBy ?? null,
          trigger_type: input.triggerType ?? null,
          trigger_id: input.triggerId ?? null,
          trigger_node_id: input.triggerNodeId ?? null,
          trigger_data: input.triggerData ?? null,
          started_at: new Date(),
        },
      });
      return this.normalize(result);
    } catch (error) {
      this.logger.error('Failed to create flow execution', { input, error });
      throw new DatabaseError('Failed to create flow execution', { error });
    }
  }

  /**
   * Get all executions with optional filtering
   */
  async findAll(options?: QueryOptions<FlowRun>): Promise<PaginatedResponse<FlowRun>> {
    const pagination = options?.pagination || { limit: 100, page: 1 };
    const sort = options?.sort;
    const filter = options?.filter || {};
    const offset = (pagination.page - 1) * pagination.limit;
    const where = this.buildFilterWhere(filter);

    try {
      const [data, totalCount] = await Promise.all([
        this.adapter.findMany<Record<string, unknown>>({
          model: TABLE,
          where,
          limit: pagination.limit,
          offset,
          sortBy: sort
            ? { field: this.mapSortField(sort.sortBy as string), direction: sort.sortOrder }
            : { field: 'started_at', direction: 'desc' },
        }),
        this.adapter.count({ model: TABLE, where }),
      ]);

      return this.processPaginatedResults(data, totalCount, pagination);
    } catch (error) {
      this.logger.error('Failed to retrieve flow executions', { options, error });
      throw new DatabaseError('Failed to retrieve flow executions', { error });
    }
  }

  /**
   * Get execution by ID
   */
  async findById(id: string): Promise<FlowRun | null> {
    try {
      const result = await this.adapter.findOne<Record<string, unknown>>({
        model: TABLE,
        where: [{ field: 'id', value: id }],
      });
      return result ? this.normalize(result) : null;
    } catch (error) {
      this.logger.error('Failed to get flow execution by ID', { executionId: id, error });
      throw new DatabaseError('Failed to get flow execution by ID', { error });
    }
  }

  /**
   * Update flow execution
   */
  async update(id: string, input: UpdateFlowRunInput): Promise<FlowRun> {
    try {
      const updateData: Record<string, unknown> = {};

      if (input.status !== undefined) {
        updateData.status = input.status;
      }
      if (input.outputs !== undefined) {
        updateData.outputs = input.outputs;
      }
      if (input.error !== undefined) {
        updateData.error = input.error;
      }
      if (input.completedAt !== undefined) {
        updateData.completed_at = new Date(input.completedAt as string);
      }
      if (input.duration !== undefined) {
        updateData.duration = input.duration;
      }
      if (input.lastHeartbeatAt !== undefined) {
        updateData.last_heartbeat_at = new Date(input.lastHeartbeatAt as string);
      }
      if (input.nodeOutputs !== undefined) {
        updateData.node_outputs = input.nodeOutputs;
      }

      const result = await this.adapter.update<Record<string, unknown>>({
        model: TABLE,
        where: [{ field: 'id', value: id }],
        update: updateData,
      });

      if (!result) {
        throw new DatabaseError('Flow execution not found');
      }
      return this.normalize(result);
    } catch (error) {
      this.logger.error('Failed to update flow execution', { executionId: id, error });
      throw new DatabaseError('Failed to update flow execution', { error });
    }
  }

  /**
   * Delete flow execution
   */
  async delete(id: string): Promise<void> {
    try {
      await this.adapter.delete({
        model: TABLE,
        where: [{ field: 'id', value: id }],
      });
    } catch (error) {
      this.logger.error('Failed to delete flow execution', { executionId: id, error });
      throw new DatabaseError('Failed to delete flow execution', { error });
    }
  }

  /**
   * Get executions by flow ID
   */
  async listRunsByFlowId(flowId: string): Promise<FlowRun[]> {
    const result = await this.findAll({ filter: { flowId: [flowId] } });
    return result.data;
  }

  /**
   * Get execution by flow ID and version, with support for 'latest' values
   */
  async findByFlowIdVersion(
    flowId: string,
    version: number | 'latest' = 'latest',
    executionId: string | 'latest' = 'latest',
  ): Promise<FlowRun | null> {
    try {
      let actualVersion = version;

      // Resolve 'latest' version
      if (version === 'latest') {
        const results = await this.adapter.findMany<Record<string, unknown>>({
          model: TABLE,
          where: [{ field: 'flow_id', value: flowId }],
          sortBy: { field: 'flow_version', direction: 'desc' },
          limit: 1,
          select: ['flow_version'],
        });
        if (results.length === 0) {
          return null;
        }
        actualVersion = Number(results[0].flow_version);
      }

      const where: WhereClause[] = [
        { field: 'flow_id', value: flowId },
        { field: 'flow_version', value: actualVersion },
      ];

      if (executionId !== 'latest') {
        where.push({ field: 'id', value: executionId });
        const result = await this.adapter.findOne<Record<string, unknown>>({
          model: TABLE,
          where,
        });
        return result ? this.normalize(result) : null;
      }

      // Get the latest execution for this version
      const results = await this.adapter.findMany<Record<string, unknown>>({
        model: TABLE,
        where,
        sortBy: { field: 'started_at', direction: 'desc' },
        limit: 1,
      });
      return results.length > 0 ? this.normalize(results[0]) : null;
    } catch (error) {
      this.logger.error('Failed to get flow execution by flow ID and version', {
        flowId,
        version,
        executionId,
        error,
      });
      throw new DatabaseError('Failed to get flow execution by flow ID and version', { error });
    }
  }

  /**
   * Update the heartbeat timestamp for a running flow execution.
   */
  async updateHeartbeat(id: string): Promise<void> {
    try {
      await this.adapter.update({
        model: TABLE,
        where: [{ field: 'id', value: id }],
        update: { last_heartbeat_at: new Date() },
        returning: false,
      });
    } catch (error) {
      this.logger.error('Failed to update heartbeat', { executionId: id, error });
      // Don't throw — heartbeat failure shouldn't abort execution
    }
  }

  /**
   * Find flow runs that are in RUNNING or PENDING state with a heartbeat
   * older than the given threshold (or no heartbeat at all).
   */
  async findStaleRuns(thresholdMs: number): Promise<FlowRun[]> {
    try {
      const cutoff = new Date(Date.now() - thresholdMs);
      const activeStatuses = [FlowRunStatus.RUNNING, FlowRunStatus.PENDING];

      // Get all active runs
      const activeRuns = await this.adapter.findMany<Record<string, unknown>>({
        model: TABLE,
        where: [{ field: 'status', operator: 'in', value: activeStatuses }],
      });

      // Filter stale runs in application code
      // A run is stale if:
      // 1. It has a heartbeat older than cutoff, OR
      // 2. It has no heartbeat and started_at is older than cutoff
      return activeRuns
        .filter((run) => {
          const heartbeat = run.last_heartbeat_at ?? run.lastHeartbeatAt;
          const startedAt = run.started_at ?? run.startedAt;
          if (heartbeat) {
            return new Date(heartbeat as string) < cutoff;
          }
          return startedAt ? new Date(startedAt as string) < cutoff : false;
        })
        .map((r) => this.normalize(r));
    } catch (error) {
      this.logger.error('Failed to find stale runs', { thresholdMs, error });
      return [];
    }
  }

  /**
   * Bulk-fail stale runs.
   */
  async failStaleRuns(thresholdMs: number): Promise<number> {
    const staleRuns = await this.findStaleRuns(thresholdMs);
    if (staleRuns.length === 0) {
      return 0;
    }

    const ids = staleRuns.map((r) => r.id);
    const now = new Date();
    const errorMsg = 'Execution timed out — no heartbeat received within the configured timeout';

    try {
      await this.adapter.updateMany({
        model: TABLE,
        where: [{ field: 'id', operator: 'in', value: ids }],
        update: {
          status: FlowRunStatus.FAILED,
          error: errorMsg,
          completed_at: now,
        },
      });

      this.logger.warn('Marked stale flow runs as FAILED', { count: ids.length, flowRunIds: ids });
      return ids.length;
    } catch (error) {
      this.logger.error('Failed to mark stale runs as FAILED', { ids, error });
      return 0;
    }
  }

  // =========================================================================
  // Private helpers
  // =========================================================================

  private calculatePaginationMetadata(
    totalCount: number,
    pagination: { page: number; limit: number },
  ) {
    const totalPages = Math.ceil(totalCount / pagination.limit);
    return { page: pagination.page, limit: pagination.limit, totalPages };
  }

  private processPaginatedResults(
    result: Record<string, unknown>[],
    totalCount: number,
    pagination: { page: number; limit: number },
  ): PaginatedResponse<FlowRun> {
    const data = result.map((r) => this.normalize(r));
    return { data, pagination: this.calculatePaginationMetadata(totalCount, pagination) };
  }

  private normalize(raw: Record<string, unknown>): FlowRun {
    return {
      id: String(raw.id),
      flowId: String(raw.flow_id ?? raw.flowId),
      flowVersion: Number(raw.flow_version ?? raw.flowVersion),
      status: (raw.status || 'PENDING') as FlowRunStatus,
      inputs: (raw.inputs || {}) as Record<string, unknown>,
      outputs: raw.outputs as Record<string, unknown> | undefined,
      error: raw.error ? String(raw.error) : undefined,
      startedAt: (raw.started_at ?? raw.startedAt ?? new Date()) as Date | string,
      completedAt: (raw.completed_at ?? raw.completedAt ?? undefined) as Date | string | undefined,
      duration: raw.duration ? Number(raw.duration) : undefined,
      createdBy: raw.created_by ? String(raw.created_by) : undefined,
      triggerType: (raw.trigger_type ?? raw.triggerType ?? null) as string | null,
      triggerId: (raw.trigger_id ?? raw.triggerId ?? null) as string | null,
      triggerNodeId: (raw.trigger_node_id ?? raw.triggerNodeId ?? null) as string | null,
      triggerData: (raw.trigger_data ?? raw.triggerData ?? null) as Record<string, unknown> | null,
      lastHeartbeatAt: (raw.last_heartbeat_at ?? raw.lastHeartbeatAt ?? null) as
        | Date
        | string
        | null,
      nodeOutputs: raw.node_outputs ?? raw.nodeOutputs,
    };
  }

  private buildFilterWhere(filter: Record<string, unknown[]>): WhereClause[] {
    const clauses: WhereClause[] = [];
    for (const [key, values] of Object.entries(filter)) {
      if (!values || !Array.isArray(values) || values.length === 0) {
        continue;
      }
      const dbField = this.mapFilterField(key);
      if (values.length === 1) {
        clauses.push({ field: dbField, operator: 'eq', value: values[0] });
      } else {
        clauses.push({ field: dbField, operator: 'in', value: values });
      }
    }
    return clauses;
  }

  private mapFilterField(field: string): string {
    const map: Record<string, string> = {
      flowId: 'flow_id',
      flowVersion: 'flow_version',
      status: 'status',
      startedAt: 'started_at',
      completedAt: 'completed_at',
      createdBy: 'created_by',
    };
    return map[field] ?? field;
  }

  private mapSortField(field: string): string {
    return this.mapFilterField(field);
  }

  /**
   * Count flow runs grouped by status, optionally filtered by a start date.
   */
  async countByStatus(since?: Date): Promise<Record<string, number>> {
    try {
      const where: WhereClause[] = [];
      if (since) {
        where.push({ field: 'started_at', operator: 'gte', value: since });
      }

      // Get all matching runs and count in application code
      const runs = await this.adapter.findMany<Record<string, unknown>>({
        model: TABLE,
        where: where.length > 0 ? where : undefined,
        select: ['status'],
      });

      const counts: Record<string, number> = {};
      for (const run of runs) {
        const status = String(run.status || 'UNKNOWN');
        counts[status] = (counts[status] || 0) + 1;
      }
      return counts;
    } catch (error) {
      this.logger.error('Failed to count flow runs by status', { since, error });
      return {};
    }
  }
}
