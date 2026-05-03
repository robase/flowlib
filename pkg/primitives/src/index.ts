// ─── Types ────────────────────────────────────────────────────────────────────
export type {
  NodeContext,
  ParamValue,
  PrimitiveNode,
  PrimitiveEdge,
  PrimitiveEdgeObject,
  PrimitiveFlowDefinition,
  FlowRunResult,
  StepOptions,
  DurabilityAdapter,
  FlowRunnerConfig,
  FlowRunner,
} from './types';
export { WaitTimeoutError, edgeSource, edgeTarget, edgeHandle } from './types';

// ─── Validation ───────────────────────────────────────────────────────────────
export { validateFlow, FlowValidationError } from './validate';

// ─── Graph ────────────────────────────────────────────────────────────────────
export { topologicalSort } from './graph';

// ─── Primitive actions ────────────────────────────────────────────────────────
export { ifElseAction } from './actions/if-else';
export { switchAction } from './actions/switch';
export { javascriptAction } from './actions/javascript';
export { outputAction } from './actions/output';

// ─── Helpers / builders ───────────────────────────────────────────────────────
export {
  defineFlow,
  triggerManual,
  output,
  model,
  ifElse,
  switchNode,
  agent,
  tool,
  code,
  javascript,
  node,
  edge,
} from './helpers';
export type { ManualTriggerInputDef } from './helpers';
export type { ToolInstance } from './helpers';

// ─── Executor ─────────────────────────────────────────────────────────────────
export { createFlowRunner, InMemoryAdapter } from './flow-executor';
export { resolveCallableParams, executeNodeAction } from './action-executor';
export { buildNodeContext } from './node-context';

// ─── Prompt client ────────────────────────────────────────────────────────────
export { createFetchPromptClient } from './fetch-prompt';
export type { FetchPromptClientOptions } from './fetch-prompt';

// ─── Node-type aliases (core.X ⇄ primitives.X) ────────────────────────────────
export {
  TRIGGER_MANUAL_TYPES,
  OUTPUT_TYPES,
  MODEL_TYPES,
  JAVASCRIPT_TYPES,
  IF_ELSE_TYPES,
  SWITCH_TYPES,
  AGENT_TYPES,
  ALL_PRIMITIVE_TYPES,
  isTriggerManualType,
  isOutputType,
  isModelType,
  isJavascriptType,
  isIfElseType,
  isSwitchType,
  isAgentType,
} from './node-types';
