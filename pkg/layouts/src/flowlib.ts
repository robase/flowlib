/**
 * Flowlib Layout Implementation
 *
 * An opinionated hierarchical layout tailored to Flowlib flows. Uses ELK's
 * `layered` algorithm as the base placer with Flowlib-specific pre/post-processing:
 *
 *   1. Compute each node's "reserved" footprint (card + any attached appendix
 *      like the agent tools box) so ELK allocates space for the appendix.
 *   2. Attach source ports in the node's declared handle order (switch cases
 *      by slug, if-else as [true_output, false_output]) so FIXED_ORDER port
 *      constraints keep branch targets stacked in the order the card renders.
 *   3. Run ELK — it handles component stacking, crossing minimization, port
 *      ordering, and edge routing natively.
 *   4. Translate ELK's reserved-box positions back to card top-left positions.
 *   5. Optional: straighten linear chains (1-in / 1-out edges) so they're
 *      visually aligned across layers.
 *   6. Snap to grid.
 */

import type { LayoutNode, LayoutEdge, LayoutHandle, ElkLayoutNode } from './types';
import { applyElkLayout, type ElkJsLayoutOptions } from './elk';

export interface FlowlibLayoutOptions {
  direction?: 'TB' | 'BT' | 'LR' | 'RL';
  /** Within-layer (perpendicular to flow) spacing between nodes. */
  nodeSpacing?: number;
  /** Between-layer (parallel to flow) spacing between ranks. */
  rankSpacing?: number;
  /** Default node width when `measured.width` is absent. */
  nodeWidth?: number;
  /** Default node height when `measured.height` is absent. */
  nodeHeight?: number;
  /** Spacing between disconnected components. */
  componentSpacing?: number;
  /** Grid size for final snapping. 0 disables snapping. */
  gridSize?: number;
  /** Post-pass: align linear (1-in / 1-out) chains to their source's center. */
  straightenChains?: boolean;
}

const DEFAULTS: Required<FlowlibLayoutOptions> = {
  direction: 'LR',
  nodeSpacing: 80,
  rankSpacing: 120,
  nodeWidth: 200,
  nodeHeight: 60,
  componentSpacing: 120,
  gridSize: 20,
  straightenChains: true,
};

// ---------------------------------------------------------------------------
// Effective node dimensions (card + appendix)
// ---------------------------------------------------------------------------

/**
 * Agent tools appendix dimensions. The tools box is a fixed-size visual panel
 * rendered adjacent to agent nodes via `NodeAppendix` (absolute-positioned, so
 * it doesn't contribute to ReactFlow's `measured` dimensions). We reserve
 * space for it here so ELK doesn't overlap it with neighboring nodes.
 */
const AGENT_TOOLS_WIDTH = 220;
const AGENT_TOOLS_HEIGHT = 170;
const AGENT_TOOLS_GAP = 16;

interface EffectiveDims {
  /** Rendered card width. */
  width: number;
  /** Rendered card height. */
  height: number;
  /** Full bounding width (card + appendix). */
  reservedWidth: number;
  /** Full bounding height (card + appendix). */
  reservedHeight: number;
  /** Card's top-left X relative to the reserved box's top-left. */
  cardOffsetX: number;
  /** Card's top-left Y relative to the reserved box's top-left. */
  cardOffsetY: number;
}

