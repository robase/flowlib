import { FlowRunStatus, NodeExecutionStatus } from 'src/types/base';
import {
  FlowlibDefinition,
  FlowNodeDefinitions,
  type FlowEdge,
} from '../flow-versions/schemas-fresh';
import type { FlowRun } from '../flow-runs/flow-runs.model';
import type { FlowRunResult } from '../flow-runs/flow-runs.service';
import type { FlowRunsService } from '../flow-runs/flow-runs.service';
import type { NodeExecution } from '../node-executions/node-executions.model';
import type { NodeExecutionService } from '../node-executions/node-execution.service';
import type { NodeOutput } from 'src/types/node-io-types';
import type { BatchJobsService } from '../batch-jobs/batch-jobs.service';
import type { FlowsService } from '../flows/flows.service';
import type { Logger } from 'src/schemas';
import type { PluginHookRunner } from 'src/types/plugin.types';
import { ValidationError } from 'src/types/common/errors.types';
import { GraphService } from '../graph.service';
import { BatchStatus } from '../ai/base-client';
import { NodeExecutionCoordinator } from './node-execution-coordinator';
import { Scheduler } from './scheduler';

type FlowRunCoordinatorDeps = {
  logger: Logger;
  flowRunsService: FlowRunsService;
  nodeExecutionCoordinator: NodeExecutionCoordinator;
  graphService: GraphService;
  nodeExecutionService: NodeExecutionService;
  batchJobsService: BatchJobsService;
  flowsService: FlowsService;
  /** Interval in ms between heartbeat writes. 0 = disabled. */
  heartbeatIntervalMs: number;
  /** Plugin hook runner for lifecycle hooks (optional for backward compat). */
  pluginHookRunner?: PluginHookRunner;
  /**
   * When `false`, falls back to the legacy sequential topological loop instead
   * of the ready-set scheduler. Defaults to `true` (parallel scheduler on).
   * Self-hosted users who previously set `FLOWLIB_PARALLEL_SCHEDULER=0` should
   * pass `parallelSchedulerEnabled: false` instead — core no longer reads env.
   */
  parallelSchedulerEnabled?: boolean;
  /**
   * Maximum number of nodes to run concurrently inside the ready-set
   * scheduler. Defaults to 8. Self-hosted users who previously set
   * `FLOWLIB_SCHEDULER_CONCURRENCY=N` should pass `schedulerConcurrency: N`
   * instead — core no longer reads env.
   */
  schedulerConcurrency?: number;
};

/**
 * Coordinates full flow run execution including batch pauses and resumption.
 */
export class FlowRunCoordinator {
  /** Active heartbeat timers keyed by flowRunId */
  private heartbeatTimers = new Map<string, NodeJS.Timeout>();

  /**
   * Active AbortControllers keyed by flowRunId. Used to propagate user-initiated
   * cancellation into in-flight SDK calls on this process. Process-death
   * cancellation is handled by the stale-run detector instead.
   */
  private abortControllers = new Map<string, AbortController>();

  constructor(private readonly deps: FlowRunCoordinatorDeps) {}

  /**
   * Return the AbortSignal for an active run, or undefined if the run is
   * not currently executing on this process.
   */
  getRunAbortSignal(flowRunId: string): AbortSignal | undefined {
    return this.abortControllers.get(flowRunId)?.signal;
  }

  /**
   * Abort an in-flight run on this process. Returns true if the run was
   * active (signal fired); false otherwise.
   */
  abortRun(flowRunId: string, reason: string): boolean {
    const ctrl = this.abortControllers.get(flowRunId);
    if (!ctrl || ctrl.signal.aborted) {
      return false;
    }
    ctrl.abort(new Error(reason));
    return true;
  }

  private startAbortController(flowRunId: string): AbortController {
    const existing = this.abortControllers.get(flowRunId);
    if (existing && !existing.signal.aborted) {
      return existing;
    }
    const ctrl = new AbortController();
    this.abortControllers.set(flowRunId, ctrl);
    return ctrl;
  }

  private clearAbortController(flowRunId: string): void {
    this.abortControllers.delete(flowRunId);
  }

  /** Clear all abort controllers (used during shutdown). */
  clearAllAbortControllers(): void {
    for (const ctrl of this.abortControllers.values()) {
      if (!ctrl.signal.aborted) {
        ctrl.abort(new Error('shutdown'));
      }
    }
    this.abortControllers.clear();
  }

  /**
   * Start a periodic heartbeat for a flow run.
   * The first heartbeat is written immediately.
   *
   * This in-process `setInterval` is intentionally not extracted into an
   * external-tick maintenance method. Runtimes that target Cloudflare
   * Workflows / Vercel Workflows already get equivalent liveness from the
   * workflow engine's own retry + step-resumption guarantees, so heartbeats
   * are redundant there. To disable in-process heartbeats on those runtimes,
   * set `executionConfig.heartbeatIntervalMs = 0` in `FlowlibConfig`.
   */
  private startHeartbeat(flowRunId: string): void {
    const { heartbeatIntervalMs, flowRunsService, logger } = this.deps;
    if (!heartbeatIntervalMs || heartbeatIntervalMs <= 0) {
      return;
    }

    // Write initial heartbeat
    flowRunsService.updateHeartbeat(flowRunId).catch((_err) => {
      // Intentionally swallowed — initial heartbeat failure is non-fatal
    });

    const timer = setInterval(() => {
      flowRunsService.updateHeartbeat(flowRunId).catch((err) => {
        logger.debug('Heartbeat write failed (non-fatal)', { flowRunId, error: String(err) });
      });
    }, heartbeatIntervalMs);

    this.heartbeatTimers.set(flowRunId, timer);
  }

