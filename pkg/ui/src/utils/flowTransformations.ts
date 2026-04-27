import type { Node, Edge } from '@xyflow/react';
import type { InvectDefinition, FlowEdge, MapperConfig } from '@flowlib/core/types';

type NodeData = Record<string, unknown> & {
  params?: Record<string, unknown>;
  display_name?: string;
  reference_id?: string;
  metadata?: Record<string, unknown>;
};

/**
 * Transform ReactFlow nodes and edges back to InvectDefinition format for saving
 */
export function transformToInvectDefinition(nodes: Node[], edges: Edge[]): InvectDefinition {
  // Transform nodes: extract only the data needed for backend
  const transformedNodes = nodes.map((node) => {
    const data = (node.data || {}) as NodeData;
    const params = data.params && typeof data.params === 'object' ? data.params : {};
    const displayName =
      typeof data.display_name === 'string' && data.display_name.trim().length > 0
        ? data.display_name.trim()
        : undefined;
    const referenceId =
      typeof data.reference_id === 'string' && data.reference_id.trim().length > 0
        ? data.reference_id.trim()
        : undefined;

    const nodeType = (node.type as string) || (data.type as string) || 'core.template_string';

    const baseNode = {
      id: node.id,
      type: nodeType,
      position: node.position ?? { x: 0, y: 0 },
      params,
    } as InvectDefinition['nodes'][number];

    if (displayName) {
      baseNode.label = displayName;
    }

    // Store reference_id for input mapping
    if (referenceId) {
      (baseNode as Record<string, unknown>).referenceId = referenceId;
    }

    // Preserve mapper configuration at node level
    const mapperConfig = data.mapper as MapperConfig | undefined;
    if (mapperConfig && mapperConfig.enabled) {
      (baseNode as Record<string, unknown>).mapper = mapperConfig;
    }

    return baseNode;
  });

  // Transform edges: extract only core edge properties, handling null values
  const transformedEdges: FlowEdge[] = edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle || undefined,
    targetHandle: edge.targetHandle || undefined,
  }));

  return {
    nodes: transformedNodes,
    edges: transformedEdges,
  };
}

/**
 * Compute a serialized snapshot of the flow definition for dirty-checking.
 * Uses `transformToInvectDefinition` to strip ReactFlow-internal state
 * (selected, measured, executionStatus, etc.), then JSON.stringify for
 * cheap string equality comparison.
 *
 * This is only called inside Zustand store actions (on structural mutations
 * and saves), NOT inside selectors — so it doesn't run on every render.
 */
export function computeSnapshot(nodes: Node[], edges: Edge[]): string {
  const definition = transformToInvectDefinition(nodes, edges);
  return JSON.stringify(definition);
}

/**
 * Validate that a InvectDefinition has required fields
 */
function _validateInvectDefinition(definition: InvectDefinition): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!definition.nodes || definition.nodes.length === 0) {
    errors.push('Flow must contain at least one node');
  }

  if (!definition.edges) {
    errors.push('Flow must have an edges array (can be empty)');
  }

  // Validate each node has required fields
  definition.nodes?.forEach((node, index) => {
    if (!node.id) {
      errors.push(`Node at index ${index} is missing an id`);
    }
    if (!node.type) {
      errors.push(`Node at index ${index} is missing a type`);
    }
    if (!node.params) {
      errors.push(`Node ${node.id} is missing params`);
    }
  });

  // Validate edges reference existing nodes
  const nodeIds = new Set(definition.nodes?.map((n) => n.id) || []);
  definition.edges?.forEach((edge, index) => {
    if (!edge.id) {
      errors.push(`Edge at index ${index} is missing an id`);
    }
    if (!edge.source) {
      errors.push(`Edge at index ${index} is missing a source`);
    } else if (!nodeIds.has(edge.source)) {
      errors.push(`Edge ${edge.id} references non-existent source node: ${edge.source}`);
    }
    if (!edge.target) {
      errors.push(`Edge at index ${index} is missing a target`);
    } else if (!nodeIds.has(edge.target)) {
      errors.push(`Edge ${edge.id} references non-existent target node: ${edge.target}`);
    }
  });

  return {
    isValid: errors.length === 0,
    errors,
  };
}
