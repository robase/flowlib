/**
 * Structural interfaces for the flow graph types an action sees via
 * `ActionExecutionContext.flowRunState`. Concrete Zod-backed types in
 * `@flowlib/core` are structurally compatible.
 */

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  metadata?: Record<string, unknown>;
}

export interface FlowNodeDefinitions {
  id: string;
  type: string;
  referenceId?: string;
  label?: string;
  params: Record<string, unknown>;
  // Permissive for structural compat with core's Zod-inferred type.
  [key: string]: unknown;
}
