// Layout utilities for automatically positioning nodes to avoid overlaps
import type { Node, Edge } from '@xyflow/react';
import {
  applyDagreLayout as applyDagreLayoutFromPackage,
  applyElkLayout as applyElkLayoutFromPackage,
  applyFlowlibLayout as applyFlowlibLayoutFromPackage,
  type ElkLayoutNode,
} from '@flowlib/layouts';

export interface Position {
  x: number;
  y: number;
}

// Layout algorithm options
export type LayoutAlgorithm = 'dagre' | 'elkjs' | 'flowlib';

export interface LayoutOptions {
  algorithm: LayoutAlgorithm;
  direction?: 'TB' | 'BT' | 'LR' | 'RL'; // Top-Bottom, Bottom-Top, Left-Right, Right-Left
  nodeSpacing?: number;
  rankSpacing?: number;
  /** Maximum width before wrapping to a new row (only applies to LR/RL layouts, 0 = no wrapping) */
  maxWidth?: number;
  /** Vertical spacing between wrapped rows */
  rowSpacing?: number;
}

// Define default layout options if not already defined elsewhere
// These values are examples; adjust them as needed.
const defaultLayoutOptions = {
  nodeWidth: 200,
  nodeHeight: 60,
  nodeSpacing: 0, // Default for dagre nodesep - increased for more vertical spacing
  rankSpacing: 0, // Default for dagre ranksep
  maxWidth: 2000, // Wrap to new row if layout exceeds this width
  rowSpacing: 0, // Vertical spacing between wrapped rows
};

/**
 * Derive explicit source handle ordering from node params.
 * This ensures ELK gets deterministic port positions matching the rendered
 * handle order, regardless of edge iteration order.
 */
function deriveSourceHandles(
  node: Node,
): Array<{ id: string; type: 'source'; position: 'right' }> | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = node.data as Record<string, any> | undefined;
  const nodeType = data?.type ?? node.type;

  if (nodeType === 'core.switch' && Array.isArray(data?.params?.cases)) {
    const cases = data.params.cases as Array<{ slug: string }>;
    return [
      ...cases.map((c) => ({ id: c.slug, type: 'source' as const, position: 'right' as const })),
      { id: 'default', type: 'source' as const, position: 'right' as const },
    ];
  }

  if (nodeType === 'core.if_else') {
    return [
      { id: 'true_output', type: 'source' as const, position: 'right' as const },
      { id: 'false_output', type: 'source' as const, position: 'right' as const },
    ];
  }

  return undefined;
}

/**
 * Agent tools appendix is absolute-positioned (see `NodeAppendix`), so it
 * doesn't contribute to ReactFlow's `measured.height`. Report an effective
 * height that includes the appendix so ELK reserves enough vertical space
 * and neighboring ranks don't overlap the tools box.
 */
const AGENT_TOOLS_HEIGHT = 170;
const AGENT_TOOLS_GAP = 16;

function effectiveMeasuredHeight(node: Node): number | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = node.data as Record<string, any> | undefined;
  const nodeType = data?.type ?? node.type;
  const isAgent = nodeType === 'core.agent' || nodeType === 'primitives.agent';
  if (!isAgent) {
    return node.measured?.height;
  }
  const cardHeight = node.measured?.height ?? defaultLayoutOptions.nodeHeight;
  return cardHeight + AGENT_TOOLS_GAP + AGENT_TOOLS_HEIGHT;
}

const roundPosition = (n: number) => Math.round(n * 100) / 100;

const roundNodePositions = (nodes: Node[]): Node[] =>
  nodes.map((node) => ({
    ...node,
    position: { x: roundPosition(node.position.x), y: roundPosition(node.position.y) },
  }));

/**
 * Main layout function that applies the selected algorithm
 */
export const applyLayout = async (
  nodes: Node[],
  edges: Edge[],
  algorithm: LayoutAlgorithm,
  direction: 'TB' | 'BT' | 'LR' | 'RL' = 'LR',
  options?: LayoutOptions,
): Promise<{ nodes: Node[]; edges: Edge[] }> => {
  const result = await runLayout(nodes, edges, algorithm, direction, options);
  return { nodes: roundNodePositions(result.nodes), edges: result.edges };
};

