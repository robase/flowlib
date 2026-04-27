import { BaseLogger } from '@flowlib/core';
import { allProviderActions as allBuiltinActions } from '@flowlib/actions';
import type { ActionDefinition, ActionResult } from '@flowlib/action-kit';
import type {
  PrimitiveFlowDefinition,
  PrimitiveEdge,
  DurabilityAdapter,
  StepOptions,
  FlowRunnerConfig,
  FlowRunner,
  FlowRunResult,
} from './types';
import { WaitTimeoutError, edgeSource, edgeTarget, edgeHandle } from './types';
import { validateFlow } from './validate';
import { topologicalSort } from './graph';
import { resolveCallableParams, executeNodeAction } from './action-executor';
import { buildNodeContext } from './node-context';
import { ifElseAction } from './actions/if-else';
import { switchAction } from './actions/switch';
import { javascriptAction } from './actions/javascript';
import { outputAction } from './actions/output';
import { OUTPUT_TYPES as OUTPUT_NODE_TYPES } from './node-types';

// ─── InMemoryAdapter ──────────────────────────────────────────────────────────

export class InMemoryAdapter implements DurabilityAdapter {
  async step<T>(_name: string, fn: () => Promise<T>, _options?: StepOptions): Promise<T> {
    return fn();
  }

  async sleep(_duration: string | number): Promise<void> {
    // No-op for in-memory execution
  }

  waitForEvent<T>(name: string, _options?: { timeout?: string }): Promise<T> {
    throw new WaitTimeoutError(name);
  }

  subscribe<T>(name: string): AsyncIterable<T> {
    throw new Error(`subscribe("${name}") is not supported by InMemoryAdapter`);
  }
}

// ─── Action registry ──────────────────────────────────────────────────────────

function buildRegistry(extraActions?: ActionDefinition[]): Map<string, ActionDefinition> {
  const registry = new Map<string, ActionDefinition>();

  // Register all @flowlib/core builtin actions
  for (const action of allBuiltinActions) {
    registry.set(action.id, action);
  }

  // Override with primitive-specific forks (no QuickJS dependency)
  registry.set(ifElseAction.id, ifElseAction);
  registry.set(switchAction.id, switchAction);
  registry.set(javascriptAction.id, javascriptAction);
  registry.set(outputAction.id, outputAction);

  // Register any caller-supplied custom actions
  if (extraActions) {
    for (const action of extraActions) {
      registry.set(action.id, action);
    }
  }

  return registry;
}

// ─── Primary output extraction ────────────────────────────────────────────────

function extractPrimaryOutput(result: ActionResult): unknown {
  if (result.outputVariables) {
    const [first] = Object.values(result.outputVariables);
    if (first) {
      // Return the value from the first (and typically only) active variable
      return first.value;
    }
  }
  return result.output;
}

// ─── Branch skipping ──────────────────────────────────────────────────────────

function handleBranchSkipping(
  nodeRef: string,
  result: ActionResult,
  edges: PrimitiveEdge[],
  skipSet: Set<string>,
): void {
  if (!result.outputVariables || Object.keys(result.outputVariables).length === 0) {
    return;
  }

  const activeHandles = new Set(Object.keys(result.outputVariables));

  for (const edge of edges) {
    if (edgeSource(edge) !== nodeRef) {
      continue;
    }
    const sourceHandle = edgeHandle(edge);
    // If this edge has a source handle that isn't in the active set, the target branch is inactive
    if (sourceHandle && !activeHandles.has(sourceHandle)) {
      markSkipped(edgeTarget(edge), edges, skipSet, true);
    }
  }
}

function markSkipped(
  nodeRef: string,
  edges: PrimitiveEdge[],
  skipSet: Set<string>,
  force: boolean,
): void {
  if (skipSet.has(nodeRef)) {
    return;
  }

  if (!force) {
    // Only skip if ALL incoming edges come from already-skipped nodes
    const incoming = edges.filter((e) => edgeTarget(e) === nodeRef);
    if (incoming.length === 0 || !incoming.every((e) => skipSet.has(edgeSource(e)))) {
      return;
    }
  }

  skipSet.add(nodeRef);

  // Recursively check downstream nodes
  for (const edge of edges) {
    if (edgeSource(edge) === nodeRef) {
      markSkipped(edgeTarget(edge), edges, skipSet, false);
    }
  }
}