  /** Stop the heartbeat timer for a flow run. */
  private stopHeartbeat(flowRunId: string): void {
    const timer = this.heartbeatTimers.get(flowRunId);
    if (timer) {
      clearInterval(timer);
      this.heartbeatTimers.delete(flowRunId);
    }
  }

  /** Stop all active heartbeat timers (used during shutdown). */
  stopAllHeartbeats(): void {
    for (const [_id, timer] of this.heartbeatTimers) {
      clearInterval(timer);
    }
    this.heartbeatTimers.clear();
  }

  /**
   * Node execution uses the ready-set scheduler by default (sibling nodes
   * run concurrently). Set `parallelSchedulerEnabled: false` on the
   * coordinator deps to fall back to the legacy sequential topological loop —
   * kept as an emergency escape hatch but slated for removal. For a milder
   * rollback, set `schedulerConcurrency: 1` to keep the scheduler code path
   * but launch nodes one at a time.
   */
  private isParallelEnabled(): boolean {
    return this.deps.parallelSchedulerEnabled !== false;
  }

  private getConcurrency(): number {
    const n = this.deps.schedulerConcurrency;
    if (typeof n === 'number' && Number.isFinite(n) && n >= 1) {
      return Math.floor(n);
    }
    return 8;
  }

  /**
   * Pre-populate `skippedNodeIds` with inactive trigger-node branches. When a
   * flow is started via a specific webhook/cron trigger, all other trigger
   * nodes and their downstream branches are skipped. When no active trigger
   * is indicated (manual run), this is a no-op and all triggers run.
   */
  private applyTriggerSkip(
    nodes: readonly FlowNodeDefinitions[],
    edges: readonly FlowEdge[],
    skippedNodeIds: Set<string>,
    flowInputs: Record<string, unknown>,
  ): void {
    const activeTriggerNodeId = flowInputs.__triggerNodeId as string | undefined;
    if (!activeTriggerNodeId) {
      return;
    }
    for (const node of nodes) {
      if (!node.type.startsWith('trigger.')) {
        continue;
      }
      if (node.id === activeTriggerNodeId) {
        continue;
      }
      skippedNodeIds.add(node.id);
      this.deps.graphService.markDownstreamNodesAsSkipped(node.id, edges, skippedNodeIds);
    }
  }

  /**
   * Run the ready-set scheduler over a filtered node set. Shared state
   * (`nodeOutputs`, `skippedNodeIds`) is mutated in place via closures; the
   * returned object carries the outcome for the caller to finalize.
   *
   * @param schedulableNodes - nodes the scheduler may consider. For resume
   *   and partial execution this is a subset of `definition.nodes`.
   * @param alreadyComplete - nodes considered terminal before the run begins
   *   (their outputs are expected in `nodeOutputs` already).
   */
  private async runSchedulerLoop(args: {
    flowRunId: string;
    definition: FlowlibDefinition;
    schedulableNodes: readonly FlowNodeDefinitions[];
    flowInputs: Record<string, unknown>;
    useBatchProcessing: boolean | undefined;
    nodeOutputs: Map<string, NodeOutput>;
    skippedNodeIds: Set<string>;
    alreadyComplete?: Set<string>;
  }): Promise<{
    traces: NodeExecution[];
    paused: boolean;
    batchPendingNodeIds: Set<string>;
    failure?: { nodeId: string; error: string };
  }> {
    const { logger, nodeExecutionCoordinator } = this.deps;
    const {
      flowRunId,
      definition,
      schedulableNodes,
      flowInputs,
      useBatchProcessing,
      nodeOutputs,
      skippedNodeIds,
      alreadyComplete,
    } = args;

    const { edges } = definition;
    const nodeMap = new Map(definition.nodes.map((node) => [node.id, node]));

    const scheduler = new Scheduler({
      logger,
      nodes: schedulableNodes,
      edges,
      skippedNodeIds,
      nodeOutputs,
      alreadyComplete,
      concurrency: this.getConcurrency(),
      failureMode: 'stop',
      batchPolicy: 'pause-immediately',
      signal: this.getRunAbortSignal(flowRunId),
      executeNode: async (node) => {
        const nodeInputs = nodeExecutionCoordinator.prepareNodeInputs(
          node,
          nodeOutputs,
          edges,
          nodeMap,
        );
        const incomingData = nodeExecutionCoordinator.buildIncomingDataObject(
          node,
          nodeOutputs,
          edges,
          nodeMap,
        );
        return nodeExecutionCoordinator.executeNode(
          flowRunId,
          node,
          nodeInputs,
          flowInputs,
          definition,
          skippedNodeIds,
          useBatchProcessing,
          incomingData,
          this.getRunAbortSignal(flowRunId),
        );
      },
      onNodeSuccess: (node, trace) => {
        this.handleBranchSkipping(node.id, trace, edges, skippedNodeIds);
      },
    });

    const result = await scheduler.run();
    return {
      traces: result.traces,
      paused: result.paused,
      batchPendingNodeIds: result.batchPendingNodeIds,
      failure: result.failure
        ? { nodeId: result.failure.nodeId, error: result.failure.error }
        : undefined,
    };
  }

