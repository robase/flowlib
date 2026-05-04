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

/**
 * The persisted flow definition shape — what a flow_versions row's
 * `flowlib_definition` column holds. The concrete Zod schema lives in
 * `@flowlib/core`'s flow-versions service; this interface is the
 * structural twin used by the dialect schema files (for `$type<>()`
 * annotations) and by any external consumer that needs the type
 * without pulling in `@flowlib/core`.
 */
export interface FlowlibDefinition {
  nodes: FlowNodeDefinitions[];
  edges: FlowEdge[];
  metadata?: Record<string, unknown>;
}

/**
 * Runtime alias kept for back-compat with code that referenced
 * `FlowlibDefinitionRuntime` from `@flowlib/core`. Same shape as
 * `FlowlibDefinition`.
 */
export type FlowlibDefinitionRuntime = FlowlibDefinition;
