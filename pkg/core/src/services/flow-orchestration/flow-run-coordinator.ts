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
   * Maximum number of nodes to run concurrently inside the ready-set
   * scheduler. Defaults to 8. `1` ≡ sequential.
   *
   * NOTE: nothing in core passes this today — `ServiceFactory` constructs the
   * coordinator without it, so the effective concurrency is always the default.
   * It remains a constructor knob for hosts that build the coordinator
   * directly. Wire it through `FlowlibConfig` if it needs to be user-facing.
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
   * Max nodes in flight inside the ready-set scheduler. `1` ≡ sequential.
   * See `schedulerConcurrency` on the deps for why this is effectively
   * always the default today.
   */
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
    const { logger } = this.deps;

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
    // CYCLE GUARD — do not remove. The scheduler is readiness-based and has no
    // cycle detection of its own: nodes in a cycle simply never become ready,
    // so the run would finish and report SUCCESS with those nodes silently
    // unexecuted. `topologicalSort` throws on cycles, which is the only thing
    // turning that into a visible error. The returned order is otherwise
    // informational — the scheduler does not execute in this order.
    const executionOrder = GraphService.topologicalSort(nodes, edges);

    logger.debug('Flow topological order (informational — scheduler runs by readiness)', {
      flowRunId: execution.id,
      nodeCount: nodes.length,
      order: executionOrder,
    });

    const nodeExecutions: NodeExecution[] = [];
    const nodeOutputs = new Map<FlowNodeDefinitions['id'], NodeOutput>();
    const skippedNodeIds = new Set<string>();
    const batchPendingNodeIds = new Set<string>();
    let hasFailure = false;
    let failedNodeError: string | undefined;
    let failedNodeId: string | undefined;

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
    const { logger, nodeExecutionService, batchJobsService, flowRunsService } = this.deps;

    // Needed by the plugin-hook payload below — fetched once per resume
    // rather than per resumed node.
    const resumingFlowRun = await flowRunsService.getRunById(flowRunId).catch(() => null);

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
              // Resolve the real node type from the persisted flow definition.
              // Pre-fix this branch hardcoded `core.model`, which mislabeled
              // resumed agent batches and prevented hosts from telling them
              // apart in afterNodeExecute consumers.
              const nodeDef = nodeMap.get(nodeExecution.nodeId);
              const resolvedNodeType = nodeDef?.type ?? 'core.model';

              const usage = batchResult.usage;
              const outputMetadata: Record<string, unknown> = {};
              if (usage) {
                outputMetadata['usage'] = usage;
                outputMetadata['tokenUsage'] = {
                  inputTokens: usage.inputTokens,
                  outputTokens: usage.outputTokens,
                };
              }

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
                      ...(Object.keys(outputMetadata).length > 0
                        ? { metadata: outputMetadata }
                        : {}),
                    },
                    nodeType: resolvedNodeType,
                  },
                },
              );

              if (updatedTrace.outputs) {
                nodeOutputs.set(nodeExecution.nodeId, updatedTrace.outputs);
              }

              // Fire plugin hooks for the resumed node. The original
              // execution path skipped hooks because the node was PENDING
              // when control left the coordinator; on resumption the node
              // genuinely succeeded, so consumers (metering, audit, …)
              // need notified now.
              if (this.deps.pluginHookRunner && nodeDef) {
                const hookContext = {
                  flowRun: {
                    flowId: resumingFlowRun?.flowId ?? '',
                    flowRunId,
                    flowVersion: resumingFlowRun?.flowVersion ?? 1,
                    inputs: flowInputs,
                  },
                  nodeId: nodeExecution.nodeId,
                  nodeType: resolvedNodeType,
                  nodeLabel: nodeDef.label,
                  // Inputs/params at resume time aren't reconstructed —
                  // pass empty objects rather than fabricate values.
                  inputs: {},
                  params: {},
                };
                try {
                  await this.deps.pluginHookRunner.runAfterNodeExecute({
                    ...hookContext,
                    status: 'SUCCESS',
                    output: batchResult.content,
                    duration: nodeExecution.duration ?? 0,
                  });
                } catch (hookError) {
                  logger.warn('afterNodeExecute hook error on batch resume (non-fatal)', {
                    nodeId: nodeExecution.nodeId,
                    error: hookError instanceof Error ? hookError.message : String(hookError),
                  });
                }

                // Agent batches are single-shot (no tool calling — see
                // agent.ts comment about batch only being used on the
                // first iteration). toolCallCount is therefore always 0.
                if (resolvedNodeType === 'core.agent') {
                  try {
                    await this.deps.pluginHookRunner.runAfterAgentExecute({
                      flowRunId,
                      flowId: resumingFlowRun?.flowId ?? '',
                      nodeId: nodeExecution.nodeId,
                      tokensIn: usage?.inputTokens ?? 0,
                      tokensOut: usage?.outputTokens ?? 0,
                      toolCallCount: 0,
                      durationMs: nodeExecution.duration ?? 0,
                    });
                  } catch (hookError) {
                    logger.warn('afterAgentExecute hook error on batch resume (non-fatal)', {
                      nodeId: nodeExecution.nodeId,
                      error: hookError instanceof Error ? hookError.message : String(hookError),
                    });
                  }
                }
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
    const { logger, graphService } = this.deps;

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
      await this.pauseFlowForBatch(execution.id);
      return this.buildPausedFlowResult(execution.id, nodeExecutions);
    }
    if (result.failure) {
      hasFailure = true;
      nodeErrors[result.failure.nodeId] = result.failure.error;
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
