// Action Traces Model for Flowlib core — adapter-based implementation
// Unified model for node executions + agent tool executions (action_traces table)
import type { FlowlibAdapter, WhereClause } from '../../database/adapter';
import { NodeExecutionStatus } from 'src/types/base';
import { DatabaseError } from 'src/types/common/errors.types';
import { Logger, PaginatedResponse, QueryOptions } from 'src/schemas';
import type { NodeOutput } from 'src/types/node-io-types';
import type { NodeErrorDetails } from '@flowlib/action-kit';

/**
 * Execution Trace entity (node-level trace, parentNodeExecutionId is null)
 */
export interface NodeExecution {
  id: string;
  flowRunId: string;
  parentNodeExecutionId?: string | null;
  nodeId: string;
  nodeType: string;
  toolId?: string | null;
  toolName?: string | null;
  iteration?: number | null;
  status: NodeExecutionStatus;
  inputs: Record<string, unknown>;
  outputs?: NodeOutput;
  error?: string;
  errorDetails?: NodeErrorDetails;
  fieldErrors?: Record<string, string>;
  startedAt: Date | string;
  completedAt?: Date | string;
  duration?: number;
  retryCount: number;
}

/**
 * Agent Tool Execution entity — a view over a tool-type action trace.
 * Provides backward-compatible shape with `success`, `input` (singular), `output` (singular).
 */
export interface AgentToolExecution {
  id: string;
  nodeExecutionId: string;
  flowRunId: string;
  toolId: string;
  toolName: string;
  iteration: number;
  input: Record<string, unknown>;
  output?: unknown;
  error?: string;
  success: boolean;
  startedAt: Date | string;
  completedAt?: Date | string;
  duration?: number;
}

/**
 * Input for creating a new agent tool execution (backward-compatible with old service API)
 */
export interface CreateAgentToolExecutionInput {
  nodeExecutionId: string;
  flowRunId: string;
  toolId: string;
  toolName: string;
  iteration: number;
  input: Record<string, unknown>;
  output?: unknown;
  error?: string;
  success: boolean;
  startedAt: string;
  completedAt?: string;
  duration?: number;
}

/**
 * Input for creating a new execution trace
 */
export interface CreateNodeExecutionInput {
  flowRunId: string;
  nodeId: string;
  nodeType: string;
  inputs: Record<string, unknown>;
}

/**
 * Input for updating an execution trace
 */
export interface UpdateNodeExecutionInput {
  status?: NodeExecutionStatus;
  outputs?: NodeOutput;
  error?: string;
  errorDetails?: NodeErrorDetails;
  fieldErrors?: Record<string, string>;
  completedAt?: Date | string;
  duration?: number;
  retryCount?: number;
}

/**
 * Execution trace query parameters
 */
interface _NodeExecutionQuery {
  nodeExecutionId?: string;
  nodeId?: string;
  status?: NodeExecutionStatus;
  limit?: number;
  offset?: number;
}

const TABLE = 'flowlib_action_traces';

/** Filter clause to select only node-level traces (not tool traces) */
const NODE_TRACE_FILTER: WhereClause = {
  field: 'parent_node_execution_id',
  operator: 'is_null',
  value: null,
};

/** Filter clause to select only tool-level traces */
const toolTraceFilter = (parentId: string): WhereClause => ({
  field: 'parent_node_execution_id',
  operator: 'eq',
  value: parentId,
});

/**
 * Node Executions CRUD operations class — uses FlowlibAdapter.
 */
export class NodeExecutionsModel {
  constructor(
    private readonly adapter: FlowlibAdapter,
    private readonly logger: Logger,
  ) {}

  /**
   * Create a new execution trace
   */
  async create(input: CreateNodeExecutionInput): Promise<NodeExecution> {
    try {
      const result = await this.adapter.create({
        model: TABLE,
        data: {
          flow_run_id: input.flowRunId,
          node_id: input.nodeId,
          node_type: input.nodeType,
          status: 'PENDING' as NodeExecutionStatus,
          inputs: input.inputs,
          retry_count: 0,
          started_at: new Date(),
        },
      });
      return this.normalize(result);
    } catch (error) {
      this.logger.error('Failed to create execution trace', { input, error });
      throw new DatabaseError('Failed to create execution trace', { error });
    }
  }

