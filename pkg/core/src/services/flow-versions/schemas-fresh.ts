import { z } from 'zod/v4';
import { metadataSchema } from 'src/types.internal';

// =============================================================================
// LOOP CONFIGURATION SCHEMA
// Generic loop-over capability for any node that accepts input
// =============================================================================

/**
// =============================================================================
// MAPPER CONFIGURATION SCHEMA
// Per-node data mapper — sandboxed JS expression that reshapes upstream data.
// If the mapper returns an array, the node auto-iterates over each item.
// Replaces _loop (will be removed in a future phase).
// =============================================================================

/**
 * Mapper configuration schema for nodes.
 * When enabled, the JS expression runs against incoming upstream data.
 * Use `return` for multi-statement code; single expressions auto-return.
 */
export const mapperConfigSchema = z
  .object({
    /** Whether the mapper is enabled for this node. */
    enabled: z.boolean().default(false),

    /**
     * JS expression that receives all upstream outputs as local variables.
     * Executed in a sandboxed QuickJS runtime. Use `return` to produce a value.
     * Single expressions (no `return` keyword) auto-return.
     *
     * @example
     * // Pass array → node iterates per item:
     * "users"
     *
     * // Filter then iterate:
     * "users.filter(u => u.active)"
     *
     * // Multi-statement with explicit return:
     * "const active = users.filter(u => u.active);\nreturn active.map(u => ({ ...u, rank: 1 }));"
     *
     * // Reshape into object → single run:
     * "return { total: orders.reduce((s, o) => s + o.amount, 0), count: orders.length }"
     */
    expression: z.string(),

    /**
     * Explicit intent declaration — prevents accidental iteration.
     * - "auto"    (default): infer from return type (array → iterate, object → single)
     * - "iterate": assert the result is an array, fail if not
     * - "reshape": assert the result is NOT an array (wrap in object if it is), single run
     */
    mode: z.enum(['auto', 'iterate', 'reshape']).default('auto'),

    /**
     * How to combine iteration results when mapper returns an array.
     * - "array"  (default): collect all outputs into [result1, result2, ...]
     * - "object": build { keyField: result } using a field as key
     * - "first":  return only the first iteration's output
     * - "last":   return only the last iteration's output
     * - "concat": join all string outputs
     */
    outputMode: z.enum(['array', 'object', 'first', 'last', 'concat']).default('array'),

    /** For outputMode "object": the field path in each result to use as key. */
    keyField: z.string().optional(),

    /** Max parallel iterations (1 = sequential). Only applies when mapper returns array. */
    concurrency: z.number().int().min(1).max(50).default(1),

    /**
     * Behavior when mapper returns an empty array.
     * - "skip":   produce empty output, don't fail (default)
     * - "error":  fail the node
     */
    onEmpty: z.enum(['error', 'skip']).default('skip'),
  })
  .check(
    z.refine((data) => !data.enabled || data.expression.length >= 1, {
      message: 'Expression is required when mapper is enabled',
      path: ['expression'],
    }),
  );

export type MapperConfig = z.infer<typeof mapperConfigSchema>;

const baseNodeSchema = z.object({
  id: z.string().min(1, 'Node ID is required'),
  position: z
    .object({
      x: z.number(),
      y: z.number(),
    })
    .optional(),
  label: z.string().optional(),
  referenceId: z.string().optional(), // snake_case unique identifier for input mapping
  /**
   * @deprecated Ignored at runtime. Use `mapper` instead. Kept for backward
   *             compatibility so existing stored flow definitions still parse.
   */
  _loop: z.unknown().optional(),
  /**
   * Data mapper — sandboxed JS expression that reshapes upstream data
   * before the node executes. If the expression returns an array, the node
   * auto-iterates over each element.
   */
  mapper: mapperConfigSchema.optional(),
});

// =============================================================================
// NODE PARAMS SCHEMA
// All nodes use a flexible params schema - validation happens at runtime
// based on each node's paramFields in getDefinition()
// =============================================================================

/**
 * Flexible params schema that accepts any key-value pairs.
 * Each node executor validates its own params at runtime using its paramFields definition.
 * This allows the schema to be extensible without code changes when adding new nodes.
 */
const flexibleParamsSchema = z.record(z.string(), z.unknown()).default({});

// =============================================================================
// FLOW NODE DEFINITIONS
// =============================================================================

/**
 * Flow node schema.
 *
 * All nodes share the same base shape with a flexible params record.
 * The `type` field is an action ID (e.g. "core.model", "gmail.send_message").
 *
 * Runtime validation of params is handled by each node executor /
 * action definition via its `paramFields`.
 */
export const flowNodeDefinitionsSchema = baseNodeSchema.extend({
  type: z.string().min(1, 'Node type is required'),
  params: flexibleParamsSchema,
});

export type FlowNodeDefinitions = z.infer<typeof flowNodeDefinitionsSchema>;

/**
 * Extract a flow-node sub-type.
 *
 * With the move to action-based node types the schema is no longer a
 * discriminated union, so this resolves to the base FlowNodeDefinitions
 * for every `TNodeType`.
 */
export type FlowNodeForType<_TNodeType extends string> = FlowNodeDefinitions;

export const flowEdgeSchema = z.object({
  id: z.string().min(1, 'Edge ID is required'),
  source: z.string().min(1, 'Edge source is required'),
  target: z.string().min(1, 'Edge target is required'),
  sourceHandle: z.string().optional(),
  targetHandle: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type FlowEdge = z.infer<typeof flowEdgeSchema>;

export const flowlibDefinitionSchema = z.object({
  nodes: z.array(flowNodeDefinitionsSchema),
  edges: z.array(flowEdgeSchema),
  metadata: metadataSchema.optional(),
});

export type FlowlibDefinition = z.infer<typeof flowlibDefinitionSchema>;

// Runtime type alias for flow definitions stored in database
export type FlowlibDefinitionRuntime = FlowlibDefinition;

export const createFlowVersionRequestSchema = z.object({
  flowlibDefinition: flowlibDefinitionSchema,
});

export type CreateFlowVersionRequest = z.infer<typeof createFlowVersionRequestSchema>;