  async executeFlowDefinition(
    execution: FlowRun,
    definition: FlowlibDefinition,
    flowInputs: Record<string, unknown>,
    useBatchProcessing?: boolean,
  ): Promise<FlowRunResult> {
    // Allow plugins to mutate inputs via hooks
    let mutableFlowInputs = flowInputs;
    const { logger, nodeExecutionCoordinator } = this.deps;

    logger.debug('Executing flow definition', { flowRunId: execution.id });

    await this.markExecutionRunning(execution.id);

    // ── Plugin hook: beforeFlowRun ─────────────────────────────────────
    if (this.deps.pluginHookRunner) {
      const hookResult = await this.deps.pluginHookRunner.runBeforeFlowRun({
        flowId: execution.flowId,
        flowRunId: execution.id,
        flowVersion: execution.flowVersion,
        inputs: mutableFlowInputs,
      });

      if (hookResult.cancelled) {
        logger.info('Flow run cancelled by plugin hook', {
          flowRunId: execution.id,
          reason: hookResult.reason,
        });
        await this.markExecutionFailed(execution.id, hookResult.reason || 'Cancelled by plugin');
        const traces = await this.deps.nodeExecutionService.listNodeExecutionsByFlowRunId(
          execution.id,
        );
        return {
          flowRunId: execution.id,
          status: FlowRunStatus.FAILED,
          inputs: execution.inputs,
          outputs: {},
          error: hookResult.reason || 'Cancelled by plugin',
          startedAt:
            typeof execution.startedAt === 'string'
              ? new Date(execution.startedAt)
              : execution.startedAt,
          completedAt: new Date(),
          duration: 0,
          traces,
        };
      }

      // Allow plugins to modify inputs
      if (hookResult.inputs) {
        mutableFlowInputs = hookResult.inputs as Record<string, unknown>;
      }
    }

    const { nodes, edges } = definition;
    const nodeMap = new Map(nodes.map((node) => [node.id, node]));
    const executionOrder = GraphService.topologicalSort(nodes, edges);

    logger.debug('Flow execution order determined', {
      flowRunId: execution.id,
      nodeCount: nodes.length,
      order: executionOrder,
    });

    const nodeExecutions: NodeExecution[] = [];
    const nodeOutputs = new Map<FlowNodeDefinitions['id'], NodeOutput>();
    const skippedNodeIds = new Set<string>();
    const batchPendingNodeIds = new Set<string>();
    let hasFailure = false;
    let hasBatchSubmission = false;
    let failedNodeError: string | undefined;
    let failedNodeId: string | undefined;

    // ── Ready-set scheduler path (FLOWLIB_PARALLEL_SCHEDULER=1) ────────────
    if (this.isParallelEnabled()) {
      this.applyTriggerSkip(nodes, edges, skippedNodeIds, mutableFlowInputs);
      const result = await this.runSchedulerLoop({
        flowRunId: execution.id,
        definition,
        schedulableNodes: nodes,
        flowInputs: mutableFlowInputs,
        useBatchProcessing,
        nodeOutputs,
        skippedNodeIds,
      });
      nodeExecutions.push(...result.traces);
      for (const id of result.batchPendingNodeIds) {
        batchPendingNodeIds.add(id);
      }
      if (result.paused) {
        await this.pauseFlowForBatch(execution.id);
        return this.buildPausedFlowResult(execution.id, nodeExecutions);
      }
      if (result.failure) {
        hasFailure = true;
        failedNodeError = result.failure.error;
        failedNodeId = result.failure.nodeId;
      }
    } else {
      for (const nodeId of executionOrder) {
        if (hasFailure || hasBatchSubmission) {
          break;
        }

        const node = nodeMap.get(nodeId);
        if (!node) {
          logger.warn('Node not found in definition', { flowRunId: execution.id, nodeId });
          continue;
        }

        if (skippedNodeIds.has(nodeId)) {
          logger.debug('Skipping node execution due to conditional branching', {
            flowRunId: execution.id,
            nodeId,
            nodeType: node.type,
          });
          continue;
        }

        // D2: Skip inactive trigger nodes — when a flow is triggered by a specific
        // trigger node (webhook/cron), skip all other trigger nodes and their branches.
        // When activeTriggerNodeId is absent (manual run), all trigger nodes execute.
        const isTriggerNode = node.type.startsWith('trigger.');
        const activeTriggerNodeId = (mutableFlowInputs as Record<string, unknown>)
          .__triggerNodeId as string | undefined;

        if (isTriggerNode && activeTriggerNodeId && node.id !== activeTriggerNodeId) {
          skippedNodeIds.add(nodeId);
          this.deps.graphService.markDownstreamNodesAsSkipped(nodeId, edges, skippedNodeIds);
          logger.debug('Skipping inactive trigger node and its branch', {
            flowRunId: execution.id,
            nodeId,
            nodeType: node.type,
            activeTriggerNodeId,
          });
          continue;
        }

        const incomingEdges = edges.filter((edge) => edge.target === nodeId);
        const hasBatchPendingDependencies = incomingEdges.some((edge) =>
          batchPendingNodeIds.has(edge.source),
        );

        if (hasBatchPendingDependencies) {
          logger.debug('Skipping node execution due to batch-pending dependencies', {
            flowRunId: execution.id,
            nodeId,
            nodeType: node.type,
            batchPendingDependencies: incomingEdges
              .filter((edge) => batchPendingNodeIds.has(edge.source))
              .map((e) => e.source),
          });
          continue;
        }

        logger.debug('Node execution check', {
          flowRunId: execution.id,
          nodeId,
          nodeType: node.type,
          isSkipped: skippedNodeIds.has(nodeId),
          skippedNodeIds: Array.from(skippedNodeIds),
          skippedNodeCount: skippedNodeIds.size,
          batchPendingNodeIds: Array.from(batchPendingNodeIds),
        });

        try {
          const nodeInputs = nodeExecutionCoordinator.prepareNodeInputs(
            node,
            nodeOutputs,
            edges,
            nodeMap,
          );

          // Build incoming data object for template resolution
          const incomingData = nodeExecutionCoordinator.buildIncomingDataObject(
            node,
            nodeOutputs,
            edges,
            nodeMap,
          );

          const trace = await nodeExecutionCoordinator.executeNode(
            execution.id,
            node,
            nodeInputs,
            mutableFlowInputs,
            definition,
            skippedNodeIds,
            useBatchProcessing,
            incomingData,
            this.getRunAbortSignal(execution.id),
          );
          nodeExecutions.push(trace);

          if (trace.status === NodeExecutionStatus.BATCH_SUBMITTED) {
            logger.debug('Batch submission detected - pausing flow', {
              flowRunId: execution.id,
              nodeId: trace.nodeId,
            });

            batchPendingNodeIds.add(nodeId);
            hasBatchSubmission = true;

            await this.pauseFlowForBatch(execution.id);
            return this.buildPausedFlowResult(execution.id, nodeExecutions);
          }

          if (trace.status === NodeExecutionStatus.SUCCESS) {
            if (trace.outputs) {
              nodeOutputs.set(nodeId, trace.outputs);
            }
            // Unified branch-skipping for branching nodes (if_else, switch, etc.)
            this.handleBranchSkipping(nodeId, trace, edges, skippedNodeIds);
          } else if (trace.status === NodeExecutionStatus.FAILED) {
            hasFailure = true;
            failedNodeError = trace.error || 'Node execution failed';
            failedNodeId = nodeId;
            logger.warn('Node execution failed, stopping flow', {
              flowRunId: execution.id,
              nodeId,
              error: trace.error,
            });
            break;
          }
        } catch (error) {
          logger.error('Unexpected error during node execution', {
            flowRunId: execution.id,
            nodeId,
            error,
          });
          hasFailure = true;
          failedNodeError = error instanceof Error ? error.message : String(error);
          failedNodeId = nodeId;
          break;
        }
      }
    }

    const success = !hasFailure;
    const finalOutputs = this.collectFlowOutputs(definition, nodeOutputs);

    if (success) {
      await this.markExecutionSuccess(execution.id, finalOutputs);
    } else {
      await this.markExecutionFailed(execution.id, failedNodeError || 'One or more nodes failed');
    }

    const updatedExecution = await this.deps.flowRunsService.getRunById(execution.id);

    // ── Plugin hook: afterFlowRun ──────────────────────────────────────
    if (this.deps.pluginHookRunner) {
      try {
        await this.deps.pluginHookRunner.runAfterFlowRun({
          flowId: execution.flowId,
          flowRunId: execution.id,
          flowVersion: execution.flowVersion,
          inputs: mutableFlowInputs,
          status: success ? 'SUCCESS' : 'FAILED',
          outputs: finalOutputs as Record<string, unknown>,
          error: success ? undefined : 'One or more nodes failed',
          duration: updatedExecution.duration ?? undefined,
        });
      } catch (hookError) {
        // afterFlowRun hooks must not crash the flow result
        logger.warn('afterFlowRun plugin hook error (non-fatal)', {
          flowRunId: execution.id,
          error: hookError instanceof Error ? hookError.message : String(hookError),
        });
      }
    }

    return {
      flowRunId: execution.id,
      status: success ? FlowRunStatus.SUCCESS : FlowRunStatus.FAILED,
      error: failedNodeError,
      nodeErrors: failedNodeId && failedNodeError ? { [failedNodeId]: failedNodeError } : undefined,
      inputs: execution.inputs,
      outputs: finalOutputs,
      startedAt:
        typeof updatedExecution.startedAt === 'string'
          ? new Date(updatedExecution.startedAt)
          : updatedExecution.startedAt,
      completedAt: updatedExecution.completedAt
        ? typeof updatedExecution.completedAt === 'string'
          ? new Date(updatedExecution.completedAt)
          : updatedExecution.completedAt
        : undefined,
      duration: updatedExecution.duration,
      traces: nodeExecutions,
    };
  }

