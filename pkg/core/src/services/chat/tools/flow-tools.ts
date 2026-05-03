/**
 * Chat Tools — Flow Mutations
 *
 * Tools for creating and modifying flows: updating definitions,
 * running flows, and testing nodes.
 */

import { z } from 'zod/v4';
import type { ChatToolDefinition, ChatToolContext, ChatToolResult } from '../chat-types';

/**
 * Reusable mapper schema for chat tools.
 * Matches the mapperConfigSchema in schemas-fresh.ts but simplified for the LLM.
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
      .describe(
        'How to collect results: array (default), first/last item, concat arrays, or keyed object',
      ),
    concurrency: z
      .number()
      .min(1)
      .max(50)
      .default(1)
      .describe('Max parallel iterations (1 = sequential)'),
    onEmpty: z
      .enum(['error', 'skip'])
      .default('skip')
      .describe('What to do when the expression yields an empty array'),
  })
  .describe(
    'Data mapper for iteration/transformation. Use when the node should process each item in an array independently.',
  );

/**
 * Helper: Convert a label to a snake_case reference ID.
 */
function labelToReferenceId(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

// =====================================
// update_flow_definition
// =====================================

export const updateFlowDefinitionTool: ChatToolDefinition = {
  id: 'update_flow_definition',
  name: 'Update Flow Definition',
  description:
    'Update the flow definition (nodes and edges) by publishing a new version. ' +
    'Use this for creating new flows from scratch or making large-scale changes. ' +
    'Provide the COMPLETE nodes and edges arrays — this replaces the entire definition. ' +
    'For AGENT nodes, do NOT include tools in params — create the flow first, then use add_tool_to_agent.',
  parameters: z.object({
    nodes: z.array(
      z.object({
        id: z.string().describe('Unique node ID (use nanoid-style IDs)'),
        type: z
          .string()
          .describe(
            'Action ID (e.g. "trigger.manual", "core.model", "core.agent", "gmail.send_message").',
          ),
        label: z.string().describe('Human-readable node label'),
        referenceId: z
          .string()
          .optional()
          .describe(
            'Snake_case reference ID for template access. Auto-generated from label if omitted (e.g. "Fetch Users" → "fetch_users").',
          ),
        params: z
          .record(z.string(), z.unknown())
          .default({})
          .describe('Node configuration parameters'),
        position: z.object({ x: z.number(), y: z.number() }).optional().describe('Canvas position'),
        mapper: mapperSchema.optional(),
      }),
    ),
    edges: z.array(
      z.object({
        id: z.string().describe('Unique edge ID'),
        source: z.string().describe('Source node ID'),
        target: z.string().describe('Target node ID'),
        sourceHandle: z.string().optional(),
        targetHandle: z.string().optional(),
      }),
    ),
  }),
  async execute(params: unknown, ctx: ChatToolContext): Promise<ChatToolResult> {
    const { nodes, edges } = params as {
      nodes: Array<{
        id: string;
        type: string;
        label: string;
        referenceId?: string;
        params: Record<string, unknown>;
        position?: { x: number; y: number };
        mapper?: {
          enabled: boolean;
          expression: string;
          mode: 'auto' | 'iterate' | 'reshape';
          outputMode: 'array' | 'object' | 'first' | 'last' | 'concat';
          concurrency: number;
          onEmpty: 'error' | 'skip';
        };
      }>;
      edges: Array<{
        id: string;
        source: string;
        target: string;
        sourceHandle?: string;
        targetHandle?: string;
      }>;
    };
    const flowlib = ctx.flowlib;
    const flowId = ctx.chatContext.flowId;

    if (!flowId) {
      return { success: false, error: 'No flow is currently open. Create a flow first.' };
    }

    try {
      // Validate all node types exist in the action registry
      const availableNodes = flowlib.actions.getAvailableNodes();
      const validTypes = new Set(availableNodes.map((n) => n.type));
      const invalidNodes = nodes.filter((n) => !validTypes.has(n.type));
      if (invalidNodes.length > 0) {
        return {
          success: false,
          error: `Invalid action types: ${invalidNodes.map((n) => `"${n.type}" (node "${n.label}")`).join(', ')}`,
          suggestion: 'Use search_actions to find valid action IDs.',
        };
      }

      // Assign positions and referenceIds if missing; strip disabled mappers
      const positionedNodes = nodes.map((n, i) => {
        const { mapper, ...rest } = n;
        const node = {
          ...rest,
          referenceId: n.referenceId || labelToReferenceId(n.label),
          position: n.position ?? { x: 250, y: i * 150 },
        };
        // Only include mapper when enabled with a non-empty expression
        if (mapper?.enabled && mapper.expression?.trim()) {
          (node as Record<string, unknown>).mapper = mapper;
        }
        return node;
      });

      const version = await flowlib.versions.create(flowId, {
        flowlibDefinition: {
          nodes: positionedNodes,
          edges,
        },
      });

      return {
        success: true,
        data: {
          flowId,
          versionNumber: version.version,
          nodeCount: nodes.length,
          edgeCount: edges.length,
        },
        uiAction: {
          action: 'refresh_flow',
          data: { flowId },
        },
      };
    } catch (error: unknown) {
      return {
        success: false,
        error: `Failed to update flow: ${(error as Error).message}`,
        suggestion:
          'Check that all node types are valid action IDs. Use search_actions to find correct IDs.',
      };
    }
  },
};

// =====================================
// run_flow
// =====================================

export const runFlowTool: ChatToolDefinition = {
  id: 'run_flow',
  name: 'Run Flow',
  description:
    'Execute the current flow with inputs. ' +
    'Check the "Flow Input Fields" in the context to see what fields the trigger expects, then provide appropriate values. ' +
    'Fields with defaults will be auto-filled if omitted, but required fields MUST be provided or the flow will fail.',
  parameters: z.object({
    inputs: z
      .record(z.string(), z.unknown())
      .optional()
      .default({})
      .describe(
        'Flow input values keyed by field name. ' +
          'Check the flow context for expected field names (e.g. {"sender_email": "alice@example.com", "subject": "Test"})',
      ),
  }),
  async execute(params: unknown, ctx: ChatToolContext): Promise<ChatToolResult> {
    const { inputs } = params as { inputs?: Record<string, unknown> };
    const flowlib = ctx.flowlib;
    const flowId = ctx.chatContext.flowId;

    if (!flowId) {
      return { success: false, error: 'No flow is currently open' };
    }

    try {
      // Read trigger declared inputs and merge defaults for any missing fields.
      // The runtime applies the same merge — this lets the chat tool surface
      // the resolved inputs in its return payload.
      const mergedInputs = { ...inputs };
      try {
        const version = await flowlib.versions.get(flowId, 'latest');
        if (version) {
          const def =
            typeof version.flowlibDefinition === 'string'
              ? JSON.parse(version.flowlibDefinition)
              : version.flowlibDefinition;
          const triggerNode = (def?.nodes ?? []).find(
            (n: { type?: string }) => n.type === 'trigger.manual',
          );
          const declaredInputs = (triggerNode?.params as Record<string, unknown> | undefined)
            ?.inputs as Array<{ name: string; defaultValue?: unknown }> | undefined;
          if (Array.isArray(declaredInputs)) {
            for (const def of declaredInputs) {
              if (
                mergedInputs[def.name] === undefined &&
                def.defaultValue !== undefined &&
                def.defaultValue !== null
              ) {
                mergedInputs[def.name] = def.defaultValue;
              }
            }
          }
        }
      } catch {
        // Non-critical — proceed with whatever inputs we have
      }

      const result = await flowlib.runs.start(flowId, mergedInputs);

      return {
        success: true,
        data: {
          flowRunId: result.flowRunId,
          status: result.status,
          duration: result.duration,
          outputs: result.outputs,
          error: result.error,
          nodeCount: result.traces?.length ?? 0,
        },
        uiAction: {
          action: 'open_flow_run',
          data: { flowId, flowRunId: result.flowRunId },
        },
      };
    } catch (error: unknown) {
      return { success: false, error: `Flow execution failed: ${(error as Error).message}` };
    }
  },
};

// =====================================
// create_flow
// =====================================

export const createFlowTool: ChatToolDefinition = {
  id: 'create_flow',
  name: 'Create Flow',
  description:
    'Create a brand-new flow. Returns the new flow ID. ' +
    'After creating, use update_flow_definition to add nodes and edges.',
  parameters: z.object({
    name: z.string().describe('Flow name'),
  }),
  async execute(params: unknown, ctx: ChatToolContext): Promise<ChatToolResult> {
    const { name } = params as { name: string };
    const flowlib = ctx.flowlib;

    try {
      const flow = await flowlib.flows.create({ name });

      return {
        success: true,
        data: {
          flowId: flow.id,
          name: flow.name,
        },
        uiAction: {
          action: 'navigate_to_flow',
          data: { flowId: flow.id },
        },
      };
    } catch (error: unknown) {
      return { success: false, error: `Failed to create flow: ${(error as Error).message}` };
    }
  },
};

// =====================================
// list_flows
// =====================================

export const listFlowsTool: ChatToolDefinition = {
  id: 'list_flows',
  name: 'List Flows',
  description:
    'List all flows in the workspace. Returns flow names, IDs, and metadata. ' +
    'Use this to answer questions like "show my flows" or "do I have an email automation?".',
  parameters: z.object({
    search: z.string().optional().describe('Optional search term to filter flow names'),
    limit: z.number().optional().default(20).describe('Max flows to return (default 20)'),
  }),
  async execute(params: unknown, ctx: ChatToolContext): Promise<ChatToolResult> {
    const { search, limit } = params as { search?: string; limit?: number };
    const flowlib = ctx.flowlib;

    try {
      const result = await flowlib.flows.list();
      let flows = result.data;

      // Relevance scoring: match any term, sort by number of matches
      if (search) {
        const terms = search.toLowerCase().split(/\\s+/).filter(Boolean);
        const scored = flows
          .map((f) => {
            const haystack = [f.name ?? '', f.description ?? ''].join(' ').toLowerCase();
            let score = 0;
            for (const term of terms) {
              if (haystack.includes(term)) {
                score += 1;
              }
            }
            return { flow: f, score };
          })
          .filter((s) => s.score > 0)
          .sort((a, b) => b.score - a.score);
        flows = scored.map((s) => s.flow);
      }

      const limited = flows.slice(0, limit ?? 20);

      return {
        success: true,
        data: {
          total: flows.length,
          flows: limited.map((f) => ({
            id: f.id,
            name: f.name,
            description: f.description,
            createdAt: f.createdAt,
            updatedAt: f.updatedAt,
          })),
        },
      };
    } catch (error: unknown) {
      return { success: false, error: `Failed to list flows: ${(error as Error).message}` };
    }
  },
};

// =====================================
// validate_flow
// =====================================

export const validateFlowTool: ChatToolDefinition = {
  id: 'validate_flow',
  name: 'Validate Flow',
  description:
    'Validate the current flow definition for errors before running. ' +
    'Checks for missing connections, invalid node types, circular dependencies, etc. ' +
    'Use this proactively after making changes.',
  parameters: z.object({}),
  async execute(_params: unknown, ctx: ChatToolContext): Promise<ChatToolResult> {
    const flowlib = ctx.flowlib;
    const flowId = ctx.chatContext.flowId;

    if (!flowId) {
      return { success: false, error: 'No flow is currently open' };
    }

    try {
      // Get the latest definition to validate
      const version = await flowlib.versions.get(flowId, 'latest');
      if (!version) {
        return { success: false, error: 'No flow version found to validate' };
      }

      const result = await flowlib.flows.validate(flowId, version.flowlibDefinition);

      if (result.isValid) {
        return {
          success: true,
          data: {
            valid: true,
            message: 'Flow definition is valid ✓',
            nodeCount: version.flowlibDefinition.nodes?.length ?? 0,
            edgeCount: version.flowlibDefinition.edges?.length ?? 0,
            warnings: result.warnings,
          },
        };
      }

      return {
        success: true,
        data: {
          valid: false,
          errors: result.errors,
          warnings: result.warnings,
        },
      };
    } catch (error: unknown) {
      return { success: false, error: `Validation failed: ${(error as Error).message}` };
    }
  },
};

// =====================================
// Export all flow tools
// =====================================

export const flowTools: ChatToolDefinition[] = [
  updateFlowDefinitionTool,
  runFlowTool,
  createFlowTool,
  listFlowsTool,
  validateFlowTool,
];
