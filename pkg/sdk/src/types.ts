/**
 * Public SDK types.
 *
 * These are the shapes authored flow files produce and the serializer/runtime
 * consumes. Re-exports the canonical node shape from `@flowlib/action-kit` and
 * adds edge + flow-definition shapes on top.
 */

import type { SdkFlowNode, NodeOptions, MapperOptions } from '@flowlib/action-kit';

export type { SdkFlowNode, NodeOptions, MapperOptions };

/**
 * Edge shape — `{ from, to, handle? }`.
 *
 * Tuple form (`[from, to]` / `[from, to, handle]`) was removed in the
 * Phase 6 type-safety pass. Use the `edge(from, to, handle?)` helper for
 * programmatic construction; hand-author flows write the object literal
 * directly.
 */
export interface SdkEdgeObject {
  from: string;
  to: string;
  /** Source-handle for multi-output nodes (e.g. `true_output`, case slugs). */
  handle?: string;
}

export type SdkEdge = SdkEdgeObject;

/**
 * Accept either referenceId strings or the `SdkFlowNode` objects helpers
 * produce — `from: inputNode` works the same as `from: 'input_ref'`.
 */
export type EdgeEndpoint = string | SdkFlowNode;

/**
 * Flow definition as authored in a `.flow.ts` file or emitted from the DB.
 * This is the shape `defineFlow()` accepts.
 */
export interface SdkFlowDefinition {
  /** Display name — surfaces in the UI and as the DB metadata. */
  name?: string;
  /** Optional short description. */
  description?: string;
  /** Optional tags for categorisation. */
  tags?: string[];
  /** Ordered node list. */
  nodes: SdkFlowNode[];
  /** Edges linking node referenceIds. */
  edges: SdkEdge[];
}

// ═══════════════════════════════════════════════════════════════════════════
// Named-record form (Phase 3) — keys are referenceIds, edges narrow against
// `keyof N` and source nodes' declared output handles.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Extract the declared output-handle union from an `SdkFlowNode<R, T, H>`.
 * Falls back to `'output'` (the default single-output handle id).
 */
type HandlesOf<T> = T extends SdkFlowNode<infer _R, infer _T, infer H> ? H : 'output';

/**
 * Discriminated union of all valid edges in a named-record flow:
 *
 *   - `from` is constrained to `keyof N`.
 *   - `to` is constrained to `keyof N` excluding `from` (no self-loops —
 *     loops in flows go through a separate node).
 *   - `handle` is narrowed to the source node's declared output union.
 *
 * Usage emerges from `defineFlow({ nodes: { event: ..., classify: ... }, edges: [...] })`:
 *
 *   ```ts
 *   { from: 'classify', to: 'log', handle: 'true_output' }   // ✓
 *   { from: 'classify', to: 'log', handle: 'output' }        // ✗ ts error
 *   { from: 'evnt',     to: 'log' }                          // ✗ unknown ref
 *   { from: 'event',    to: 'event' }                        // ✗ self-loop
 *   ```
 */
export type EdgeOf<N extends Record<string, SdkFlowNode>> = {
  [K in keyof N & string]: {
    from: K;
    to: Exclude<keyof N & string, K>;
    handle?: HandlesOf<N[K]>;
  };
}[keyof N & string];

/**
 * Named-record form of `SdkFlowDefinition`. Keys are referenceIds; edges
 * narrow against `EdgeOf<N>`.
 *
 * `defineFlow()` accepts both this form and the legacy array form (see
 * `SdkFlowDefinition`). New authoring should prefer the named form — it
 * gives type-safe edges, hover-clean LLM authoring, and catches typos at
 * compile time.
 */
export interface SdkFlowDefinitionNamed<N extends Record<string, SdkFlowNode>> {
  /** Display name — surfaces in the UI and as the DB metadata. */
  name?: string;
  /** Optional short description. */
  description?: string;
  /** Optional tags for categorisation. */
  tags?: string[];
  /** Named nodes — each key is the node's referenceId. */
  nodes: N;
  /** Edges linking node referenceIds. */
  edges: ReadonlyArray<EdgeOf<N>>;
}

/**
 * Edge resolved into canonical form — all endpoints are strings, handles are
 * explicit `sourceHandle` properties. This is the shape the runtime + emitter
 * consume internally.
 */
export interface ResolvedEdge {
  from: string;
  to: string;
  sourceHandle?: string;
}