  async resumeFromBatchCompletion(
    flowRunId: string,
    completedBatchNodeId: string,
    batchResult?: unknown,
    batchError?: string,
  ): Promise<FlowRunResult> {
    const { logger, nodeExecutionService, flowRunsService, flowsService } = this.deps;

    logger.debug('Resuming flow from batch completion', {
      flowRunId,
      completedBatchNodeId,
      hasError: !!batchError,
    });

    if (batchError) {
      await this.markExecutionFailed(flowRunId, `Batch processing failed: ${batchError}`);

      const traces = await nodeExecutionService.listNodeExecutionsByFlowRunId(flowRunId);
      return {
        flowRunId,
        status: FlowRunStatus.FAILED,
        inputs: {},
        outputs: {},
        error: `Batch processing failed: ${batchError}`,
        startedAt: new Date(),
        traces,
      };
    }

    const flowRun = await flowRunsService.getRunById(flowRunId);
    const flow = await flowsService.getFlowById(flowRun.flowId);

    if (!flow?.flowVersion?.flowlibDefinition) {
      throw new ValidationError('Flow definition not found for batch resume');
    }

    const definition = flow.flowVersion.flowlibDefinition as FlowlibDefinition;

    await flowRunsService.updateRunStatus(flowRunId, FlowRunStatus.RUNNING);

    return this.continueFlowRunFromBatch(flowRunId, definition, flowRun.inputs || {});
  }