// ─── Output node detection ────────────────────────────────────────────────────

// ─── Flow runner ──────────────────────────────────────────────────────────────

export function createFlowRunner(config: FlowRunnerConfig = {}): FlowRunner {
  const registry = buildRegistry(config.actions);
  const adapter = config.adapter ?? new InMemoryAdapter();

  return {
    async run(
      definition: PrimitiveFlowDefinition,
      inputs: Record<string, unknown> = {},
    ): Promise<FlowRunResult> {
      validateFlow(definition);

      const sortedIds = topologicalSort(definition.nodes, definition.edges);
      const nodeMap = new Map(definition.nodes.map((n) => [n.referenceId, n]));

      const completedOutputs: Record<string, unknown> = {};
      const skipSet = new Set<string>();
      const flowOutputs: Record<string, unknown> = {};

      // Synthetic run ID — satisfies BatchRequest.flowRunId contract
      const flowRunId = crypto.randomUUID();

      const logger = new BaseLogger({ level: 'info' });

      for (const nodeRef of sortedIds) {
        const node = nodeMap.get(nodeRef);
        if (!node) {
          throw new Error(`Internal: node "${nodeRef}" missing from nodeMap after topo sort`);
        }

        // Skip nodes on inactive branches
        if (skipSet.has(nodeRef)) {
          logger.debug(`Skipping node "${nodeRef}" (inactive branch)`);
          continue;
        }

        // Build context from upstream outputs
        let ctx = buildNodeContext(nodeRef, definition.edges, completedOutputs);

        // Apply optional mapper — reshapes context before param resolution
        if (node.mapper) {
          ctx = await node.mapper(ctx);
        }

        // Resolve callable params with the (possibly mapped) context
        const resolvedParams = await resolveCallableParams(
          node.params as Record<string, unknown>,
          ctx,
        );

        // Execute inside a durability step
        let result: ActionResult;
        try {
          result = await adapter.step(nodeRef, async () => {
            const actionResult = await executeNodeAction({
              node,
              resolvedCtx: ctx,
              resolvedParams,
              config,
              flowRunId,
              flowInputs: inputs,
              registry,
            });

            // Batch processing: intercept __batchSubmitted and schedule collect
            if (actionResult.metadata?.__batchSubmitted) {
              const batchJobId = actionResult.metadata.batchJobId as string;
              return adapter.step(`${nodeRef}:collect`, async () => {
                if (!config.submitPrompt) {
                  throw new Error('submitPrompt is required for batch processing');
                }
                throw new Error(
                  `Batch polling not implemented for batchJobId: ${batchJobId}. ` +
                    `Provide a custom submitPrompt that handles batch result retrieval.`,
                );
              });
            }

            return actionResult;
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.error(`Node "${nodeRef}" failed: ${message}`);
          return {
            status: 'failed',
            outputs: flowOutputs,
            nodeOutputs: completedOutputs,
            error: { nodeId: nodeRef, message },
          };
        }

        if (!result.success) {
          const message = result.error ?? 'Action returned success: false';
          logger.error(`Node "${nodeRef}" returned failure: ${message}`);
          return {
            status: 'failed',
            outputs: flowOutputs,
            nodeOutputs: completedOutputs,
            error: { nodeId: nodeRef, message },
          };
        }

        // Extract primary output value for downstream context
        const primaryOutput = extractPrimaryOutput(result);
        completedOutputs[nodeRef] = primaryOutput;

        // Collect output node values
        if (OUTPUT_NODE_TYPES.has(node.type)) {
          const outputName = (result.metadata?.outputName as string | undefined) ?? nodeRef;
          flowOutputs[outputName] = primaryOutput;
        }

        // Update branch skipping state
        handleBranchSkipping(nodeRef, result, definition.edges, skipSet);
      }

      return {
        status: 'success',
        outputs: flowOutputs,
        nodeOutputs: completedOutputs,
      };
    },
  };
}
