/**
 * Chat Tools — Node Editing
 *
 * Granular tools for adding, removing, connecting, and configuring individual nodes.
 * These operate on the latest flow version — they read, mutate, and save a new version.
 *
 * For bulk changes (new flows from scratch), use update_flow_definition instead.
 * These are for surgical edits: "add a Slack node after the HTTP request",
 * "change the JQ query", "remove the debug node".
 */

import { z } from 'zod/v4';
import type { ChatToolDefinition, ChatToolContext, ChatToolResult } from '../chat-types';
import type { FlowlibInstance } from 'src/api/types';
import type { FlowNodeDefinitions, FlowEdge } from 'src/services/flow-versions/schemas-fresh';

/**
 * Reusable mapper schema for chat tools.
 */
const mapperSchema = z
  .object({
    enabled: z.boolean().describe('Whether the mapper is active'),
    expression: z
      .string()
      .describe(
        'JS expression evaluated against incoming data (e.g. "fetch_users" to iterate over that upstream array)',
      ),
    mode: z
      .enum(['auto', 'iterate', 'reshape'])
      .default('auto')
      .describe(
        'auto = iterate if array, reshape otherwise. iterate = run node per item. reshape = transform once.',
      ),
    outputMode: z
      .enum(['array', 'object', 'first', 'last', 'concat'])
      .default('array')
      .describe('How to collect results'),
    concurrency: z.number().min(1).max(50).default(1).describe('Max parallel iterations'),
    onEmpty: z.enum(['error', 'skip']).default('skip').describe('Behaviour on empty array'),
  })
  .describe('Data mapper for iteration/transformation');

/**
 * Helper: Load the latest flow version's nodes and edges.
 */
async function loadLatestDefinition(flowlib: FlowlibInstance, flowId: string) {
  const version = await flowlib.versions.get(flowId, 'latest');
  if (!version) {
    throw new Error('No flow version found — publish a version first');
  }

  const definition = version.flowlibDefinition;
  const nodes = structuredClone(definition.nodes) as FlowNodeDefinitions[];
  const edges = structuredClone(definition.edges) as FlowEdge[];

  return { nodes, edges, version };
}

/**
 * Helper: Save a mutated definition as a new flow version.
 */
async function saveNewVersion(
  flowlib: FlowlibInstance,
  flowId: string,
  nodes: FlowNodeDefinitions[],
  edges: FlowEdge[],
) {
  return flowlib.versions.create(flowId, {
    flowlibDefinition: { nodes, edges },
  });
}

/**
 * Helper: Find a node by ID, falling back to referenceId.
 * The LLM may pass either the internal node ID or the referenceId (shown as "ref" in the prompt).
 */
function findNodeByIdOrRef<T extends { id: string; referenceId?: string }>(
  nodes: T[],
  idOrRef: string,
): T | undefined {
  return nodes.find((n) => n.id === idOrRef) ?? nodes.find((n) => n.referenceId === idOrRef);
}

/**
 * Helper: Convert a label to a snake_case reference ID.
 */
