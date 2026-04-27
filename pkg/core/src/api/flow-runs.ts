import type { FlowRunsAPI } from './types';
import type { ServiceFactory } from '../services/service-factory';
import type { Logger } from '../schemas';
import * as Schemas from '../schemas';
import { FlowRunStatus } from '../types/base';
import type { ExecutionStreamEvent } from '../services/execution-event-bus';
import { FlowValidator } from '../services/flow-validator';
import {
  flowlibDefinitionSchema,
  type FlowlibDefinition,
} from '../services/flow-versions/schemas-fresh';
import { ValidationError } from '../types/common/errors.types';

/**
 * Marker tag applied to ephemeral flows created via `runs.runEphemeral`.
 * Surfaces and dashboards can filter by tag to hide ephemeral runs from
 * the user-facing flow library.
 */
export const EPHEMERAL_FLOW_TAG = '__ephemeral__';

export function createFlowRunsAPI(sf: ServiceFactory, logger: Logger): FlowRunsAPI {
  const orchestration = sf.getOrchestrationService();
  const flowRunsService = sf.getFlowRunsService();
  const nodeExecutionsService = sf.getNodeExecutionsService();
  const flowsService = sf.getFlowService();
  const flowVersionsService = sf.getFlowVersionsService();

  return {
    start(flowId, inputs = {}, options) {
      logger.debug('startFlowRun called', { flowId });
      return orchestration.executeFlow(flowId, inputs, options);
    },

    startAsync(flowId, inputs = {}, options) {
      logger.debug('startFlowRunAsync called', { flowId });
      return orchestration.executeFlowAsync(flowId, inputs, options);
    },

    executeToNode(flowId, targetNodeId, inputs = {}, options) {
      logger.debug('executeFlowToNode called', { flowId, targetNodeId });
      return orchestration.executeFlowToNode(flowId, targetNodeId, inputs, options);
    },

    resume(executionId) {
      logger.debug('resumeExecution called', { executionId });
      return flowRunsService.resumeRun(executionId);
    },

    list(options) {
      logger.debug('listFlowRuns called');
      return flowRunsService.listRuns(options);
    },

    listByFlowId(flowId, options) {
      logger.debug('listFlowRunsByFlowId called', { flowId });
      const { flowId: id } = Schemas.flow.FlowIdParamsSchema.parse({ flowId });
      return flowRunsService.listRuns({
        ...options,
        filter: { ...options?.filter, flowId: [id] },
      });
    },

    get(flowRunId) {
      logger.debug('getFlowRunById called', { flowRunId });
      return flowRunsService.getRunById(flowRunId);
    },

    async cancel(flowRunId) {
      logger.debug('cancelFlowRun called', { flowRunId });
      // Orchestration.cancelExecution fires the in-process AbortController
      // (if the run is active here) AND writes the CANCELLED status; keep
      // that path authoritative so multi-process deploys fall back to the
      // stale-run reaper consistently.
      await orchestration.cancelExecution(flowRunId);
      return { message: 'Execution cancelled', timestamp: new Date().toISOString() };
    },

    pause(flowRunId, reason) {
      logger.debug('pauseFlowRun called', { flowRunId, reason });
      return flowRunsService.pauseRun(flowRunId, reason);
    },

    async *createEventStream(
      flowRunId: string,
    ): AsyncGenerator<ExecutionStreamEvent, void, undefined> {
      const bus = sf.getExecutionEventBus();

      // Subscribe to the bus FIRST so we don't drop events emitted while we
      // fetch the snapshot. With the parallel scheduler this race is easy to
      // hit — sibling node updates can fire in tight bursts during the
      // snapshot DB query. Buffered events are deduped by id when applied
      // alongside the snapshot below.
      const queue: ExecutionStreamEvent[] = [];
      let resolve: (() => void) | null = null;
      let done = false;
      const terminalStatuses = new Set([
        FlowRunStatus.SUCCESS,
        FlowRunStatus.FAILED,
        FlowRunStatus.CANCELLED,
      ]);

      const unsubscribe = bus.subscribe(flowRunId, (event) => {
        queue.push(event);
        if (event.type === 'flow_run.updated' && terminalStatuses.has(event.flowRun.status)) {
          queue.push({ type: 'end', flowRun: event.flowRun });
          done = true;
        }
        const wakeUp = resolve;
        if (wakeUp) {
          resolve = null;
          wakeUp();
        }
      });

      // 1. Send initial snapshot. Any events that fired before this point
      // sit in `queue` and are drained right after.
      const flowRun = await flowRunsService.getRunById(flowRunId);
      const nodeExecutions = await nodeExecutionsService.listNodeExecutionsByFlowRunId(flowRunId);

      yield { type: 'snapshot', flowRun, nodeExecutions };

      // If the run is already terminal, close immediately.
      if (terminalStatuses.has(flowRun.status)) {
        unsubscribe();
        yield { type: 'end', flowRun };
        return;
      }

      // 3. Heartbeat interval. Configurable via
      // `config.execution.sseHeartbeatIntervalMs`. The timer is per-request
      // (not module-level), so it's safe on edge runtimes — fires only
      // while a client is connected and is cleared on disconnect.
      const heartbeatMs = sf.getConfig().execution?.sseHeartbeatIntervalMs ?? 15_000;
      const heartbeatTimer = setInterval(() => {
        queue.push({ type: 'heartbeat' });
        if (resolve) {
          resolve();
          resolve = null;
        }
      }, heartbeatMs);

      try {
        while (!done) {
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
          await new Promise<void>((r) => {
            resolve = r;
          });
        }
      } finally {
        clearInterval(heartbeatTimer);
        unsubscribe();
      }
    },

    async runEphemeral(definition, inputs = {}, options) {
      logger.debug('runEphemeral called', {
        nodeCount: definition?.nodes?.length,
        edgeCount: definition?.edges?.length,
      });

      // 1) Validate the inline definition shape via Zod
      const parsed = flowlibDefinitionSchema.safeParse(definition);
      if (!parsed.success) {
        throw new ValidationError('Invalid ephemeral flow definition', 'definition', undefined, {
          issues: parsed.error.issues.map((i) => ({
            path: i.path,
            message: i.message,
          })),
        });
      }
      const typedDef = parsed.data as FlowlibDefinition;

      // 2) Static validation (graph integrity, cycles, etc.)
      const validation = FlowValidator.validateFlowDefinition(typedDef);
      if (!validation.isValid) {
        throw new ValidationError(
          'Ephemeral flow failed static validation',
          'definition',
          undefined,
          {
            errors: validation.errors,
            warnings: validation.warnings,
          },
        );
      }

      // 3) Create a temporary flow + version to back the run.
      // The flow is tagged `__ephemeral__` so listing surfaces can hide it,
      // and inherits the same FK/cascade semantics as a regular flow — so
      // the SSE bus, node-execution persistence, and inspection endpoints
      // all work without any special-casing downstream.
      //
      // NOTE: credentials referenced by the definition still resolve by ID
      // against the persisted credential store. "Ephemeral" applies to the
      // flow definition, not to credentials.
      const ephemeralName =
        options?.name ?? `__ephemeral_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      const flow = await flowsService.createFlow({
        name: ephemeralName,
        description: 'Ephemeral run — flow definition supplied inline',
        tags: [EPHEMERAL_FLOW_TAG],
        isActive: false,
      });

      try {
        await flowVersionsService.createFlowVersion(flow.id, {
          flowlibDefinition: typedDef,
        });
      } catch (error) {
        // Best-effort cleanup if version creation fails so we don't leave
        // a dangling ephemeral flow record.
        try {
          await flowsService.deleteFlow(flow.id);
        } catch (cleanupError) {
          logger.warn('Failed to clean up ephemeral flow after version error', {
            flowId: flow.id,
            cleanupError,
          });
        }
        throw error;
      }

      // 4) Kick off the run in the background — returns immediately
      const result = await orchestration.executeFlowAsync(flow.id, inputs, {
        version: 'latest',
        initiatedBy: options?.initiatedBy,
        useBatchProcessing: options?.useBatchProcessing,
      });

      return {
        flowRunId: result.flowRunId,
        flowId: flow.id,
        status: result.status,
        eventsPath: `/flow-runs/${result.flowRunId}/stream`,
      };
    },

    getNodeExecutions(flowRunId, options) {
      logger.debug('getNodeExecutionsByRunId called', { flowRunId });
      return nodeExecutionsService.listNodeExecutions({
        ...options,
        filter: { ...options?.filter, flowRunId: [flowRunId] },
      });
    },

    listNodeExecutions(options) {
      logger.debug('listNodeExecutions called');
      return nodeExecutionsService.listNodeExecutions(options);
    },

    getToolExecutionsByNodeExecutionId(nodeExecutionId) {
      logger.debug('getToolExecutionsByNodeExecutionId called', { nodeExecutionId });
      return nodeExecutionsService.getToolExecutionsByNodeExecutionId(nodeExecutionId);
    },
  };
}