  /**
   * Get all execution traces with optional filtering (node traces only)
   */
  async list(options?: QueryOptions<NodeExecution>): Promise<PaginatedResponse<NodeExecution>> {
    const pagination = options?.pagination || { limit: 100, page: 1 };
    const sort = options?.sort;
    const filter = options?.filter || {};
    const offset = (pagination.page - 1) * pagination.limit;
    const where = [...this.buildFilterWhere(filter), NODE_TRACE_FILTER];

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
      this.logger.error('Failed to retrieve execution traces', { options, error });
      throw new DatabaseError('Failed to retrieve execution traces', { error });
    }
  }

  /**
   * Get execution trace by ID
   */
  async findById(id: string): Promise<NodeExecution | null> {
    try {
      const result = await this.adapter.findOne<Record<string, unknown>>({
        model: TABLE,
        where: [{ field: 'id', value: id }],
      });
      return result ? this.normalize(result) : null;
    } catch (error) {
      this.logger.error('Failed to get execution trace by ID', { traceId: id, error });
      throw new DatabaseError('Failed to get execution trace by ID', { error });
    }
  }

  /**
   * Update execution trace
   */
  async update(id: string, input: UpdateNodeExecutionInput): Promise<NodeExecution> {
    try {
      const updateData: Record<string, unknown> = {};

      if (input.status !== undefined) {
        updateData.status = input.status;
      }
      if (input.outputs !== undefined) {
        updateData.outputs = this.serializeOutputs(input.outputs);
      }
      // `error` is a JSON column; adapter-factory auto-serializes on write.
      // Prefer the classifier's structured details and fold in fieldErrors.
      // Fall back to a minimal envelope when only a message string is given.
      if (input.errorDetails !== undefined) {
        updateData.error = {
          ...input.errorDetails,
          message: input.error ?? input.errorDetails.message,
          ...(input.fieldErrors ? { fieldErrors: input.fieldErrors } : {}),
        } satisfies NodeErrorDetails;
      } else if (input.error !== undefined) {
        updateData.error = {
          code: 'UNKNOWN',
          message: input.error,
          retryable: false,
          ...(input.fieldErrors ? { fieldErrors: input.fieldErrors } : {}),
        } satisfies NodeErrorDetails;
      }
      if (input.completedAt !== undefined) {
        updateData.completed_at = new Date(input.completedAt as string);
      }
      if (input.duration !== undefined) {
        updateData.duration = input.duration;
      }
      if (input.retryCount !== undefined) {
        updateData.retry_count = input.retryCount;
      }

      const result = await this.adapter.update<Record<string, unknown>>({
        model: TABLE,
        where: [{ field: 'id', value: id }],
        update: updateData,
      });

      if (!result) {
        throw new DatabaseError('Execution trace not found');
      }
      return this.normalize(result);
    } catch (error) {
      this.logger.error('Failed to update execution trace', { traceId: id, error });
      throw new DatabaseError('Failed to update execution trace', { error });
    }
  }

  /**
   * Delete execution trace
   */
  async delete(id: string): Promise<void> {
    try {
      await this.adapter.delete({
        model: TABLE,
        where: [{ field: 'id', value: id }],
      });
    } catch (error) {
      this.logger.error('Failed to delete execution trace', { traceId: id, error });
      throw new DatabaseError('Failed to delete execution trace', { error });
    }
  }

  /**
   * Get execution traces by flow run ID (node traces only)
   */
  async findByFlowRunId(flowRunId: string): Promise<NodeExecution[]> {
    try {
      const results = await this.adapter.findMany<Record<string, unknown>>({
        model: TABLE,
        where: [{ field: 'flow_run_id', value: flowRunId }, NODE_TRACE_FILTER],
        sortBy: { field: 'started_at', direction: 'desc' },
      });
      return results.map((r) => this.normalize(r));
    } catch (error) {
      this.logger.error('Failed to get execution traces by flow run ID', { flowRunId, error });
      throw new DatabaseError('Failed to get execution traces', { error });
    }
  }

  /**
   * Get execution traces by flow run ID and node ID
   */
  async findByExecutionAndNode(flowRunId: string, nodeId: string): Promise<NodeExecution[]> {
    try {
      const results = await this.adapter.findMany<Record<string, unknown>>({
        model: TABLE,
        where: [
          { field: 'flow_run_id', value: flowRunId },
          { field: 'node_id', value: nodeId },
          NODE_TRACE_FILTER,
        ],
        sortBy: { field: 'started_at', direction: 'desc' },
      });
      return results.map((r) => this.normalize(r));
    } catch (error) {
      this.logger.error('Failed to get execution traces by execution and node', {
        flowRunId,
        nodeId,
        error,
      });
      throw new DatabaseError('Failed to get execution traces by execution and node', { error });
    }
  }

  /**
   * Update trace status with optional additional data
   */
  async updateTraceStatus(
    id: string,
    status: NodeExecutionStatus,
    data?: {
      outputs?: NodeOutput;
      error?: string;
      errorDetails?: NodeErrorDetails;
      fieldErrors?: Record<string, string>;
      reason?: string;
    },
  ): Promise<NodeExecution> {
    try {
      this.logger.debug('Updating trace status', { traceId: id, status, data });

      const updateInput: UpdateNodeExecutionInput = {
        status,
        completedAt: status !== 'PENDING' && status !== 'RUNNING' ? new Date() : undefined,
        ...data,
      };

      const updatedTrace = await this.update(id, updateInput);

      this.logger.debug('Trace status updated successfully', {
        traceId: id,
        status: updatedTrace.status,
      });
      return updatedTrace;
    } catch (error) {
      this.logger.error('Failed to update trace status', { traceId: id, status, error });
      throw new DatabaseError('Failed to update trace status', { error });
    }
  }

  /**
   * Increment retry count
   */
  async incrementRetryCount(id: string): Promise<NodeExecution> {
    try {
      const trace = await this.findById(id);
      if (!trace) {
        throw new DatabaseError('Execution trace not found');
      }
      return this.update(id, { retryCount: trace.retryCount + 1 });
    } catch (error) {
      this.logger.error('Failed to increment retry count', { traceId: id, error });
      throw new DatabaseError('Failed to increment retry count', { error });
    }
  }

  // =========================================================================
  // Private helpers
  // =========================================================================

  /**
   * Decode the `error` column (typed `NodeErrorDetails` JSON / JSONB) into
   * the split public shape (`error` string, `errorDetails`, `fieldErrors`).
   * Adapter-factory deserializes the column for us; pre-hardening plain-
   * string rows are still tolerated.
   */
  private parseErrorColumn(raw: unknown): {
    error?: string;
    errorDetails?: NodeErrorDetails;
    fieldErrors?: Record<string, string>;
  } {
    if (raw === null || raw === undefined) {
      return {};
    }

    if (typeof raw === 'object') {
      const obj = raw as Partial<NodeErrorDetails>;
      if (typeof obj.message === 'string' && typeof obj.code === 'string') {
        const details = obj as NodeErrorDetails;
        return {
          error: details.message,
          errorDetails: details,
          ...(details.fieldErrors ? { fieldErrors: details.fieldErrors } : {}),
        };
      }
      return { error: JSON.stringify(raw) };
    }

    // Pre-hardening plain-string rows.
    return { error: String(raw) };
  }

  private serializeOutputs(outputs: NodeOutput | undefined): unknown {
    if (!outputs) {
      return undefined;
    }
    try {
      return JSON.parse(JSON.stringify(outputs));
    } catch (error) {
      throw new Error(`Failed to serialize node outputs: ${error}`);
    }
  }

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
  ): PaginatedResponse<NodeExecution> {
    const data = result.map((r) => this.normalize(r));
    return { data, pagination: this.calculatePaginationMetadata(totalCount, pagination) };
  }

  private normalize(raw: Record<string, unknown>): NodeExecution {
    return {
      id: String(raw.id),
      flowRunId: String(raw.flow_run_id ?? raw.flowRunId),
      parentNodeExecutionId: (raw.parent_node_execution_id ?? raw.parentNodeExecutionId ?? null) as
        | string
        | null,
      nodeId: String(raw.node_id ?? raw.nodeId ?? ''),
      nodeType: String(raw.node_type ?? raw.nodeType ?? ''),
      toolId: (raw.tool_id ?? raw.toolId ?? null) as string | null,
      toolName: (raw.tool_name ?? raw.toolName ?? null) as string | null,
      iteration:
        raw.iteration !== null && raw.iteration !== undefined ? Number(raw.iteration) : null,
      status: (raw.status || 'PENDING') as NodeExecutionStatus,
      inputs: (raw.inputs || {}) as Record<string, unknown>,
      outputs: raw.outputs as NodeOutput | undefined,
      ...this.parseErrorColumn(raw.error),
      startedAt: (raw.started_at ?? raw.startedAt ?? new Date()) as Date | string,
      completedAt: (raw.completed_at ?? raw.completedAt ?? undefined) as Date | string | undefined,
      duration: raw.duration ? Number(raw.duration) : undefined,
      retryCount: Number(raw.retry_count ?? raw.retryCount ?? 0),
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
      flowRunId: 'flow_run_id',
      nodeId: 'node_id',
      nodeType: 'node_type',
      startedAt: 'started_at',
      completedAt: 'completed_at',
      retryCount: 'retry_count',
      parentNodeExecutionId: 'parent_node_execution_id',
      toolId: 'tool_id',
      toolName: 'tool_name',
    };
    return map[field] ?? field;
  }

  private mapSortField(field: string): string {
    return this.mapFilterField(field);
  }

  // =========================================================================
  // Tool execution methods (agent tool traces)
  // =========================================================================

  /**
   * Create a new agent tool execution record (stored as a child action trace)
   */
  async createToolExecution(input: CreateAgentToolExecutionInput): Promise<AgentToolExecution> {
    try {
      const status = input.success ? NodeExecutionStatus.SUCCESS : NodeExecutionStatus.FAILED;
      const result = await this.adapter.create({
        model: TABLE,
        data: {
          parent_node_execution_id: input.nodeExecutionId,
          flow_run_id: input.flowRunId,
          tool_id: input.toolId,
          tool_name: input.toolName,
          iteration: input.iteration,
          status,
          inputs: input.input, // singular → plural column
          outputs: input.output ?? null,
          error: input.error ?? null,
          started_at: new Date(input.startedAt),
          completed_at: input.completedAt ? new Date(input.completedAt) : null,
          duration: input.duration ?? null,
          retry_count: 0,
        },
      });
      return this.normalizeToolExecution(result);
    } catch (error) {
      this.logger.error('Failed to create agent tool execution', { input, error });
      throw new DatabaseError('Failed to create agent tool execution', { error });
    }
  }

  /**
   * Get agent tool executions by parent node execution ID
   */
  async getToolExecutionsByNodeExecutionId(nodeExecutionId: string): Promise<AgentToolExecution[]> {
    try {
      const results = await this.adapter.findMany<Record<string, unknown>>({
        model: TABLE,
        where: [toolTraceFilter(nodeExecutionId)],
        sortBy: { field: 'iteration', direction: 'asc' },
      });
      return results.map((r) => this.normalizeToolExecution(r));
    } catch (error) {
      this.logger.error('Failed to get agent tool executions by node execution ID', {
        nodeExecutionId,
        error,
      });
      throw new DatabaseError('Failed to get agent tool executions', { error });
    }
  }

  /**
   * Get agent tool executions by flow run ID
   */
  async getToolExecutionsByFlowRunId(flowRunId: string): Promise<AgentToolExecution[]> {
    try {
      const results = await this.adapter.findMany<Record<string, unknown>>({
        model: TABLE,
        where: [
          { field: 'flow_run_id', value: flowRunId },
          { field: 'tool_id', operator: 'is_not_null', value: null },
        ],
        sortBy: { field: 'started_at', direction: 'asc' },
      });
      return results.map((r) => this.normalizeToolExecution(r));
    } catch (error) {
      this.logger.error('Failed to get agent tool executions by flow run ID', {
        flowRunId,
        error,
      });
      throw new DatabaseError('Failed to get agent tool executions', { error });
    }
  }

  /**
   * List agent tool executions with pagination
   */
  async listToolExecutions(
    options?: QueryOptions<AgentToolExecution>,
  ): Promise<PaginatedResponse<AgentToolExecution>> {
    const pagination = options?.pagination || { limit: 100, page: 1 };
    const offset = (pagination.page - 1) * pagination.limit;

    try {
      const toolFilter: WhereClause = { field: 'tool_id', operator: 'is_not_null', value: null };
      const [results, totalCount] = await Promise.all([
        this.adapter.findMany<Record<string, unknown>>({
          model: TABLE,
          where: [toolFilter],
          sortBy: { field: 'started_at', direction: 'desc' },
          limit: pagination.limit,
          offset,
        }),
        this.adapter.count({ model: TABLE, where: [toolFilter] }),
      ]);

      const data = results.map((r) => this.normalizeToolExecution(r));
      const totalPages = Math.ceil(totalCount / pagination.limit);

      return {
        data,
        pagination: { page: pagination.page, limit: pagination.limit, totalPages },
      };
    } catch (error) {
      this.logger.error('Failed to list agent tool executions', { options, error });
      throw new DatabaseError('Failed to list agent tool executions', { error });
    }
  }

  /**
   * Normalize a raw DB row to the backward-compatible AgentToolExecution shape
   */
  private normalizeToolExecution(raw: Record<string, unknown>): AgentToolExecution {
    const status = (raw.status as string) || 'FAILED';
    return {
      id: raw.id as string,
      nodeExecutionId: (raw.parent_node_execution_id ?? raw.parentNodeExecutionId) as string,
      flowRunId: (raw.flow_run_id ?? raw.flowRunId) as string,
      toolId: (raw.tool_id ?? raw.toolId) as string,
      toolName: (raw.tool_name ?? raw.toolName) as string,
      iteration: raw.iteration as number,
      input: (raw.inputs as Record<string, unknown>) || {},
      output: raw.outputs as unknown,
      error: raw.error as string | undefined,
      success: status === 'SUCCESS' || status === NodeExecutionStatus.SUCCESS,
      startedAt: (raw.started_at ?? raw.startedAt) as Date | string,
      completedAt: (raw.completed_at ?? raw.completedAt) as Date | string | undefined,
      duration: raw.duration as number | undefined,
    };
  }
}
