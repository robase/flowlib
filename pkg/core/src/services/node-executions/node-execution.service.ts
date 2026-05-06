import type { DatabaseService } from '../database/database.service';
import { Logger } from 'src/schemas';
import { DatabaseError } from 'src/types/common/errors.types';
import { NodeExecutionStatus } from 'src/types/base';
import { PaginatedResponse, QueryOptions } from 'src/schemas/pagination-sort-filter';
import {
  NodeExecution,
  AgentToolExecution,
  CreateAgentToolExecutionInput,
} from './node-executions.model';
import type { NodeOutput } from 'src/types/node-io-types';
import type { ExecutionEventBus } from '../execution-event-bus';
import type { NodeErrorDetails } from '@flowlib/action-kit';

/**
 * Persistence strategy for node executions during a flow run.
 *
 * - `'per-node'`: every create/update writes through to `flowlib_action_traces`.
 * - `'per-run'`:  buffered in memory for the run's lifetime, flushed by the
 *                 FlowRunCoordinator into `flowlib_flow_executions.node_outputs`
 *                 when the run reaches a terminal state.
 */
export type PersistenceMode = 'per-node' | 'per-run';

/**
 * Generate a stable, server-side-only synthetic id for buffered node
 * executions. UUIDv4 isn't strictly required (rows never hit the DB), but
 * keeping the same shape lets downstream consumers (event bus, UI) treat
 * buffered + persisted rows interchangeably.
 */
function syntheticTraceId(): string {
  // Avoid pulling in node:crypto here — `crypto.randomUUID` is available
  // globally in Node 19+ and Workers (PR 1 already aligned core on this).
  return globalThis.crypto.randomUUID();
}

const VALID_NODE_EXECUTION_STATUSES = new Set<string>(Object.values(NodeExecutionStatus));

/**
 * Coerce an arbitrary value into a `NodeExecutionStatus`, falling back to
 * `PENDING` when the value isn't one of the known enum variants. Logs a
 * warning so schema drift is visible instead of silently casting through.
 */
function coerceNodeExecutionStatus(raw: unknown, logger: Logger): NodeExecutionStatus {
  if (typeof raw === 'string' && VALID_NODE_EXECUTION_STATUSES.has(raw)) {
    return raw as NodeExecutionStatus;
  }
  if (raw !== undefined && raw !== null) {
    logger.warn('Unexpected NodeExecution.status in serialized blob; defaulting to PENDING', {
      raw: typeof raw === 'string' ? raw : typeof raw,
    });
  }
  return NodeExecutionStatus.PENDING;
}

interface RawTraceRow {
  id?: unknown;
  flowRunId?: unknown;
  flow_run_id?: unknown;
  parentNodeExecutionId?: unknown;
  parent_node_execution_id?: unknown;
  nodeId?: unknown;
  node_id?: unknown;
  nodeType?: unknown;
  node_type?: unknown;
  toolId?: unknown;
  tool_id?: unknown;
  toolName?: unknown;
  tool_name?: unknown;
  iteration?: unknown;
  status?: unknown;
  inputs?: unknown;
  outputs?: unknown;
  error?: unknown;
  errorDetails?: unknown;
  fieldErrors?: unknown;
  startedAt?: unknown;
  started_at?: unknown;
  completedAt?: unknown;
  completed_at?: unknown;
  duration?: unknown;
  retryCount?: unknown;
  retry_count?: unknown;
}

function asNullableString(v: unknown): string | null {
  if (typeof v === 'string') {
    return v;
  }
  if (v === null || v === undefined) {
    return null;
  }
  return String(v);
}