  async continueFlowRunFromBatch(
    flowRunId: string,
    definition: FlowlibDefinition,
    flowInputs: Record<string, unknown>,
  ): Promise<FlowRunResult> {
    const {
      logger,
      nodeExecutionCoordinator,
      nodeExecutionService,
      batchJobsService,
      flowRunsService,
    } = this.deps;

    const { nodes, edges } = definition;
    const nodeMap = new Map(nodes.map((node) => [node.id, node]));
    const executionOrder = GraphService.topologicalSort(nodes, edges);

    const existingNodeExecutions =
      await nodeExecutionService.listNodeExecutionsByFlowRunId(flowRunId);
    const processedNodeIds = new Set(existingNodeExecutions.map((trace) => trace.nodeId));

    const nodeOutputs = new Map<FlowNodeDefinitions['id'], NodeOutput>();
    const skippedNodeIds = new Set<string>();
    let hasFailure = false;

    for (const nodeExecution of existingNodeExecutions) {
      if (nodeExecution.status === NodeExecutionStatus.SUCCESS && nodeExecution.outputs) {
        nodeOutputs.set(nodeExecution.nodeId, nodeExecution.outputs);
        // Replay branch-skipping for branching nodes (if_else, switch) that
        // executed before the batch pause. Their downstream skipped nodes have
        // no persisted SKIPPED record, so we must reconstruct the skip set.
        this.handleBranchSkipping(nodeExecution.nodeId, nodeExecution, edges, skippedNodeIds);
      } else if (nodeExecution.status === NodeExecutionStatus.SKIPPED) {
        skippedNodeIds.add(nodeExecution.nodeId);
      } else if (nodeExecution.status === NodeExecutionStatus.BATCH_SUBMITTED) {
        const batchJobs = await batchJobsService.getBatchJobsByExecutionAndNode(
          flowRunId,
          nodeExecution.nodeId,
        );

        for (const batchJob of batchJobs) {
          if (batchJob.status === BatchStatus.COMPLETED && batchJob.responseData) {
            const batchResult = batchJob.responseData[0];

            if (batchResult.status === BatchStatus.COMPLETED) {
              const updatedTrace = await nodeExecutionService.updateNodeExecutionStatus(
                nodeExecution.id,
                NodeExecutionStatus.SUCCESS,
                {
                  outputs: {
                    data: {
                      variables: {
                        // batchResult.content is already a PromptResult (discriminated union)
                        output: batchResult.content,
                      },
                    },
                    nodeType: 'core.model',
                  },
                },
              );

              if (updatedTrace.outputs) {
                nodeOutputs.set(nodeExecution.nodeId, updatedTrace.outputs);
              }
            } else if (batchResult.status === BatchStatus.FAILED) {
              await nodeExecutionService.updateNodeExecutionStatus(
                nodeExecution.id,
                NodeExecutionStatus.FAILED,
                {
                  error: batchResult.error || 'Batch processing failed',
                },
              );

              hasFailure = true;
              break;
            } else if (batchResult.status === BatchStatus.CANCELLED) {
              await nodeExecutionService.updateNodeExecutionStatus(
                nodeExecution.id,
                NodeExecutionStatus.FAILED,
                {
                  error: batchResult.error || 'Batch processing was cancelled',
                },
              );

              hasFailure = true;
              break;
            } else if (
              batchResult.status === BatchStatus.SUBMITTED ||
              batchResult.status === BatchStatus.PROCESSING
            ) {
              continue;
            } else {
              await nodeExecutionService.updateNodeExecutionStatus(
                nodeExecution.id,
                NodeExecutionStatus.FAILED,
                {
                  error: `Unknown batch status: ${batchResult.status}`,
                },
              );

              hasFailure = true;
              break;
            }
          }
        }
      }
    }

    const remainingNodes = executionOrder.filter(
      (nodeId) => !processedNodeIds.has(nodeId) && !skippedNodeIds.has(nodeId),
    );

    logger.debug('Continuing execution after batch', {
      flowRunId,
      totalNodes: nodes.length,
      processedNodes: processedNodeIds.size,
      remainingNodes: remainingNodes.length,
    });

    const newTraces: NodeExecution[] = [];

    if (this.isParallelEnabled()) {
      // `nodeOutputs` was populated during the reconstruction phase above —
      // including outputs synthesized from resolved batch jobs whose traces
      // were updated SUCCESS-wise after `existingNodeExecutions` was fetched.
      // It's the authoritative source of "what has already succeeded."
      const alreadyComplete = new Set<string>(nodeOutputs.keys());
      const remainingSet = new Set(remainingNodes);
      const schedulable = definition.nodes.filter(
        (n) => remainingSet.has(n.id) || alreadyComplete.has(n.id) || skippedNodeIds.has(n.id),
      );
      const result = await this.runSchedulerLoop({
        flowRunId,
        definition,
        schedulableNodes: schedulable,
        flowInputs,
        useBatchProcessing: true,
        nodeOutputs,
        skippedNodeIds,
        alreadyComplete,
      });
      newTraces.push(...result.traces);
      if (result.paused) {
        await this.pauseFlowForBatch(flowRunId);
        return this.buildPausedFlowResult(flowRunId, [...existingNodeExecutions, ...newTraces]);
      }
      if (result.failure) {
        hasFailure = true;
      }
    } else {
      for (const nodeId of remainingNodes) {
        if (hasFailure) {
          break;
        }

        const node = nodeMap.get(nodeId);
        if (!node) {
          continue;
        }

        const nodeInputs = nodeExecutionCoordinator.prepareNodeInputs(
          node,
          nodeOutputs,
          edges,
          nodeMap,
        );

        // Build incoming data object for template resolution
        const incomingData = nodeExecutionCoordinator.buildIncomingDataObject(
          node,
          nodeOutputs,
          edges,
          nodeMap,
        );

        try {
          const trace = await nodeExecutionCoordinator.executeNode(
            flowRunId,
            node,
            nodeInputs,
            flowInputs,
            definition,
            skippedNodeIds,
            true,
            incomingData,
            this.getRunAbortSignal(flowRunId),
          );

          newTraces.push(trace);

          if (trace.status === NodeExecutionStatus.SUCCESS && trace.outputs) {
            nodeOutputs.set(nodeId, trace.outputs);
            // Unified branch-skipping for branching nodes (if_else, switch, etc.)
            this.handleBranchSkipping(nodeId, trace, edges, skippedNodeIds);
          } else if (trace.status === NodeExecutionStatus.FAILED) {
            hasFailure = true;
          }

          if (trace.status === NodeExecutionStatus.BATCH_SUBMITTED) {
            await this.pauseFlowForBatch(flowRunId);
            return this.buildPausedFlowResult(flowRunId, [...existingNodeExecutions, ...newTraces]);
          }
        } catch (error) {
          hasFailure = true;
          logger.error('Node execution failed during batch resume', {
            flowRunId,
            nodeId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    const finalOutputs = this.collectFlowOutputs(definition, nodeOutputs);

    if (hasFailure) {
      await this.markExecutionFailed(flowRunId, 'One or more nodes failed during batch resume');
    } else {
      await this.markExecutionSuccess(flowRunId, finalOutputs);
    }

    const updatedExecution = await flowRunsService.getRunById(flowRunId);
    const allTraces = await nodeExecutionService.listNodeExecutionsByFlowRunId(flowRunId);

    return {
      flowRunId,
      status: hasFailure ? FlowRunStatus.FAILED : FlowRunStatus.SUCCESS,
      inputs: updatedExecution.inputs,
      outputs: finalOutputs,
      startedAt:
        typeof updatedExecution.startedAt === 'string'
          ? new Date(updatedExecution.startedAt)
          : updatedExecution.startedAt,
      completedAt: updatedExecution.completedAt
        ? typeof updatedExecution.completedAt === 'string'
          ? new Date(updatedExecution.completedAt)
          : updatedExecution.completedAt
        : undefined,
      duration: updatedExecution.duration,
      traces: allTraces,
    };
  }

  /**
   * Unified branch-skipping for branching nodes (if_else, switch, etc.).
   *
   * After a branching node executes, inspect its outputVariables. Any outgoing
   * edge whose sourceHandle is NOT present in outputVariables belongs to an
   * inactive branch. The first-hop target nodes on inactive branches are
   * evaluated — a target is only skipped if it has no active-handle edge from
   * this same node AND no incoming edge from another non-skipped node.
   */
  private handleBranchSkipping(
    nodeId: string,
    trace: NodeExecution,
    edges: readonly FlowEdge[],
    skippedNodeIds: Set<string>,
  ): void {
    const { logger, graphService } = this.deps;

    if (trace.status !== NodeExecutionStatus.SUCCESS) {
      return;
    }

    const variables = trace.outputs?.data?.variables;
    if (!variables || typeof variables !== 'object') {
      return;
    }

    const outgoingEdges = edges.filter((e) => e.source === nodeId);
    const connectedHandles = new Set(
      outgoingEdges.map((e) => e.sourceHandle).filter(Boolean) as string[],
    );

    // If the node has no handled edges, nothing to skip
    if (connectedHandles.size === 0) {
      return;
    }

    const activeHandles = new Set(
      [...connectedHandles].filter((h) => (variables as Record<string, unknown>)[h] !== undefined),
    );
    const inactiveHandles = new Set(
      [...connectedHandles].filter((h) => (variables as Record<string, unknown>)[h] === undefined),
    );

    // Nothing inactive → no skipping needed
    if (inactiveHandles.size === 0) {
      return;
    }

    // Find targets only reachable via inactive handles from this node
    const inactiveTargets = new Set<string>();
    for (const handle of inactiveHandles) {
      for (const edge of outgoingEdges.filter((e) => e.sourceHandle === handle)) {
        inactiveTargets.add(edge.target);
      }
    }

    // Remove targets that also have an active-handle edge from this same node
    for (const handle of activeHandles) {
      for (const edge of outgoingEdges.filter((e) => e.sourceHandle === handle)) {
        inactiveTargets.delete(edge.target);
      }
    }

    // Remove targets that have incoming edges from OTHER non-skipped nodes
    for (const targetId of inactiveTargets) {
      const allIncoming = edges.filter((e) => e.target === targetId);
      const hasNonSkippedSource = allIncoming.some(
        (e) => e.source !== nodeId && !skippedNodeIds.has(e.source),
      );
      if (hasNonSkippedSource) {
        inactiveTargets.delete(targetId);
      }
    }

    // Mark remaining targets and propagate downstream
    for (const targetId of inactiveTargets) {
      skippedNodeIds.add(targetId);
      logger.debug('Branch skipping: marked node as skipped', {
        branchingNodeId: nodeId,
        skippedTargetId: targetId,
      });
      graphService.markDownstreamNodesAsSkipped(targetId, edges, skippedNodeIds, false);
    }
  }

  private collectFlowOutputs(
    _definition: FlowlibDefinition,
    nodeOutputs: Map<string, NodeOutput | undefined>,
  ): Record<string, unknown> {
    const outputs: Record<string, unknown> = {};
    for (const [nodeId, nodeOutput] of nodeOutputs) {
      outputs[nodeId] = nodeOutput;
    }
    return outputs;
  }

  private async pauseFlowForBatch(flowRunId: string): Promise<void> {
    const { logger, flowRunsService } = this.deps;
    this.stopHeartbeat(flowRunId);
    this.clearAbortController(flowRunId);
    logger.debug('Pausing flow for batch processing', { flowRunId });
    // Note: under `execution.persistence: 'per-run'`, the in-memory buffer
    // remains held in this process across the pause. If the resume happens
    // on a different process (e.g., maintenance polling on another worker),
    // the original buffer is lost. Hosts mixing batch processing with
    // per-run persistence should currently stick with `'per-node'`. A
    // proper fix requires spilling the buffer to a partial blob and
    // teaching resume to re-merge — out of scope for PR 11.
    await flowRunsService.updateRunStatus(flowRunId, FlowRunStatus.PAUSED_FOR_BATCH);
    logger.debug('Flow paused for batch processing', { flowRunId });
  }

  private async buildPausedFlowResult(
    flowRunId: string,
    traces: NodeExecution[],
  ): Promise<FlowRunResult> {
    const execution = await this.deps.flowRunsService.getRunById(flowRunId);

    return {
      flowRunId: execution.id,
      status: FlowRunStatus.PAUSED_FOR_BATCH,
      inputs: execution.inputs,
      outputs: {},
      startedAt:
        typeof execution.startedAt === 'string'
          ? new Date(execution.startedAt)
          : execution.startedAt,
      traces,
    };
  }

  private async markExecutionRunning(flowRunId: string): Promise<void> {
    const { logger, flowRunsService } = this.deps;
    logger.debug('Marking execution as running', { flowRunId });
    await flowRunsService.updateRunStatus(flowRunId, FlowRunStatus.RUNNING);
    this.startHeartbeat(flowRunId);
    this.startAbortController(flowRunId);
  }

  /**
   * Drain the in-memory node-execution buffer for `'per-run'` persistence
   * mode. Returns the buffered traces (if any) for inclusion in the
   * `flow_runs.node_outputs` JSON column. For `'per-node'` runs, returns
   * `null` and the column is left untouched.
   *
   * Defensive: any failure here logs and returns `null` so a flush bug can
   * never block a terminal-state write.
   */
  private flushPerRunBuffer(flowRunId: string): unknown {
    try {
      const buffered = this.deps.nodeExecutionService.flushBuffer(flowRunId);
      if (!buffered || buffered.length === 0) {
        return null;
      }
      // Stored as a plain array — adapter-factory serializes to JSON on
      // write. Sort by startedAt for deterministic readback.
      return buffered
        .map((t) => ({ ...t }))
        .sort((a, b) => {
          const av = typeof a.startedAt === 'string' ? a.startedAt : a.startedAt.toISOString();
          const bv = typeof b.startedAt === 'string' ? b.startedAt : b.startedAt.toISOString();
          return av.localeCompare(bv);
        });
    } catch (err) {
      this.deps.logger.warn('Failed to flush per-run node-execution buffer (non-fatal)', {
        flowRunId,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  private async markExecutionSuccess(
    flowRunId: string,
    outputs: Record<string, unknown>,
  ): Promise<void> {
    const { logger, flowRunsService } = this.deps;
    this.stopHeartbeat(flowRunId);
    this.clearAbortController(flowRunId);
    logger.debug('Marking execution as successful', { flowRunId });
    const nodeOutputs = this.flushPerRunBuffer(flowRunId);
    await flowRunsService.updateRunStatus(flowRunId, FlowRunStatus.SUCCESS, {
      outputs,
      ...(nodeOutputs !== null ? { nodeOutputs } : {}),
    });
  }

  private async markExecutionFailed(flowRunId: string, error: string): Promise<void> {
    const { logger, flowRunsService } = this.deps;
    this.stopHeartbeat(flowRunId);
    this.clearAbortController(flowRunId);
    logger.debug('Marking execution as failed', { flowRunId, error });
    const nodeOutputs = this.flushPerRunBuffer(flowRunId);
    await flowRunsService.updateRunStatus(flowRunId, FlowRunStatus.FAILED, {
      error,
      ...(nodeOutputs !== null ? { nodeOutputs } : {}),
    });
  }

  /**
   * Execute a flow up to and including a specific target node.
   * Only executes the upstream nodes required to produce output for the target node.
   *
   * @param execution - The flow run record
   * @param definition - The flow definition
   * @param targetNodeId - The node to execute up to (this node will also be executed)
   * @param flowInputs - Flow-level inputs
   * @param useBatchProcessing - Whether to use batch processing for AI nodes
   */
  async executeFlowToNode(
    execution: FlowRun,
    definition: FlowlibDefinition,
    targetNodeId: string,
    flowInputs: Record<string, unknown>,
    useBatchProcessing?: boolean,
  ): Promise<FlowRunResult> {
    const { logger, nodeExecutionCoordinator, graphService } = this.deps;

    logger.debug('Executing flow to specific node', {
      flowRunId: execution.id,
      targetNodeId,
    });

    await this.markExecutionRunning(execution.id);

    const { nodes, edges } = definition;
    const nodeMap = new Map(nodes.map((node) => [node.id, node]));

    // Verify target node exists
    const targetNode = nodeMap.get(targetNodeId);
    if (!targetNode) {
      throw new ValidationError(`Target node not found: ${targetNodeId}`);
    }

    // Get only the nodes needed to execute to the target
    const executionPath = graphService.getExecutionPathToNode(targetNodeId, nodes, edges);

    logger.debug('Flow execution path to target node', {
      flowRunId: execution.id,
      targetNodeId,
      executionPath,
      totalNodes: nodes.length,
      nodesToExecute: executionPath.length,
    });

    const nodeExecutions: NodeExecution[] = [];
    const nodeOutputs = new Map<FlowNodeDefinitions['id'], NodeOutput>();
    const nodeErrors: Record<string, string> = {};
    const skippedNodeIds = new Set<string>();
    const batchPendingNodeIds = new Set<string>();
    let hasFailure = false;
    let hasBatchSubmission = false;

    if (this.isParallelEnabled()) {
      const pathSet = new Set(executionPath);
      const schedulable = definition.nodes.filter((n) => pathSet.has(n.id));
      const result = await this.runSchedulerLoop({
        flowRunId: execution.id,
        definition,
        schedulableNodes: schedulable,
        flowInputs,
        useBatchProcessing,
        nodeOutputs,
        skippedNodeIds,
      });
      nodeExecutions.push(...result.traces);
      for (const id of result.batchPendingNodeIds) {
        batchPendingNodeIds.add(id);
      }
      if (result.paused) {
        hasBatchSubmission = true;
        await this.pauseFlowForBatch(execution.id);
        return this.buildPausedFlowResult(execution.id, nodeExecutions);
      }
      if (result.failure) {
        hasFailure = true;
        nodeErrors[result.failure.nodeId] = result.failure.error;
      }
    } else {
      for (const nodeId of executionPath) {
        if (hasFailure || hasBatchSubmission) {
          break;
        }

        const node = nodeMap.get(nodeId);
        if (!node) {
          logger.warn('Node not found in definition', { flowRunId: execution.id, nodeId });
          continue;
        }

        if (skippedNodeIds.has(nodeId)) {
          logger.debug('Skipping node execution due to conditional branching', {
            flowRunId: execution.id,
            nodeId,
            nodeType: node.type,
          });
          continue;
        }

        logger.debug('Processing node in partial execution', {
          flowRunId: execution.id,
          nodeId,
          nodeType: node.type,
          isTargetNode: nodeId === targetNodeId,
        });

        try {
          const nodeInputs = nodeExecutionCoordinator.prepareNodeInputs(
            node,
            nodeOutputs,
            edges,
            nodeMap,
          );

          // Build incoming data object for template resolution
          const incomingData = nodeExecutionCoordinator.buildIncomingDataObject(
            node,
            nodeOutputs,
            edges,
            nodeMap,
          );

          const trace = await nodeExecutionCoordinator.executeNode(
            execution.id,
            node,
            nodeInputs,
            flowInputs,
            definition,
            skippedNodeIds,
            useBatchProcessing,
            incomingData,
            this.getRunAbortSignal(execution.id),
          );
          nodeExecutions.push(trace);

          if (trace.status === NodeExecutionStatus.BATCH_SUBMITTED) {
            logger.debug('Batch submission detected - pausing partial flow', {
              flowRunId: execution.id,
              nodeId: trace.nodeId,
            });

            batchPendingNodeIds.add(nodeId);
            hasBatchSubmission = true;

            await this.pauseFlowForBatch(execution.id);
            return this.buildPausedFlowResult(execution.id, nodeExecutions);
          }

          if (trace.status === NodeExecutionStatus.SUCCESS) {
            if (trace.outputs) {
              nodeOutputs.set(nodeId, trace.outputs);
            }
            // Unified branch-skipping for branching nodes (if_else, switch, etc.)
            this.handleBranchSkipping(nodeId, trace, edges, skippedNodeIds);
          } else if (trace.status === NodeExecutionStatus.FAILED) {
            hasFailure = true;
            nodeErrors[nodeId] = trace.error || 'Node execution failed';
            logger.error('Node execution failed in partial execution', {
              flowRunId: execution.id,
              nodeId,
              nodeType: node.type,
            });
          }
        } catch (error) {
          hasFailure = true;
          nodeErrors[nodeId] = error instanceof Error ? error.message : String(error);
          logger.error('Node execution threw an exception in partial execution', {
            flowRunId: execution.id,
            nodeId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    const success = !hasFailure;

    // For partial execution, include outputs for all executed nodes
    const finalOutputs: Record<string, unknown> = {};
    for (const [executedNodeId, output] of nodeOutputs.entries()) {
      finalOutputs[executedNodeId] = output;
    }

    if (success) {
      await this.markExecutionSuccess(execution.id, finalOutputs);
    } else {
      const firstError = Object.values(nodeErrors)[0];
      await this.markExecutionFailed(execution.id, firstError || 'One or more nodes failed');
    }

    const updatedExecution = await this.deps.flowRunsService.getRunById(execution.id);

    return {
      flowRunId: execution.id,
      status: success ? FlowRunStatus.SUCCESS : FlowRunStatus.FAILED,
      error: Object.values(nodeErrors)[0],
      inputs: execution.inputs,
      outputs: finalOutputs,
      nodeErrors: Object.keys(nodeErrors).length > 0 ? nodeErrors : undefined,
      startedAt:
        typeof updatedExecution.startedAt === 'string'
          ? new Date(updatedExecution.startedAt)
          : updatedExecution.startedAt,
      completedAt: updatedExecution.completedAt
        ? typeof updatedExecution.completedAt === 'string'
          ? new Date(updatedExecution.completedAt)
          : updatedExecution.completedAt
        : undefined,
      duration: updatedExecution.duration,
      traces: nodeExecutions,
    };
  }
}
