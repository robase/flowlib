/**
 * Merge a parsed SDK flow definition into a prior DB definition.
 *
 * The parse/emit cycle loses information that authoring sources don't carry:
 * opaque DB node `id`s, canvas `position`s, agent-tool `instanceId`s. Without
 * a merge pass, every edit churns those fields — breaking edge references,
 * flow-run metadata links, chat history node pointers, and the user's
 * carefully-arranged canvas layout.
 *
 * The merge step matches parsed nodes against the prior DB definition by
 * `referenceId` and preserves:
 *   - DB `id` (fallback: generate a new stable id for truly new nodes)
 *   - `position` (unless the parsed node explicitly supplies one)
 *   - `label` (unless the parsed node explicitly supplies one)
 *   - agent `addedTools[].instanceId` (matched by `toolId + name + description`
 *     order, so renamed-in-place tools keep their instance)
 *
 * Edges are reconstructed from scratch (cheap — they're just referenceId
 * pointers) using the parsed referenceIds and resolved to the merged DB ids.
 *
 * Inputs:
 *   - `parsed`: what the parser/eval step produced — `SdkFlowNode[]` +
 *     resolved edges (`{ from, to, sourceHandle? }`).
 *   - `prior`: the DB definition this flow was just at, used for id/position/
 *     instanceId preservation. Pass `null` for a brand-new flow.
 *
 * Output: a canonical `DbFlowDefinition` ready to hand to
 * `flowlib.versions.create()`.
 */

import type { SdkFlowNode, ResolvedEdge } from '../types';
import type { DbFlowDefinition, DbFlowNode, DbFlowEdge, DbFlowMetadata } from '../emitter/types';

export interface MergeInput {
  nodes: SdkFlowNode[];
  edges: ResolvedEdge[];
  metadata?: DbFlowMetadata;
}

export interface MergeOptions {
  /**
   * ID generator for truly-new nodes (no match by referenceId in the prior
   * definition). Defaults to `node_<random-8-chars>`.
   */
  newNodeId?: (referenceId: string) => string;
  /**
   * ID generator for new edges. Defaults to `edge_<random-8-chars>`.
   */
  newEdgeId?: () => string;
  /**
   * Instance-id generator for newly added agent tools. Defaults to
   * `tool_<random-8-chars>` — matching the canonical `newToolInstanceId`
   * format from `@flowlib/action-kit` but without the dep.
   */
  newToolInstanceId?: () => string;
}

const DEFAULT_NEW_NODE_ID = (): string => `node_${randomToken(8)}`;
const DEFAULT_NEW_EDGE_ID = (): string => `edge_${randomToken(8)}`;
const DEFAULT_NEW_TOOL_INSTANCE_ID = (): string => `tool_${randomToken(8)}`;