const runLayout = async (
  nodes: Node[],
  edges: Edge[],
  algorithm: LayoutAlgorithm,
  direction: 'TB' | 'BT' | 'LR' | 'RL',
  options?: LayoutOptions,
): Promise<{ nodes: Node[]; edges: Edge[] }> => {
  switch (algorithm) {
    case 'dagre': {
      // Use shared layout utility from @flowlib/layouts
      const layoutedNodes = applyDagreLayoutFromPackage(nodes, edges, {
        direction,
        nodeSpacing: options?.nodeSpacing ?? defaultLayoutOptions.nodeSpacing,
        rankSpacing: options?.rankSpacing ?? defaultLayoutOptions.rankSpacing,
        nodeWidth: defaultLayoutOptions.nodeWidth,
        nodeHeight: defaultLayoutOptions.nodeHeight,
        maxWidth: options?.maxWidth ?? defaultLayoutOptions.maxWidth,
        rowSpacing: options?.rowSpacing ?? defaultLayoutOptions.rowSpacing,
      });
      return { nodes: layoutedNodes as Node[], edges };
    }
    case 'elkjs': {
      // Enrich branching nodes with explicit source handle ordering so ELK
      // places ports in the correct top-to-bottom order (matching the rendered handles).
      // Also inflate agent node heights so ELK reserves space for the tools
      // appendix (which is absolute-positioned and otherwise invisible to ELK).
      const enrichedNodes = nodes.map((node) => {
        const sourceHandles = deriveSourceHandles(node);
        const effectiveHeight = effectiveMeasuredHeight(node);
        const withHeight: Node =
          effectiveHeight !== undefined && effectiveHeight !== node.measured?.height
            ? {
                ...node,
                measured: {
                  ...node.measured,
                  height: effectiveHeight,
                },
              }
            : node;
        if (sourceHandles) {
          return { ...withHeight, sourceHandles } as ElkLayoutNode;
        }
        return withHeight;
      }) as ElkLayoutNode[];

      // Use ElkJS layout with port/handle support for better edge routing
      // Let the @flowlib/layouts package defaults handle spacing and wrapping
      const elkDirection =
        direction === 'LR'
          ? 'RIGHT'
          : direction === 'RL'
            ? 'LEFT'
            : direction === 'TB'
              ? 'DOWN'
              : 'UP';
      const layoutedNodes = await applyElkLayoutFromPackage(enrichedNodes, edges, {
        direction: elkDirection,
        // Only pass nodeWidth/nodeHeight, let package defaults handle everything else
        nodeWidth: defaultLayoutOptions.nodeWidth,
        nodeHeight: defaultLayoutOptions.nodeHeight,
      });
      // Merge only the new positions back onto the original nodes — otherwise
      // the inflated agent `measured.height` leaks into the store and
      // compounds on every subsequent realign.
      //
      // Agent alignment shift: ELK aligns connected siblings to the *center*
      // of each node's bounding box. Because we inflate the agent's height
      // to reserve space for the absolute-positioned tools dropzone, that
      // center sits (gap + tools) / 2 below the visible header card, leaving
      // the header looking shifted up relative to its neighbors. Pushing the
      // agent down by that half-inflation lands its header at the sibling
      // alignment line; the tools box hangs into space ELK already reserved
      // below for same-column collision avoidance.
      const AGENT_HEADER_ALIGN_OFFSET = (AGENT_TOOLS_GAP + AGENT_TOOLS_HEIGHT) / 2;
      const originalById = new Map(nodes.map((n) => [n.id, n]));
      const restored = (layoutedNodes as Node[]).map((n) => {
        const original = originalById.get(n.id);
        if (!original) {
          return n;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = original.data as Record<string, any> | undefined;
        const nodeType = data?.type ?? original.type;
        const isAgent = nodeType === 'core.agent' || nodeType === 'primitives.agent';
        const yOffset = isAgent ? AGENT_HEADER_ALIGN_OFFSET : 0;
        return {
          ...original,
          position: { x: n.position.x, y: n.position.y + yOffset },
        };
      });
      return { nodes: restored, edges };
    }
    case 'flowlib': {
      const layoutedNodes = await applyFlowlibLayoutFromPackage(nodes, edges, {
        direction,
        nodeSpacing: options?.nodeSpacing ?? defaultLayoutOptions.nodeSpacing,
        rankSpacing: options?.rankSpacing ?? defaultLayoutOptions.rankSpacing,
        nodeWidth: defaultLayoutOptions.nodeWidth,
        nodeHeight: defaultLayoutOptions.nodeHeight,
      });
      return { nodes: layoutedNodes as Node[], edges };
    }
    default:
      return { nodes, edges }; // No layout applied
  }
};