function labelToReferenceId(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * Helper: Generate a short unique ID for nodes/edges.
 */
function genId(): string {
  return Math.random().toString(36).slice(2, 10);
}

// =====================================
// add_node
// =====================================

export const addNodeTool: ChatToolDefinition = {
  id: 'add_node',
  name: 'Add Node',
  description:
    'Add a new node to the current flow. Optionally connect it after an existing node. ' +
    'The node is positioned automatically. Use search_actions or get_action_details to find valid action IDs. ' +
    'For bulk flow creation, prefer update_flow_definition instead.',
  parameters: z.object({
    actionId: z
      .string()
      .describe(
        'Action type ID (e.g. "core.model", "core.agent", "core.javascript", "gmail.send_message", "http.request").',
      ),
    label: z.string().describe('Human-readable node label (e.g. "Fetch User Emails")'),
    params: z
      .record(z.string(), z.unknown())
      .optional()
      .default({})
      .describe('Node configuration parameters (key-value pairs)'),
    connectAfter: z
      .string()
      .optional()
      .describe('Node ID to connect after — creates an edge from that node to this new one'),
    mapper: mapperSchema.optional(),
  }),
  async execute(params: unknown, ctx: ChatToolContext): Promise<ChatToolResult> {
    const {
      actionId,
      label,
      params: nodeParams,
      connectAfter,
      mapper,
    } = params as {
      actionId: string;
      label: string;
      params: Record<string, unknown>;
      connectAfter?: string;
      mapper?: {
        enabled: boolean;
        expression: string;
        mode: 'auto' | 'iterate' | 'reshape';
        outputMode: 'array' | 'object' | 'first' | 'last' | 'concat';
        concurrency: number;
        onEmpty: 'error' | 'skip';
      };
    };
    const flowlib = ctx.flowlib;
    const flowId = ctx.chatContext.flowId;

    if (!flowId) {
      return { success: false, error: 'No flow is currently open' };
    }

    try {
      const availableNodes = flowlib.actions.getAvailableNodes();
      const validAction = availableNodes.find((n) => n.type === actionId);
      if (!validAction) {
        const searchLower = actionId.toLowerCase();
        const similar = availableNodes
          .filter((n) => n.type.toLowerCase().includes(searchLower.split('.').pop() ?? ''))
          .slice(0, 5)
          .map((n) => n.type);
        return {
          success: false,
          error: `Action "${actionId}" not found in the action registry`,
          suggestion:
            similar.length > 0
              ? `Did you mean one of: ${similar.join(', ')}? Use search_actions to find valid action IDs.`
              : 'Use search_actions to find valid action IDs.',
        };
      }

      const { nodes, edges } = await loadLatestDefinition(flowlib, flowId);

      const nodeId = `node_${genId()}`;
      const referenceId = labelToReferenceId(label);

      // Compute position: below connectAfter node, or after the last node
      let position = { x: 250, y: 100 };
      if (connectAfter) {
        const upstream = nodes.find((n) => n.id === connectAfter);
        if (upstream?.position) {
          position = { x: upstream.position.x, y: upstream.position.y + 150 };
        }
      } else if (nodes.length > 0) {
        const lastNode = nodes[nodes.length - 1];
        if (lastNode?.position) {
          position = { x: lastNode.position.x, y: lastNode.position.y + 150 };
        }
      }

      nodes.push({
        id: nodeId,
        type: actionId,
        label,
        referenceId,
        params: nodeParams ?? {},
        position,
        ...(mapper ? { mapper } : {}),
      });

      // Auto-connect if requested
      if (connectAfter) {
        const upstream = nodes.find((n) => n.id === connectAfter);
        if (!upstream) {
          return {
            success: false,
            error: `Cannot connect after node "${connectAfter}" — node not found`,
            suggestion: 'Use get_current_flow_context to see available node IDs.',
          };
        }
        edges.push({
          id: `edge_${genId()}`,
          source: connectAfter,
          target: nodeId,
        });
      }

      const version = await saveNewVersion(flowlib, flowId, nodes, edges);

      return {
        success: true,
        data: {
          nodeId,
          label,
          actionId,
          referenceId,
          versionNumber: version.version,
          connected: connectAfter ? { from: connectAfter, to: nodeId } : undefined,
        },
        uiAction: {
          action: 'refresh_flow',
          data: { flowId, selectNodeId: nodeId },
        },
      };
    } catch (error: unknown) {
      return {
        success: false,
        error: `Failed to add node: ${(error as Error).message}`,
        suggestion: 'Use search_actions to verify the action ID is valid.',
      };
    }
  },
};

// =====================================
// remove_node
// =====================================

export const removeNodeTool: ChatToolDefinition = {
  id: 'remove_node',
  name: 'Remove Node',
  description:
    'Remove a node from the current flow. Also removes all edges connected to it. ' +
    'Use get_current_flow_context to find node IDs.',
  parameters: z.object({
    nodeId: z.string().describe('ID of the node to remove'),
  }),
  async execute(params: unknown, ctx: ChatToolContext): Promise<ChatToolResult> {
    const { nodeId } = params as { nodeId: string };
    const flowlib = ctx.flowlib;
    const flowId = ctx.chatContext.flowId;

    if (!flowId) {
      return { success: false, error: 'No flow is currently open' };
    }

    try {
      const { nodes, edges } = await loadLatestDefinition(flowlib, flowId);

      const removedNode = findNodeByIdOrRef(nodes, nodeId);
      if (!removedNode) {
        return {
          success: false,
          error: `Node "${nodeId}" not found in flow`,
          suggestion: 'Use get_current_flow_context to see available node IDs.',
        };
      }

      const resolvedId = removedNode.id;
      const removedLabel = removedNode.label || resolvedId;

      // Remove the node
      const nodeIndex = nodes.findIndex((n) => n.id === resolvedId);
      nodes.splice(nodeIndex, 1);

      // Remove all edges connected to this node
      const removedEdgeCount = edges.length;
      const filteredEdges = edges.filter((e) => e.source !== resolvedId && e.target !== resolvedId);
      const edgesRemoved = removedEdgeCount - filteredEdges.length;

      const version = await saveNewVersion(flowlib, flowId, nodes, filteredEdges);

      return {
        success: true,
        data: {
          removedNodeId: nodeId,
          removedLabel,
          edgesRemoved,
          versionNumber: version.version,
          remainingNodeCount: nodes.length,
        },
        uiAction: {
          action: 'refresh_flow',
          data: { flowId },
        },
      };
    } catch (error: unknown) {
      return { success: false, error: `Failed to remove node: ${(error as Error).message}` };
    }
  },
};

// =====================================
// update_node_config
// =====================================

export const updateNodeConfigTool: ChatToolDefinition = {
  id: 'update_node_config',
  name: 'Update Node Config',
  description:
    'Update the configuration parameters of an existing node. ' +
    'Merges the provided params into the existing config (does not replace unmentioned params). ' +
    'Use this for targeted changes like "change the JQ query" or "update the prompt".',
  parameters: z.object({
    nodeId: z.string().describe('ID of the node to update'),
    params: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Parameters to set or update (merged with existing)'),
    label: z.string().optional().describe('Optionally update the node label too'),
    mapper: mapperSchema.optional().describe('Set or update the data mapper configuration'),
  }),
  async execute(params: unknown, ctx: ChatToolContext): Promise<ChatToolResult> {
    const {
      nodeId,
      params: newParams,
      label,
      mapper,
    } = params as {
      nodeId: string;
      params?: Record<string, unknown>;
      label?: string;
      mapper?: {
        enabled: boolean;
        expression: string;
        mode: 'auto' | 'iterate' | 'reshape';
        outputMode: 'array' | 'object' | 'first' | 'last' | 'concat';
        concurrency: number;
        onEmpty: 'error' | 'skip';
      };
    };
    const flowlib = ctx.flowlib;
    const flowId = ctx.chatContext.flowId;

    if (!flowId) {
      return { success: false, error: 'No flow is currently open' };
    }

    try {
      const { nodes, edges } = await loadLatestDefinition(flowlib, flowId);

      const node = findNodeByIdOrRef(nodes, nodeId);
      if (!node) {
        return {
          success: false,
          error: `Node "${nodeId}" not found in flow`,
          suggestion: 'Use get_current_flow_context to see available node IDs.',
        };
      }

      // Merge params
      const existingParams = node.params ?? {};
      if (newParams) {
        node.params = { ...existingParams, ...newParams };
      }

      // Set mapper if provided — strip entirely when disabled
      if (mapper) {
        if (mapper.enabled && mapper.expression?.trim()) {
          (node as Record<string, unknown>).mapper = mapper;
        } else {
          delete (node as Record<string, unknown>).mapper;
        }
      }

      // Update label if provided
      if (label) {
        node.label = label;
        node.referenceId = labelToReferenceId(label);
      }

      const version = await saveNewVersion(flowlib, flowId, nodes, edges);

      return {
        success: true,
        data: {
          nodeId,
          label: node.label,
          updatedParams: newParams ? Object.keys(newParams) : [],
          updatedMapper: !!mapper,
          versionNumber: version.version,
        },
        uiAction: {
          action: 'refresh_flow',
          data: { flowId, selectNodeId: nodeId },
        },
      };
    } catch (error: unknown) {
      return { success: false, error: `Failed to update node: ${(error as Error).message}` };
    }
  },
};

// =====================================
// connect_nodes
// =====================================

export const connectNodesTool: ChatToolDefinition = {
  id: 'connect_nodes',
  name: 'Connect Nodes',
  description:
    'Create an edge between two nodes. Data flows from source to target. ' +
    'Use sourceHandle/targetHandle for multi-output nodes like if-else (e.g. "true_output", "false_output").',
  parameters: z.object({
    sourceNodeId: z.string().describe('ID of the source node (data flows FROM here)'),
    targetNodeId: z.string().describe('ID of the target node (data flows TO here)'),
    sourceHandle: z
      .string()
      .optional()
      .describe('Source handle for multi-output nodes (e.g. "true_output", "false_output")'),
    targetHandle: z.string().optional().describe('Target handle (rarely needed)'),
  }),
  async execute(params: unknown, ctx: ChatToolContext): Promise<ChatToolResult> {
    const { sourceNodeId, targetNodeId, sourceHandle, targetHandle } = params as {
      sourceNodeId: string;
      targetNodeId: string;
      sourceHandle?: string;
      targetHandle?: string;
    };
    const flowlib = ctx.flowlib;
    const flowId = ctx.chatContext.flowId;

    if (!flowId) {
      return { success: false, error: 'No flow is currently open' };
    }

    try {
      const { nodes, edges } = await loadLatestDefinition(flowlib, flowId);

      // Validate both nodes exist (accept referenceId as well as node ID)
      const source = findNodeByIdOrRef(nodes, sourceNodeId);
      const target = findNodeByIdOrRef(nodes, targetNodeId);

      if (!source) {
        return {
          success: false,
          error: `Source node "${sourceNodeId}" not found`,
          suggestion: 'Use get_current_flow_context to see available node IDs.',
        };
      }
      if (!target) {
        return {
          success: false,
          error: `Target node "${targetNodeId}" not found`,
          suggestion: 'Use get_current_flow_context to see available node IDs.',
        };
      }

      // Use resolved IDs for edge storage (edges reference node IDs, not referenceIds)
      const resolvedSourceId = source.id;
      const resolvedTargetId = target.id;

      // Check for duplicate edge
      const exists = edges.some(
        (e) =>
          e.source === resolvedSourceId &&
          e.target === resolvedTargetId &&
          (e.sourceHandle ?? '') === (sourceHandle ?? '') &&
          (e.targetHandle ?? '') === (targetHandle ?? ''),
      );
      if (exists) {
        return {
          success: true,
          data: { message: 'Edge already exists — no change needed' },
        };
      }

      edges.push({
        id: `edge_${genId()}`,
        source: resolvedSourceId,
        target: resolvedTargetId,
        ...(sourceHandle && { sourceHandle }),
        ...(targetHandle && { targetHandle }),
      });

      const version = await saveNewVersion(flowlib, flowId, nodes, edges);

      return {
        success: true,
        data: {
          edgeId: edges[edges.length - 1].id,
          from: `${source.label ?? sourceNodeId}`,
          to: `${target.label ?? targetNodeId}`,
          versionNumber: version.version,
        },
        uiAction: {
          action: 'refresh_flow',
          data: { flowId },
        },
      };
    } catch (error: unknown) {
      return { success: false, error: `Failed to connect nodes: ${(error as Error).message}` };
    }
  },
};

// =====================================
// update_switch_case
// =====================================

export const updateSwitchCaseTool: ChatToolDefinition = {
  id: 'update_switch_case',
  name: 'Update Switch Case',
  description:
    'Update a single case of a `core.switch` node — slug, label, or expression. ' +
    'Safer than `update_node_config` for per-case edits because you only send what changes (the existing `cases` array is preserved). ' +
    'Identify the target case by its current `slug`. Other cases are left untouched.',
  parameters: z.object({
    nodeId: z.string().describe('ID or referenceId of the switch node'),
    slug: z.string().describe('Current slug of the case to edit'),
    newSlug: z
      .string()
      .optional()
      .describe(
        'If provided, renames the case slug. Also updates any edges whose sourceHandle matches the old slug.',
      ),
    label: z.string().optional().describe('New human-readable label for the case'),
    expression: z.string().optional().describe('New JS boolean expression for the case'),
  }),
  async execute(params: unknown, ctx: ChatToolContext): Promise<ChatToolResult> {
    const { nodeId, slug, newSlug, label, expression } = params as {
      nodeId: string;
      slug: string;
      newSlug?: string;
      label?: string;
      expression?: string;
    };
    const flowlib = ctx.flowlib;
    const flowId = ctx.chatContext.flowId;

    if (!flowId) {
      return { success: false, error: 'No flow is currently open' };
    }
    if (newSlug === undefined && label === undefined && expression === undefined) {
      return {
        success: false,
        error: 'Provide at least one of `newSlug`, `label`, or `expression` to change',
      };
    }

    try {
      const { nodes, edges } = await loadLatestDefinition(flowlib, flowId);
      const node = findNodeByIdOrRef(nodes, nodeId);
      if (!node) {
        return {
          success: false,
          error: `Node "${nodeId}" not found in flow`,
          suggestion: 'Use get_current_flow_context to see available node IDs.',
        };
      }
      if (node.type !== 'core.switch') {
        return {
          success: false,
          error: `Node "${nodeId}" is type "${node.type}", not "core.switch"`,
        };
      }

      const nodeParams = (node.params ?? {}) as Record<string, unknown>;
      const rawCases = Array.isArray(nodeParams.cases) ? nodeParams.cases : [];
      const cases = rawCases.map((c) => ({
        ...(c as { slug: string; label: string; expression: string }),
      }));
      const idx = cases.findIndex((c) => c.slug === slug);
      if (idx === -1) {
        return {
          success: false,
          error: `Switch node "${nodeId}" has no case with slug "${slug}"`,
          suggestion: `Available slugs: ${cases.map((c) => JSON.stringify(c.slug)).join(', ')}`,
        };
      }

      const updated = { ...cases[idx] };
      if (newSlug !== undefined) {
        updated.slug = newSlug;
      }
      if (label !== undefined) {
        updated.label = label;
      }
      if (expression !== undefined) {
        updated.expression = expression;
      }
      cases[idx] = updated;
      node.params = { ...nodeParams, cases };

      // If the slug changed, update outgoing edges whose sourceHandle points
      // at the old slug so the routing stays correct.
      if (newSlug !== undefined && newSlug !== slug) {
        for (const edge of edges) {
          if (edge.source === node.id && edge.sourceHandle === slug) {
            edge.sourceHandle = newSlug;
          }
        }
      }

      const version = await saveNewVersion(flowlib, flowId, nodes, edges);

      return {
        success: true,
        data: {
          nodeId: node.id,
          slug: updated.slug,
          label: updated.label,
          expression: updated.expression,
          renamedFrom: newSlug !== undefined && newSlug !== slug ? slug : undefined,
          versionNumber: version.version,
        },
        uiAction: {
          action: 'refresh_flow',
          data: { flowId, selectNodeId: node.id },
        },
      };
    } catch (error: unknown) {
      return {
        success: false,
        error: `Failed to update switch case: ${(error as Error).message}`,
      };
    }
  },
};

// =====================================
// Export all node tools
// =====================================

export const nodeTools: ChatToolDefinition[] = [
  addNodeTool,
  removeNodeTool,
  updateNodeConfigTool,
  updateSwitchCaseTool,
  connectNodesTool,
];
