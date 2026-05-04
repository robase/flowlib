/**
 * Chat Tools — Multi-Flow Awareness
 *
 * Tools for discovering and reading other flows in the workspace.
 * Enables the assistant to reference patterns, copy configurations,
 * and understand related workflows across the workspace.
 */

import { z } from 'zod/v4';
import type { FlowlibDefinition } from 'src/services/flow-versions/schemas-fresh';
import type { ChatToolDefinition, ChatToolContext, ChatToolResult } from '../chat-types';

// =====================================
// search_flows
// =====================================

export const searchFlowsTool: ChatToolDefinition = {
  id: 'search_flows',
  name: 'Search Flows',
  description:
    'Search for flows in the workspace by name. ' +
    'Use this when the user says "like in my other flow", "copy from X", or asks about related workflows. ' +
    'Returns flow names, IDs, descriptions, and node counts.',
  parameters: z.object({
    query: z
      .string()
      .optional()
      .describe(
        'Optional search term to filter flows by name (case-insensitive). Omit to list all flows.',
      ),
    limit: z.number().optional().default(20).describe('Max results to return (default 20)'),
  }),
  async execute(params: unknown, ctx: ChatToolContext): Promise<ChatToolResult> {
    const { query, limit } = params as { query?: string; limit?: number };
    const flowlib = ctx.flowlib;
    const currentFlowId = ctx.chatContext.flowId;
    const maxResults = limit ?? 20;

    try {
      const { data: flows } = await flowlib.flows.list({ pagination: { page: 1, limit: 100 } });

      let filtered = flows;
      if (query) {
        const q = query.toLowerCase();
        filtered = flows.filter(
          (f) =>
            f.name.toLowerCase().includes(q) ||
            (f.description && f.description.toLowerCase().includes(q)),
        );
      }

      const results = filtered.slice(0, maxResults).map((f) => ({
        id: f.id,
        name: f.name,
        description: f.description,
        isCurrentFlow: f.id === currentFlowId,
        updatedAt: f.updatedAt,
      }));

      return {
        success: true,
        data: {
          total: results.length,
          flows: results,
          ...(results.length === 0 && {
            hint: query
              ? `No flows found matching "${query}". Try a broader search.`
              : 'No flows exist in the workspace yet.',
          }),
        },
      };
    } catch (error: unknown) {
      return { success: false, error: `Failed to search flows: ${(error as Error).message}` };
    }
  },
};

// =====================================
// get_flow_definition
// =====================================

export const getFlowDefinitionTool: ChatToolDefinition = {
  id: 'get_flow_definition',
  name: 'Get Flow Definition',
  description:
    'Get the full definition of another flow by its ID. ' +
    'Returns all nodes, edges, and configurations from the latest version. ' +
    'Use search_flows first to find the flow ID, then use this to read its structure.',
  parameters: z.object({
    flowId: z.string().describe('The flow ID to read (from search_flows results)'),
  }),
  async execute(params: unknown, ctx: ChatToolContext): Promise<ChatToolResult> {
    const { flowId } = params as { flowId: string };
    const flowlib = ctx.flowlib;

    try {
      const flow = await flowlib.flows.get(flowId);
      if (!flow) {
        return { success: false, error: `Flow "${flowId}" not found` };
      }

      const version = await flowlib.versions.get(flowId, 'latest');
      if (!version) {
        return {
          success: true,
          data: {
            id: flow.id,
            name: flow.name,
            description: flow.description,
            note: 'This flow has no versions (no definition yet).',
          },
        };
      }

      const definition = version.flowlibDefinition as FlowlibDefinition;

      return {
        success: true,
        data: {
          id: flow.id,
          name: flow.name,
          description: flow.description,
          nodes: definition.nodes.map((n) => ({
            id: n.id,
            type: n.type,
            label: n.label,
            referenceId: n.referenceId,
            params: n.params,
            ...(n.mapper ? { mapper: n.mapper } : {}),
          })),
          edges: definition.edges.map((e) => ({
            source: e.source,
            target: e.target,
            sourceHandle: e.sourceHandle,
            targetHandle: e.targetHandle,
          })),
        },
      };
    } catch (error: unknown) {
      return {
        success: false,
        error: `Failed to get flow definition: ${(error as Error).message}`,
      };
    }
  },
};

// =====================================
// Export
// =====================================

export const multiFlowTools: ChatToolDefinition[] = [searchFlowsTool, getFlowDefinitionTool];
