import { BaseLogger, DirectEvaluator } from '@flowlib/core';
import { allProviderActions as allBuiltinActions } from '@flowlib/actions';
import type { ActionDefinition, ActionExecutionContext, ActionResult } from '@flowlib/action-kit';
import {
  buildNodeContext,
  resolveCallableParams,
  executeNodeAction,
  ifElseAction,
  switchAction,
  javascriptAction,
  outputAction,
} from '@flowlib/primitives';
import type { FlowRunnerConfig, PrimitiveFlowDefinition } from '@flowlib/primitives';

// Build an action registry matching createFlowRunner's behavior:
// core builtins, then primitive forks, then user-supplied actions.
function buildRegistry(extraActions?: ActionDefinition[]): Map<string, ActionDefinition> {
  const registry = new Map<string, ActionDefinition>();
  for (const action of allBuiltinActions) {
    registry.set(action.id, action);
  }
  registry.set(ifElseAction.id, ifElseAction);
  registry.set(switchAction.id, switchAction);
  registry.set(javascriptAction.id, javascriptAction);
  registry.set(outputAction.id, outputAction);
  if (extraActions) {
    for (const action of extraActions) {
      registry.set(action.id, action);
    }
  }
  return registry;
}

export interface StepRuntimeArgs {
  flow: PrimitiveFlowDefinition;
  nodeRef: string;
  completedOutputs: Record<string, unknown>;
  inputs: Record<string, unknown>;
  flowRunId: string;
  config: FlowRunnerConfig;
}

// Executes a single flow node. Intended to be called from inside a "use step"
// function body, so the result is durably persisted and cached on replay.
//
// Each call builds a fresh registry — cheap (map insert per action) and avoids
// cross-invocation state in serverless contexts.
export async function executeStep(args: StepRuntimeArgs): Promise<ActionResult> {
  const { flow, nodeRef, completedOutputs, inputs, flowRunId, config } = args;

  const node = flow.nodes.find((n) => n.referenceId === nodeRef);
  if (!node) {
    throw new Error(`executeStep: node "${nodeRef}" not found in flow`);
  }

  const registry = buildRegistry(config.actions);

  // Vercel Workflow bundles run in an edge-like sandbox where the QuickJS WASM
  // default is heavy and unnecessary — the host already isolates per-step. Fall
  // back to DirectEvaluator when the caller hasn't supplied one explicitly.
  const resolvedConfig: FlowRunnerConfig = {
    ...config,
    jsEvaluator: config.jsEvaluator ?? new DirectEvaluator(),
  };

  let ctx = buildNodeContext(nodeRef, flow.edges, completedOutputs);
  if (node.mapper) {
    ctx = await node.mapper(ctx);
  }

  const resolvedParams = await resolveCallableParams(node.params as Record<string, unknown>, ctx);

  return executeNodeAction({
    node,
    resolvedCtx: ctx,
    resolvedParams,
    config: resolvedConfig,
    flowRunId,
    flowInputs: inputs,
    registry,
  });
}

// Re-export so generated files can construct the ActionExecutionContext type
// without depending directly on @flowlib/core.
export type { ActionExecutionContext, ActionResult, BaseLogger };
