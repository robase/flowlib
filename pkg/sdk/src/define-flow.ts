/**
 * `defineFlow` — the canonical authoring entry point.
 *
 * Accepts an author-friendly flow definition in either form:
 *
 *   1. **Named-record form** (preferred): `nodes: { ref: helper(...) }`. Keys
 *      are referenceIds; edges are typed via `EdgeOf<N>` so `from`/`to`
 *      narrow against `keyof N` and `handle` narrows against the source
 *      node's declared output handles.
 *   2. **Array form** (legacy): `nodes: [helper('ref', ...)]`. Each helper
 *      carries its own referenceId. Edges are plain `{ from, to, handle? }`.
 *
 * Validates basic structural rules:
 *   - empty arrays are allowed (represents a blank flow)
 *   - unique referenceIds
 *   - edges reference existing nodes
 *
 * Does NOT mutate the input. Returns the definition as-is with edges
 * normalized so downstream consumers (emitter, runtime, save pipeline) can
 * iterate uniformly.
 *
 * Node IDs, canvas positions, mapper string-to-arrow conversions, and the
 * referenceId-match merge against a prior DB version are all handled by the
 * *save* pipeline — `defineFlow` is a pure function that just validates shape.
 */

import type { SdkFlowDefinition, SdkFlowDefinitionNamed, SdkFlowNode, ResolvedEdge } from './types';
import { resolveEdge } from './edge';

export class FlowValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FlowValidationError';
  }
}

/** Result type — same as input, but with edges guaranteed in canonical form. */
export interface DefinedFlow {
  name?: string;
  description?: string;
  tags?: string[];
  nodes: SdkFlowNode[];
  edges: ResolvedEdge[];
}

// Overloads — named form first so editor inference prefers it.
export function defineFlow<const N extends Record<string, SdkFlowNode>>(
  def: SdkFlowDefinitionNamed<N>,
): DefinedFlow;
export function defineFlow(def: SdkFlowDefinition): DefinedFlow;
export function defineFlow(
  def: SdkFlowDefinition | SdkFlowDefinitionNamed<Record<string, SdkFlowNode>>,
): DefinedFlow {
  // Normalize: named-record → array form. The key becomes the node's
  // referenceId, overwriting whatever the helper produced (helpers called
  // without a positional ref leave `referenceId` empty, by convention).
  const arrayDef: SdkFlowDefinition = isNamedForm(def)
    ? {
        ...(def.name !== undefined ? { name: def.name } : {}),
        ...(def.description !== undefined ? { description: def.description } : {}),
        ...(def.tags !== undefined ? { tags: def.tags } : {}),
        nodes: Object.entries(def.nodes).map(([key, node]) => ({
          ...node,
          referenceId: key,
        })),
        edges: [...def.edges] as SdkFlowDefinition['edges'],
      }
    : def;

  validateStructure(arrayDef);

  const nodes = arrayDef.nodes;
  const resolvedEdges = arrayDef.edges.map(resolveEdge);
  // Lenient mode: drop edges that reference unknown nodes instead of
  // throwing. Used by editor / preview environments (e.g. the VSCode
  // extension) where mid-edit flows are routinely structurally
  // invalid — we'd rather render the partial graph than show a hard
  // error. Production servers leave this off so bad flows fail loudly.
  const lenient = isLenient();
  const edges = lenient ? filterValidEdges(resolvedEdges, nodes) : resolvedEdges;
  if (!lenient) {
    validateEdgeRefs(edges, nodes);
  }

  return {
    ...(arrayDef.name !== undefined ? { name: arrayDef.name } : {}),
    ...(arrayDef.description !== undefined ? { description: arrayDef.description } : {}),
    ...(arrayDef.tags !== undefined ? { tags: arrayDef.tags } : {}),
    nodes,
    edges,
  };
}

/**
 * Discriminate named-record form from array form. Records have non-array
 * `nodes`; the named form does not allow `nodes` to be missing.
 */
function isNamedForm(
  def: SdkFlowDefinition | SdkFlowDefinitionNamed<Record<string, SdkFlowNode>>,
): def is SdkFlowDefinitionNamed<Record<string, SdkFlowNode>> {
  return !Array.isArray(def.nodes) && typeof def.nodes === 'object' && def.nodes !== null;
}

function isLenient(): boolean {
  // Process env is the simplest opt-in. The VSCode extension sets
  // this on activation; the SDK's evaluator + jiti load this module
  // in the same process so the flag is visible.
  return (
    typeof process !== 'undefined' &&
    typeof process.env !== 'undefined' &&
    process.env.FLOWLIB_SDK_LENIENT === '1'
  );
}

function filterValidEdges(edges: ResolvedEdge[], nodes: SdkFlowNode[]): ResolvedEdge[] {
  const refs = new Set(nodes.map((n) => n.referenceId));
  const valid: ResolvedEdge[] = [];
  for (const edge of edges) {
    const fromOk = refs.has(edge.from);
    const toOk = refs.has(edge.to);
    if (!fromOk || !toOk) {
      // eslint-disable-next-line no-console
      console.warn(
        `defineFlow (lenient): dropping edge ${edge.from} → ${edge.to} (` +
          (!fromOk ? `unknown source "${edge.from}"` : `unknown target "${edge.to}"`) +
          ')',
      );
      continue;
    }
    valid.push(edge);
  }
  return valid;
}

function validateStructure(def: SdkFlowDefinition): void {
  if (!Array.isArray(def.nodes)) {
    throw new FlowValidationError('defineFlow: `nodes` must be an array');
  }
  if (!Array.isArray(def.edges)) {
    throw new FlowValidationError('defineFlow: `edges` must be an array');
  }

  const seenRefs = new Set<string>();
  for (const node of def.nodes) {
    if (typeof node.referenceId !== 'string' || node.referenceId.length === 0) {
      throw new FlowValidationError(
        `defineFlow: every node must have a non-empty referenceId (node type: "${node.type}")`,
      );
    }
    if (seenRefs.has(node.referenceId)) {
      throw new FlowValidationError(`defineFlow: duplicate referenceId "${node.referenceId}"`);
    }
    seenRefs.add(node.referenceId);
  }
}

function validateEdgeRefs(edges: ResolvedEdge[], nodes: SdkFlowNode[]): void {
  const refs = new Set(nodes.map((n) => n.referenceId));
  for (const edge of edges) {
    if (!refs.has(edge.from)) {
      throw new FlowValidationError(
        `defineFlow: edge references unknown source "${edge.from}". Known referenceIds: ${[...refs].join(', ')}`,
      );
    }
    if (!refs.has(edge.to)) {
      throw new FlowValidationError(
        `defineFlow: edge references unknown target "${edge.to}". Known referenceIds: ${[...refs].join(', ')}`,
      );
    }
  }
}