export function mergeParsedIntoDefinition(
  parsed: MergeInput,
  prior: DbFlowDefinition | null,
  options: MergeOptions = {},
): DbFlowDefinition {
  const newNodeId = options.newNodeId ?? DEFAULT_NEW_NODE_ID;
  const newEdgeId = options.newEdgeId ?? DEFAULT_NEW_EDGE_ID;
  const newToolInstanceId = options.newToolInstanceId ?? DEFAULT_NEW_TOOL_INSTANCE_ID;

  const priorByRef = new Map<string, DbFlowNode>();
  if (prior) {
    for (const n of prior.nodes) {
      const ref = n.referenceId ?? n.id;
      priorByRef.set(ref, n);
    }
  }

  // Merge each parsed node against its prior counterpart.
  const mergedNodes: DbFlowNode[] = parsed.nodes.map((parsedNode) => {
    const ref = parsedNode.referenceId;
    const priorNode = priorByRef.get(ref);

    const merged: DbFlowNode = {
      id: parsedNode.id ?? priorNode?.id ?? newNodeId(ref),
      type: parsedNode.type,
      referenceId: ref,
      params: mergeParams(parsedNode.type, parsedNode.params, priorNode?.params, {
        newToolInstanceId,
      }),
    };

    // Label: parsed wins, else prior, else undefined.
    if (parsedNode.label !== undefined) {
      merged.label = parsedNode.label;
    } else if (priorNode?.label !== undefined) {
      merged.label = priorNode.label;
    }

    // Position: parsed wins, else prior, else undefined.
    if (parsedNode.position !== undefined) {
      merged.position = parsedNode.position;
    } else if (priorNode?.position !== undefined) {
      merged.position = priorNode.position;
    }

    // Mapper: parsed wins; falls back to prior only when parsed omitted.
    if (parsedNode.mapper !== undefined) {
      merged.mapper = parsedNode.mapper;
    } else if (priorNode?.mapper !== undefined) {
      merged.mapper = priorNode.mapper;
    }

    return merged;
  });

  // Resolve edge endpoints: parsed edges reference `referenceId`s; the DB
  // stores node `id`s, so rewrite.
  const nodeIdByRef = new Map(mergedNodes.map((n) => [n.referenceId ?? n.id, n.id]));
  const mergedEdges: DbFlowEdge[] = parsed.edges.map((e) => {
    const sourceId = nodeIdByRef.get(e.from);
    const targetId = nodeIdByRef.get(e.to);
    if (!sourceId || !targetId) {
      throw new Error(
        `mergeParsedIntoDefinition: edge references missing node (from="${e.from}", to="${e.to}")`,
      );
    }
    const edge: DbFlowEdge = {
      id: newEdgeId(),
      source: sourceId,
      target: targetId,
    };
    if (e.sourceHandle !== undefined) {
      edge.sourceHandle = e.sourceHandle;
    }
    return edge;
  });

  const metadata = parsed.metadata ?? prior?.metadata;

  return {
    nodes: mergedNodes,
    edges: mergedEdges,
    ...(metadata ? { metadata } : {}),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Params merge — agent addedTools need instance-id preservation
// ═══════════════════════════════════════════════════════════════════════════

interface AddedTool {
  instanceId: string;
  toolId: string;
  name: string;
  description: string;
  params: Record<string, unknown>;
  [key: string]: unknown;
}

function mergeParams(
  nodeType: string,
  parsedParams: Record<string, unknown>,
  priorParams: Record<string, unknown> | undefined,
  opts: { newToolInstanceId: () => string },
): Record<string, unknown> {
  // Only agent nodes need special handling (addedTools instanceId
  // preservation). Run the tool-match pass whether or not there's a prior
  // definition — with no prior, every parsed tool is "new" and needs a
  // fresh instanceId (the `tool()` helper doesn't assign one).
  if (nodeType !== 'core.agent') {
    return parsedParams;
  }

  const parsedTools = Array.isArray(parsedParams.addedTools)
    ? (parsedParams.addedTools as AddedTool[])
    : null;
  if (!parsedTools) {
    return parsedParams;
  }

  const priorTools =
    priorParams && Array.isArray(priorParams.addedTools)
      ? (priorParams.addedTools as AddedTool[])
      : [];

  const merged = { ...parsedParams };
  merged.addedTools = matchToolInstanceIds(parsedTools, priorTools, opts.newToolInstanceId);
  return merged;
}

/**
 * Match parsed tool instances against prior tool instances to preserve
 * `instanceId`s.
 *
 * Strategy: walk parsed tools in order, for each one find the earliest
 * unclaimed prior tool that matches on `toolId + name + description`. If
 * found, reuse its `instanceId`; otherwise generate a fresh one.
 *
 * This handles the common edit patterns:
 *   - Renaming / changing description keeps position-based matching when
 *     `toolId` alone still matches (secondary key below).
 *   - Adding / removing tools only disturbs the tools that actually changed.
 */
function matchToolInstanceIds(
  parsed: AddedTool[],
  prior: AddedTool[],
  newInstanceId: () => string,
): AddedTool[] {
  const claimed = new Set<number>();

  const findMatch = (p: AddedTool, useSecondary: boolean): number => {
    for (let i = 0; i < prior.length; i++) {
      if (claimed.has(i)) {
        continue;
      }
      const q = prior[i];
      if (useSecondary) {
        // Secondary match: toolId only (allows rename/redescribe).
        if (q.toolId === p.toolId) {
          return i;
        }
      } else {
        // Primary match: toolId + name + description.
        if (q.toolId === p.toolId && q.name === p.name && q.description === p.description) {
          return i;
        }
      }
    }
    return -1;
  };

  // First pass — primary-match (exact) claim
  const primary = parsed.map((p) => findMatch(p, false));
  primary.forEach((idx) => {
    if (idx !== -1) {
      claimed.add(idx);
    }
  });

  // Second pass — any unmatched parsed tool tries secondary match (toolId only)
  return parsed.map((p, i) => {
    let idx = primary[i];
    if (idx === -1) {
      idx = findMatch(p, true);
      if (idx !== -1) {
        claimed.add(idx);
      }
    }
    // Unmatched parsed tools get a fresh instanceId. `??` falls back only on
    // null/undefined — also treat empty string as "no id" since the emitter
    // strips instanceIds, so parsed tools typically come back with either no
    // instanceId field or an empty string placeholder.
    const instanceId =
      idx === -1
        ? p.instanceId && p.instanceId.length > 0
          ? p.instanceId
          : newInstanceId()
        : prior[idx].instanceId;
    return { ...p, instanceId };
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Random id generation (base62) — small, dep-free
// ═══════════════════════════════════════════════════════════════════════════

const BASE62 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function randomToken(n: number): string {
  let out = '';
  for (let i = 0; i < n; i++) {
    out += BASE62.charAt(Math.floor(Math.random() * BASE62.length));
  }
  return out;
}