function asOptionalString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function asNumberOrNull(v: unknown): number | null {
  if (v === null || v === undefined) {
    return null;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function asNumberOrUndefined(v: unknown): number | undefined {
  if (v === null || v === undefined) {
    return undefined;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function asPlainRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/**
 * Parse a `flow_runs.node_outputs` blob (set by `'per-run'` mode at flush
 * time) back into the same `NodeExecution[]` shape consumers expect.
 *
 * Tolerates three on-disk shapes:
 * - already-parsed array (PostgreSQL JSON, SQLite text-with-mode-json)
 * - JSON-encoded string (PostgreSQL text fallback)
 * - any other shape → returns null (caller falls through to action_traces)
 */
function parseNodeOutputsBlob(raw: unknown, logger: Logger): NodeExecution[] | null {
  let arr: unknown = raw;
  if (typeof raw === 'string') {
    try {
      arr = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(arr)) {
    return null;
  }
  // Anything we wrote in flushBuffer is already a NodeExecution; this just
  // narrows the unknowns one field at a time, and validates the closed-enum
  // fields (`status`) against their canonical values so schema drift surfaces
  // as a warning instead of a silent miscast.
  return arr.map((row) => {
    const r: RawTraceRow = row && typeof row === 'object' ? (row as RawTraceRow) : {};
    const startedAt = r.startedAt ?? r.started_at;
    const completedAt = r.completedAt ?? r.completed_at;
    return {
      id: typeof r.id === 'string' && r.id.length > 0 ? r.id : syntheticTraceId(),
      flowRunId: asNullableString(r.flowRunId ?? r.flow_run_id) ?? '',
      parentNodeExecutionId: asNullableString(
        r.parentNodeExecutionId ?? r.parent_node_execution_id,
      ),
      nodeId: asNullableString(r.nodeId ?? r.node_id) ?? '',
      nodeType: asNullableString(r.nodeType ?? r.node_type) ?? '',
      toolId: asNullableString(r.toolId ?? r.tool_id),
      toolName: asNullableString(r.toolName ?? r.tool_name),
      iteration: asNumberOrNull(r.iteration),
      status: coerceNodeExecutionStatus(r.status, logger),
      inputs: asPlainRecord(r.inputs),
      outputs: r.outputs as NodeOutput | undefined,
      error: asOptionalString(r.error),
      errorDetails: r.errorDetails as NodeErrorDetails | undefined,
      fieldErrors: r.fieldErrors as Record<string, string> | undefined,
      startedAt: (startedAt instanceof Date || typeof startedAt === 'string'
        ? startedAt
        : new Date()) as Date | string,
      completedAt:
        completedAt instanceof Date || typeof completedAt === 'string' ? completedAt : undefined,
      duration: asNumberOrUndefined(r.duration),
      retryCount: asNumberOrUndefined(r.retryCount ?? r.retry_count) ?? 0,
    } satisfies NodeExecution;
  });
}

/**
 * Core Execution Trace Service implementation using database models
 */
export class NodeExecutionService {
  private initialized: boolean = false;
  private eventBus: ExecutionEventBus | null = null;

  /**
   * Per-run in-memory buffer for `'per-run'` persistence mode.
   * Keyed by `flowRunId`; cleared on flush.
   */
  private buffer: Map<string, NodeExecution[]> = new Map();

  /**
   * Default persistence mode for newly-started runs. Individual runs can be
   * forced into `'per-node'` via `forceFlowRunPerNode` (used by
   * `resumeFromBatchCompletion` so resuming a previously-persisted run
   * doesn't lose its already-written traces).
   */
  private persistenceMode: PersistenceMode = 'per-node';

  constructor(
    private readonly logger: Logger,
    private readonly databaseService: DatabaseService,
  ) {}

  /**
   * Configure the persistence strategy for new flow runs.
   * Called once at service initialization from `ServiceFactory`.
   */
  setPersistenceMode(mode: PersistenceMode): void {
    this.persistenceMode = mode;
    this.logger.debug('Node execution persistence mode set', { mode });
  }

  getPersistenceMode(): PersistenceMode {
    return this.persistenceMode;
  }

  /**
   * Whether an in-flight run is being buffered (vs. persisted per-node).
   */
  private isBufferedRun(flowRunId: string): boolean {
    return this.persistenceMode === 'per-run' && !this.bufferDisabledRuns.has(flowRunId);
  }

  /**
   * Set of flowRunIds that have been forced into per-node mode for a single
   * run. Used by `resumeFromBatchCompletion` to avoid losing traces written
   * during the original execution.
   */
  private bufferDisabledRuns: Set<string> = new Set();

  /**
   * Disable per-run buffering for a single flow run. Subsequent
   * create/update calls fall through to the database. Idempotent.
   */
  forceFlowRunPerNode(flowRunId: string): void {
    this.bufferDisabledRuns.add(flowRunId);
  }

  /**
   * Take ownership of the buffered traces for a flow run. The buffer is
   * cleared after this call. Returns `null` if no buffered rows exist
   * (which is the case for `'per-node'` runs).
   */
  flushBuffer(flowRunId: string): NodeExecution[] | null {
    const buf = this.buffer.get(flowRunId);
    if (!buf) {
      return null;
    }
    this.buffer.delete(flowRunId);
    this.bufferDisabledRuns.delete(flowRunId);
    return buf;
  }

  /** Attach the event bus so state changes are broadcast to SSE subscribers. */
  setEventBus(bus: ExecutionEventBus): void {
    this.eventBus = bus;
  }

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      this.logger.debug('Execution trace service already initialized');
      return;
    }

    try {
      // Ensure database service is initialized
      await this.databaseService.initialize();
      this.initialized = true;
      this.logger.info('Execution trace service initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize execution trace service', { error });
      throw new DatabaseError('Failed to initialize execution trace service', { error });
    }
  }

  /**
   * Create a new execution trace
   */
  async createNodeExecution(
    executionId: string,
    nodeId: string,
    nodeType: string,
    inputs: Record<string, unknown>,
  ) {
    this.logger.debug('Creating execution trace', { executionId, nodeId, nodeType });

    // ── 'per-run' buffering path ────────────────────────────────────────
    if (this.isBufferedRun(executionId)) {
      const trace: NodeExecution = {
        id: syntheticTraceId(),
        flowRunId: executionId,
        parentNodeExecutionId: null,
        nodeId,
        nodeType,
        toolId: null,
        toolName: null,
        iteration: null,
        status: NodeExecutionStatus.PENDING,
        inputs,
        startedAt: new Date(),
        retryCount: 0,
      };
      const list = this.buffer.get(executionId) ?? [];
      list.push(trace);
      this.buffer.set(executionId, list);
      this.eventBus?.emitNodeExecutionCreate(trace);
      return trace;
    }

    // ── default 'per-node' path ─────────────────────────────────────────
    try {
      const trace = await this.databaseService.nodeExecutions.create({
        flowRunId: executionId,
        nodeId,
        nodeType,
        inputs,
      });

      this.logger.debug('Execution trace created successfully', {
        traceId: trace.id,
        executionId,
        nodeId,
      });
      this.eventBus?.emitNodeExecutionCreate(trace);
      return trace;
    } catch (error) {
      this.logger.error('Failed to create execution trace', {
        executionId,
        nodeId,
        nodeType,
        error,
      });
      throw error;
    }
  }

  /**
   * Locate a buffered trace by id and apply an in-place mutation.
   * Returns the updated row (or null if not found in any buffer).
   */
  private updateBufferedTrace(
    nodeExecutionId: string,
    mutate: (current: NodeExecution) => NodeExecution,
  ): NodeExecution | null {
    for (const [flowRunId, traces] of this.buffer) {
      const idx = traces.findIndex((t) => t.id === nodeExecutionId);
      if (idx >= 0) {
        const updated = mutate(traces[idx]);
        traces[idx] = updated;
        this.buffer.set(flowRunId, traces);
        return updated;
      }
    }
    return null;
  }

  /**
   * Update execution trace
   */
  async updateNodeExecution(nodeExecutionId: string, updates: Partial<NodeExecution>) {
    this.logger.debug('Updating execution trace', { nodeExecutionId, updates });

    // ── 'per-run' buffering path ────────────────────────────────────────
    const buffered = this.updateBufferedTrace(nodeExecutionId, (current) => ({
      ...current,
      ...updates,
    }));
    if (buffered) {
      this.eventBus?.emitNodeExecutionUpdate(buffered);
      return buffered;
    }

    try {
      // Map the updates to the model's update input type
      const updateInput = {
        status: updates.status,
        outputs: updates.outputs,
        error: updates.error,
        errorDetails: updates.errorDetails,
        fieldErrors: updates.fieldErrors,
        completedAt: updates.completedAt,
        duration: updates.duration,
        retryCount: updates.retryCount,
      };

      const updatedTrace = await this.databaseService.nodeExecutions.update(
        nodeExecutionId,
        updateInput,
      );

      this.logger.debug('Execution trace updated successfully', {
        nodeExecutionId,
        status: updatedTrace.status,
      });
      this.eventBus?.emitNodeExecutionUpdate(updatedTrace);
      return updatedTrace;
    } catch (error) {
      this.logger.error('Failed to update execution trace', { nodeExecutionId, error });
      throw error;
    }
  }

  /**
   * Get execution trace by ID
   */
  async getNodeExecutionById(nodeExecutionId: string) {
    this.logger.debug('Retrieving execution trace by ID', { nodeExecutionId });

    // Buffer first (in-flight per-run on this process)
    for (const traces of this.buffer.values()) {
      const hit = traces.find((t) => t.id === nodeExecutionId);
      if (hit) {
        return { ...hit };
      }
    }

    try {
      const trace = await this.databaseService.nodeExecutions.findById(nodeExecutionId);

      if (!trace) {
        throw new DatabaseError('Execution trace not found', { nodeExecutionId });
      }

      this.logger.debug('Execution trace retrieved successfully', { nodeExecutionId });
      return trace;
    } catch (error) {
      this.logger.error('Failed to retrieve execution trace', { nodeExecutionId, error });
      throw error;
    }
  }

  /**
   * Get all traces for an execution.
   *
   * Resolution order:
   * 1. In-memory buffer (in-flight `'per-run'` runs on this process).
   * 2. Flushed JSON blob in `flowlib_flow_executions.node_outputs` (completed
   *    `'per-run'` runs).
   * 3. `flowlib_action_traces` table (`'per-node'` runs and tool traces).
   *
   * For a `'per-run'` run that completed on a different process, only step
   * 2 is consulted — step 1 will be empty.
   */
  async listNodeExecutionsByFlowRunId(flowRunId: string) {
    this.logger.debug('Retrieving execution traces', { flowRunId: flowRunId });

    // 1. Buffer (in-flight per-run on this process)
    const buffered = this.buffer.get(flowRunId);
    if (buffered && buffered.length > 0) {
      this.logger.debug('Returning buffered execution traces (in-flight per-run)', {
        flowRunId,
        count: buffered.length,
      });
      // Defensive copy so callers can't mutate the buffer.
      return buffered.map((t) => ({ ...t }));
    }

    try {
      // 2. Flushed JSON blob (completed per-run)
      const flowRun = await this.databaseService.flowRuns.findById(flowRunId);
      const blob = flowRun?.nodeOutputs;
      if (blob !== undefined && blob !== null) {
        const parsed = parseNodeOutputsBlob(blob, this.logger);
        if (parsed && parsed.length > 0) {
          this.logger.debug('Returning flushed per-run execution traces', {
            flowRunId,
            count: parsed.length,
          });
          return parsed;
        }
      }

      // 3. Fall through to action_traces
      const traces = await this.databaseService.nodeExecutions.findByFlowRunId(flowRunId);

      this.logger.debug('Execution traces retrieved successfully', {
        flowRunId: flowRunId,
        count: traces.length,
      });
      return traces;
    } catch (error) {
      this.logger.error('Failed to retrieve execution traces', { flowRunId: flowRunId, error });
      throw error;
    }
  }

  /**
   * Update trace status with optional additional data
   */
  async updateNodeExecutionStatus(
    traceId: string,
    status: NodeExecutionStatus,
    data?: {
      outputs?: NodeOutput;
      error?: string;
      errorDetails?: NodeErrorDetails;
      fieldErrors?: Record<string, string>;
      reason?: string;
    },
  ): Promise<NodeExecution> {
    this.logger.debug('Updating node execution status', JSON.stringify({ traceId, status, data }));

    // ── 'per-run' buffering path ────────────────────────────────────────
    const buffered = this.updateBufferedTrace(traceId, (current) => {
      const isTerminal = status !== 'PENDING' && status !== 'RUNNING';
      const startedAtMs =
        typeof current.startedAt === 'string'
          ? Date.parse(current.startedAt)
          : current.startedAt.getTime();
      const completedAt = isTerminal ? new Date() : current.completedAt;
      const duration =
        isTerminal && completedAt instanceof Date
          ? completedAt.getTime() - startedAtMs
          : current.duration;
      return {
        ...current,
        status,
        outputs: data?.outputs ?? current.outputs,
        error: data?.error ?? current.error,
        errorDetails: data?.errorDetails ?? current.errorDetails,
        fieldErrors: data?.fieldErrors ?? current.fieldErrors,
        completedAt,
        duration,
      };
    });
    if (buffered) {
      this.eventBus?.emitNodeExecutionUpdate(buffered);
      return buffered;
    }

    try {
      const updated = await this.databaseService.nodeExecutions.updateTraceStatus(
        traceId,
        status,
        data,
      );
      this.eventBus?.emitNodeExecutionUpdate(updated);
      return updated;
    } catch (error) {
      this.logger.error('Failed to update trace status', { traceId, status, error });
      throw new DatabaseError('Failed to update trace status', { error });
    }
  }

  /**
   * Increment retry count
   */
  async incrementRetryCount(traceId: string) {
    return this.databaseService.nodeExecutions.incrementRetryCount(traceId);
  }

  /**
   * Get all executions across all flows with optional filtering, pagination, and sorting.
   *
   * When the caller filters by a single `flowRunId` and the run was captured
   * under `'per-run'` persistence, results are sourced from the in-memory
   * buffer or the flushed JSON blob — same fallback ladder as
   * `listNodeExecutionsByFlowRunId`. Cross-flow listings (no flowRunId
   * filter, or multiple flowRunIds) still hit `action_traces` directly,
   * which means they only see `'per-node'` runs. That's intentional — a
   * cross-flow listing under `'per-run'` would be unbounded JSON parsing.
   */
  async listNodeExecutions(
    options?: QueryOptions<NodeExecution>,
  ): Promise<PaginatedResponse<NodeExecution>> {
    try {
      this.logger.debug('Getting all node executions', { options });

      // Detect single-flow-run filter — that's the per-run-mode-friendly path.
      const flowRunIds = options?.filter?.flowRunId;
      if (Array.isArray(flowRunIds) && flowRunIds.length === 1) {
        const flowRunId = String(flowRunIds[0]);
        const traces = await this.listNodeExecutionsByFlowRunId(flowRunId);
        // If we found buffered/blob results, return them paginated. If the
        // ladder fell through to action_traces, traces is whatever the
        // table held — same as the original code path, just paginated by
        // application code.
        if (traces.length > 0 || this.buffer.has(flowRunId)) {
          const pagination = options?.pagination ?? { page: 1, limit: 100 };
          const offset = (pagination.page - 1) * pagination.limit;
          const slice = traces.slice(offset, offset + pagination.limit);
          return {
            data: slice,
            pagination: {
              page: pagination.page,
              limit: pagination.limit,
              totalPages: Math.max(1, Math.ceil(traces.length / pagination.limit)),
            },
          };
        }
        // Fall through to the database — covers per-node mode and the
        // empty-blob edge case.
      }

      // Call the model's list method which now handles pagination, sorting, and filtering
      const result = await this.databaseService.nodeExecutions.list(options);

      this.logger.debug('Node executions retrieved successfully', {
        count: result.data.length,
        pagination: result.pagination,
      });

      return result;
    } catch (error) {
      this.logger.error('Failed to get all node executions', { options, error });
      throw new DatabaseError('Failed to get all node executions', { error });
    }
  }

  /**
   * Get execution with flow data (enhanced single execution retrieval)
   */
  async getExecutionWithFlowData(executionId: string) {
    try {
      this.logger.debug('Getting execution with flow data', { executionId });

      // Get the execution
      const execution = await this.databaseService.flowRuns.findById(executionId);
      if (!execution) {
        return null;
      }

      // Get the flow data
      const flow = await this.databaseService.flows.findById(execution.flowId);
      if (!flow) {
        this.logger.warn('Flow not found for execution', {
          executionId,
          flowId: execution.flowId,
        });
        return execution;
      }

      // Get the flow version data
      const flowVersion = await this.databaseService.flowVersions.findByKey(
        execution.flowId,
        execution.flowVersion,
      );
      if (!flowVersion) {
        this.logger.warn('Flow version not found for execution', {
          executionId,
          flowId: execution.flowId,
          flowVersion: execution.flowVersion,
        });
        return execution;
      }

      // Get execution traces (per-run-aware: checks buffer/blob/table)
      const traces = await this.listNodeExecutionsByFlowRunId(executionId);

      return {
        ...execution,
        flowData: flow,
        flowVersionData: flowVersion,
        traces,
      };
    } catch (error) {
      this.logger.error('Failed to get execution with flow data', { executionId, error });
      throw new DatabaseError('Failed to get execution with flow data', { error });
    }
  }

  /**
   * Close the service
   */
  async close(): Promise<void> {
    this.logger.debug('Closing execution trace service');
    this.initialized = false;
    // Database connection lifecycle is managed externally
  }

  // =========================================================================
  // Agent Tool Execution Methods (merged from AgentToolExecutionService)
  // =========================================================================

  /**
   * Record a tool execution
   */
  async recordToolExecution(input: CreateAgentToolExecutionInput): Promise<AgentToolExecution> {
    this.logger.debug('Recording agent tool execution', {
      nodeExecutionId: input.nodeExecutionId,
      toolId: input.toolId,
      toolName: input.toolName,
      iteration: input.iteration,
    });

    try {
      const record = await this.databaseService.nodeExecutions.createToolExecution(input);

      this.logger.debug('Agent tool execution recorded successfully', {
        id: record.id,
        toolId: input.toolId,
        success: record.success,
        duration: record.duration,
      });

      return record;
    } catch (error) {
      this.logger.error('Failed to record agent tool execution', {
        nodeExecutionId: input.nodeExecutionId,
        toolId: input.toolId,
        error,
      });
      throw error;
    }
  }

  /**
   * Get tool executions for a specific node execution (agent node)
   */
  async getToolExecutionsByNodeExecutionId(nodeExecutionId: string): Promise<AgentToolExecution[]> {
    this.logger.debug('Getting agent tool executions by node execution ID', {
      nodeExecutionId,
    });

    try {
      return await this.databaseService.nodeExecutions.getToolExecutionsByNodeExecutionId(
        nodeExecutionId,
      );
    } catch (error) {
      this.logger.error('Failed to get agent tool executions by node execution ID', {
        nodeExecutionId,
        error,
      });
      throw error;
    }
  }

  /**
   * Get all tool executions for a flow run
   */
  async getToolExecutionsByFlowRunId(flowRunId: string): Promise<AgentToolExecution[]> {
    this.logger.debug('Getting agent tool executions by flow run ID', { flowRunId });

    try {
      return await this.databaseService.nodeExecutions.getToolExecutionsByFlowRunId(flowRunId);
    } catch (error) {
      this.logger.error('Failed to get agent tool executions by flow run ID', {
        flowRunId,
        error,
      });
      throw error;
    }
  }

  /**
   * List tool executions with pagination and filtering
   */
  async listToolExecutions(
    options?: QueryOptions<AgentToolExecution>,
  ): Promise<PaginatedResponse<AgentToolExecution>> {
    this.logger.debug('Listing agent tool executions', { options });

    try {
      return await this.databaseService.nodeExecutions.listToolExecutions(options);
    } catch (error) {
      this.logger.error('Failed to list agent tool executions', { options, error });
      throw error;
    }
  }
}