function effectiveNodeDims(node: LayoutNode, fallbackW: number, fallbackH: number): EffectiveDims {
  const cardWidth = node.measured?.width ?? node.width ?? fallbackW;
  const cardHeight = node.measured?.height ?? node.height ?? fallbackH;

  const nodeType = node.data?.type ?? node.type;
  const isAgent = nodeType === 'core.agent' || nodeType === 'primitives.agent';

  if (!isAgent) {
    return {
      width: cardWidth,
      height: cardHeight,
      reservedWidth: cardWidth,
      reservedHeight: cardHeight,
      cardOffsetX: 0,
      cardOffsetY: 0,
    };
  }

  const params = node.data?.params as { toolsPosition?: string } | undefined;
  const position = params?.toolsPosition ?? 'bottom';

  switch (position) {
    case 'top': {
      const reservedWidth = Math.max(cardWidth, AGENT_TOOLS_WIDTH);
      const reservedHeight = cardHeight + AGENT_TOOLS_GAP + AGENT_TOOLS_HEIGHT;
      return {
        width: cardWidth,
        height: cardHeight,
        reservedWidth,
        reservedHeight,
        cardOffsetX: (reservedWidth - cardWidth) / 2,
        cardOffsetY: AGENT_TOOLS_HEIGHT + AGENT_TOOLS_GAP,
      };
    }
    case 'left': {
      const reservedWidth = cardWidth + AGENT_TOOLS_GAP + AGENT_TOOLS_WIDTH;
      const reservedHeight = Math.max(cardHeight, AGENT_TOOLS_HEIGHT);
      return {
        width: cardWidth,
        height: cardHeight,
        reservedWidth,
        reservedHeight,
        cardOffsetX: AGENT_TOOLS_WIDTH + AGENT_TOOLS_GAP,
        cardOffsetY: (reservedHeight - cardHeight) / 2,
      };
    }
    case 'right': {
      const reservedWidth = cardWidth + AGENT_TOOLS_GAP + AGENT_TOOLS_WIDTH;
      const reservedHeight = Math.max(cardHeight, AGENT_TOOLS_HEIGHT);
      return {
        width: cardWidth,
        height: cardHeight,
        reservedWidth,
        reservedHeight,
        cardOffsetX: 0,
        cardOffsetY: (reservedHeight - cardHeight) / 2,
      };
    }
    case 'bottom':
    default: {
      const reservedWidth = Math.max(cardWidth, AGENT_TOOLS_WIDTH);
      const reservedHeight = cardHeight + AGENT_TOOLS_GAP + AGENT_TOOLS_HEIGHT;
      return {
        width: cardWidth,
        height: cardHeight,
        reservedWidth,
        reservedHeight,
        cardOffsetX: (reservedWidth - cardWidth) / 2,
        cardOffsetY: 0,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Declared handle order
// ---------------------------------------------------------------------------

/**
 * Resolve the declared top-to-bottom handle order for a branching node.
 *
 * For `core.switch` / `primitives.switch`: the slugs from `params.cases`
 * (in user-defined order), followed by `"default"` last — matching how the
 * switch card renders its handles visually.
 *
 * For `core.if_else` / `primitives.if_else`: `["true_output", "false_output"]`.
 *
 * Returns `undefined` for other nodes (ELK will infer handle order from edges).
 */
function resolveDeclaredHandleOrder(node: LayoutNode): string[] | undefined {
  const nodeType = node.data?.type ?? node.type;

  if (nodeType === 'core.switch' || nodeType === 'primitives.switch') {
    const params = node.data?.params as { cases?: unknown } | undefined;
    const cases = params?.cases;
    if (Array.isArray(cases)) {
      const slugs = cases
        .map((c) =>
          typeof c === 'object' && c !== null ? (c as { slug?: unknown }).slug : undefined,
        )
        .filter((s): s is string => typeof s === 'string');
      return [...slugs, 'default'];
    }
  }

  if (nodeType === 'core.if_else' || nodeType === 'primitives.if_else') {
    return ['true_output', 'false_output'];
  }

  return undefined;
}

function portSideForDirection(
  direction: FlowlibLayoutOptions['direction'],
): LayoutHandle['position'] {
  switch (direction) {
    case 'RL':
      return 'left';
    case 'TB':
      return 'bottom';
    case 'BT':
      return 'top';
    case 'LR':
    default:
      return 'right';
  }
}

function directionToElk(
  direction: FlowlibLayoutOptions['direction'],
): ElkJsLayoutOptions['direction'] {
  switch (direction) {
    case 'RL':
      return 'LEFT';
    case 'TB':
      return 'DOWN';
    case 'BT':
      return 'UP';
    case 'LR':
    default:
      return 'RIGHT';
  }
}

// ---------------------------------------------------------------------------
// Post-pass: straighten linear chains
// ---------------------------------------------------------------------------

/**
 * Align the Y of any target that forms a 1-in / 1-out edge with its source —
 * snaps linear runs to a horizontal baseline so they read as a single flow
 * line even across tall/short node boundaries.
 *
 * Operates on the position + effective-dims maps directly so it doesn't have
 * to reconstruct ELK's internal layout.
 */
function straightenLinearChains<E extends LayoutEdge>(
  positioned: Map<string, { x: number; y: number }>,
  dimsById: Map<string, EffectiveDims>,
  edges: E[],
): void {
  const outCount = new Map<string, number>();
  const inCount = new Map<string, number>();
  for (const edge of edges) {
    outCount.set(edge.source, (outCount.get(edge.source) ?? 0) + 1);
    inCount.set(edge.target, (inCount.get(edge.target) ?? 0) + 1);
  }

  // Process in source-X order so upstream adjustments cascade downstream.
  const candidates = edges
    .filter((e) => (outCount.get(e.source) ?? 0) === 1 && (inCount.get(e.target) ?? 0) === 1)
    .map((e) => ({ edge: e, sourceX: positioned.get(e.source)?.x ?? 0 }))
    .sort((a, b) => a.sourceX - b.sourceX);

  for (const { edge } of candidates) {
    const sourcePos = positioned.get(edge.source);
    const targetPos = positioned.get(edge.target);
    const sourceDims = dimsById.get(edge.source);
    const targetDims = dimsById.get(edge.target);
    if (!sourcePos || !targetPos || !sourceDims || !targetDims) {
      continue;
    }
    // Align target card center to source card center.
    const sourceCardCenterY = sourcePos.y + sourceDims.height / 2;
    positioned.set(edge.target, {
      x: targetPos.x,
      y: sourceCardCenterY - targetDims.height / 2,
    });
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Apply the Flowlib layout: ELK `layered` with reserved-footprint sizing for
 * agent appendices and declared-order source ports for branching nodes,
 * followed by optional linear-chain straightening and grid snapping.
 */
export async function applyFlowlibLayout<N extends LayoutNode, E extends LayoutEdge>(
  nodes: N[],
  edges: E[],
  options: FlowlibLayoutOptions = {},
): Promise<N[]> {
  if (nodes.length === 0) {
    return nodes;
  }

  const opts: Required<FlowlibLayoutOptions> = { ...DEFAULTS, ...options };

  // 1. Compute effective dims per node.
  const dimsById = new Map<string, EffectiveDims>();
  for (const node of nodes) {
    dimsById.set(node.id, effectiveNodeDims(node, opts.nodeWidth, opts.nodeHeight));
  }

  // 2. Build ELK input: inflate measured dims to the reserved footprint and
  //    attach source ports in the node's declared handle order.
  const portPosition = portSideForDirection(opts.direction);
  const enrichedForElk: ElkLayoutNode[] = nodes.map((node) => {
    const d = dimsById.get(node.id) as EffectiveDims;
    const declared = resolveDeclaredHandleOrder(node);
    const sourceHandles: LayoutHandle[] | undefined = declared?.map((id) => ({
      id,
      type: 'source' as const,
      position: portPosition,
    }));

    return {
      id: node.id,
      position: node.position,
      type: node.type,
      data: node.data,
      measured: { width: d.reservedWidth, height: d.reservedHeight },
      sourceHandles,
    } as ElkLayoutNode;
  });

  // 3. Run ELK.
  const elkOptions: ElkJsLayoutOptions = {
    direction: directionToElk(opts.direction),
    nodeSpacing: opts.nodeSpacing,
    nodeNodeBetweenLayersSpacing: opts.rankSpacing,
    componentSpacing: opts.componentSpacing,
    nodeWidth: opts.nodeWidth,
    nodeHeight: opts.nodeHeight,
  };
  const laidOut = await applyElkLayout(enrichedForElk, edges, elkOptions);

  // 4. ELK returns the reserved box's top-left; shift to card top-left using
  //    the cardOffset we computed earlier.
  const positioned = new Map<string, { x: number; y: number }>();
  for (const n of laidOut) {
    const d = dimsById.get(n.id);
    if (!d) {
      continue;
    }
    positioned.set(n.id, {
      x: n.position.x + d.cardOffsetX,
      y: n.position.y + d.cardOffsetY,
    });
  }

  // 5. Optional post-pass: straighten linear chains.
  if (opts.straightenChains) {
    straightenLinearChains(positioned, dimsById, edges);
  }

  // 6. Grid snap.
  if (opts.gridSize > 0) {
    const g = opts.gridSize;
    for (const [id, pos] of positioned) {
      positioned.set(id, {
        x: Math.round(pos.x / g) * g,
        y: Math.round(pos.y / g) * g,
      });
    }
  }

  // 7. Apply positions back to the original nodes, preserving every other
  //    property (measured, data, etc.) untouched.
  return nodes.map((node) => {
    const pos = positioned.get(node.id);
    if (!pos) {
      return node;
    }
    return { ...node, position: pos };
  });
}
