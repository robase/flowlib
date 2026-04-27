/**
 * Chat Tools — Agent Node Tool Management
 *
 * Tools for adding, removing, updating, and listing tools on AGENT nodes.
 * Agent nodes have an `addedTools` array of tool instances, each with:
 *   - instanceId: unique ID for this instance
 *   - toolId: references a base tool definition (e.g. "gmail.send_message")
 *   - name: custom display name (shown to the LLM)
 *   - description: custom description (shown to the LLM)
 *   - params: static parameter values + _aiChosenModes
 */

import { z } from 'zod/v4';
import { newToolInstanceId } from '@flowlib/action-kit';
import type { ChatToolDefinition, ChatToolContext, ChatToolResult } from '../chat-types';
import type { InvectInstance } from 'src/api/types';
import type { AddedToolInstance } from 'src/types/agent-tool.types';
import type { FlowNodeDefinitions, FlowEdge } from 'src/services/flow-versions/schemas-fresh';

/**
 * Helper: Load the latest flow version's nodes and edges.
 */
async function loadLatestDefinition(flowlib: InvectInstance, flowId: string) {
  const version = await flowlib.versions.get(flowId, 'latest');
  if (!version) {
    throw new Error('No flow version found — publish a version first');
  }

  const definition = version.invectDefinition;
  const nodes = structuredClone(definition.nodes) as FlowNodeDefinitions[];
  const edges = structuredClone(definition.edges) as FlowEdge[];

  return { nodes, edges, version };
}

/**
 * Helper: Save a mutated definition as a new flow version.
 */
async function saveNewVersion(
  flowlib: InvectInstance,
  flowId: string,
  nodes: FlowNodeDefinitions[],
  edges: FlowEdge[],
) {
  return flowlib.versions.create(flowId, {
    invectDefinition: { nodes, edges },
  });
}

type FindAgentNodeResult =
  | { node: FlowNodeDefinitions; error?: undefined }
  | { node?: undefined; error: string };

/**
 * Helper: Find an AGENT node by ID.
 * After checking `result.error`, use `result.node` (guaranteed non-null).
 */
function findAgentNode(nodes: FlowNodeDefinitions[], nodeId: string): FindAgentNodeResult {
  const node = nodes.find((n) => n.id === nodeId) ?? nodes.find((n) => n.referenceId === nodeId);
  if (!node) {
    return { error: `Node "${nodeId}" not found in flow` };
  }
  if (node.type !== 'core.agent') {
    return {
      error: `Node "${nodeId}" is type "${node.type}", not a core.agent node. Only core.agent nodes have tools.`,
    };
  }
  return { node };
}

/**
 * Helper: unwrap findAgentNode result — returns the node or null with a ChatToolResult error.
 */
function unwrapAgentNode(
  result: FindAgentNodeResult,
): { node: FlowNodeDefinitions } | { node: null; errorResult: ChatToolResult } {
  if (result.error) {
    return {
      node: null,
      errorResult: {
        success: false,
        error: result.error,
        suggestion: 'Use get_current_flow_context to find AGENT node IDs.',
      },
    };
  }
  // After the error check, node is guaranteed to exist by the discriminated union
  return { node: result.node as FlowNodeDefinitions };
}

// =====================================
// list_agent_tools
// =====================================

export const listAgentToolsTool: ChatToolDefinition = {
  id: 'list_agent_tools',
  name: 'List Agent Tools',
  description:
    'List all available tools that can be added to an AGENT node. ' +
    'Returns tool IDs, names, descriptions, and providers. ' +
    'Use this to discover what tools exist before adding them to an agent.',
  parameters: z.object({
    search: z.string().optional().describe('Optional search keyword to filter tools'),
    limit: z.number().optional().default(20).describe('Max results (default 20)'),
  }),
  async execute(params: unknown, ctx: ChatToolContext): Promise<ChatToolResult> {
    const { search, limit } = params as { search?: string; limit?: number };
    const flowlib = ctx.flowlib;

    try {
      const allTools = flowlib.agent.getTools();
      let tools = allTools;

      if (search) {
        const terms = search.toLowerCase().split(/\s+/).filter(Boolean);
        // Relevance scoring: +2 for id/name/provider, +1 for description/tags
        const scored = allTools
          .map((t) => {
            const idLower = t.id.toLowerCase();
            const nameLower = t.name.toLowerCase();
            const providerLower = (t.provider?.name ?? '').toLowerCase();
            const descLower = (t.description ?? '').toLowerCase();
            const tagsLower = (t.tags ?? []).join(' ').toLowerCase();

            let score = 0;
            for (const term of terms) {
              if (
                idLower.includes(term) ||
                nameLower.includes(term) ||
                providerLower.includes(term)
              ) {
                score += 2;
              } else if (descLower.includes(term) || tagsLower.includes(term)) {
                score += 1;
              }
            }
            return { tool: t, score };
          })
          .filter((s) => s.score > 0)
          .sort((a, b) => b.score - a.score);
        tools = scored.map((s) => s.tool);
      }

      const limited = tools.slice(0, limit ?? 20);

      return {
        success: true,
        data: {
          total: tools.length,
          tools: limited.map((t) => ({
            toolId: t.id,
            name: t.name,
            description: t.description,
            provider: t.provider?.name,
            category: t.category,
          })),
        },
      };
    } catch (error: unknown) {
      return { success: false, error: `Failed to list tools: ${(error as Error).message}` };
    }
  },
};

// =====================================
// get_tool_details
// =====================================

export const getToolDetailsTool: ChatToolDefinition = {
  id: 'get_tool_details',
  name: 'Get Tool Details',
  description:
    'Get the full details of a specific tool including its parameter schema. ' +
    'Shows every parameter with its type, whether it is required, default values, and description. ' +
    'Use this before add_tool_to_agent to know what params a tool expects.',
  parameters: z.object({
    toolId: z.string().describe('The tool ID to inspect (e.g. "gmail.send_message")'),
  }),
  async execute(params: unknown, ctx: ChatToolContext): Promise<ChatToolResult> {
    const { toolId } = params as { toolId: string };
    const flowlib = ctx.flowlib;

    try {
      const allTools = flowlib.agent.getTools();
      const tool = allTools.find((t) => t.id === toolId);

      if (!tool) {
        // Suggest close matches
        const idLower = toolId.toLowerCase();
        const suggestions = allTools
          .filter(
            (t) => t.id.toLowerCase().includes(idLower) || idLower.includes(t.id.toLowerCase()),
          )
          .slice(0, 5)
          .map((t) => t.id);
        return {
          success: false,
          error: `Tool "${toolId}" not found.${suggestions.length > 0 ? ` Did you mean: ${suggestions.join(', ')}?` : ' Use list_agent_tools to discover available tools.'}`,
        };
      }

      // Extract parameter details from the JSON Schema
      const schema = tool.inputSchema as Record<string, unknown>;
      const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
      const required = (schema.required ?? []) as string[];

      const paramDetails = Object.entries(properties).map(([name, prop]) => ({
        name,
        type: prop.type ?? (prop.anyOf ? 'union' : 'unknown'),
        required: required.includes(name),
        description: prop.description,
        ...(prop.default !== undefined ? { default: prop.default } : {}),
        ...(prop.enum ? { allowedValues: prop.enum } : {}),
      }));

      return {
        success: true,
        data: {
          toolId: tool.id,
          name: tool.name,
          description: tool.description,
          provider: tool.provider?.name,
          category: tool.category,
          parameters: paramDetails,
          parameterCount: paramDetails.length,
          requiredCount: paramDetails.filter((p) => p.required).length,
        },
      };
    } catch (error: unknown) {
      return { success: false, error: `Failed to get tool details: ${(error as Error).message}` };
    }
  },
};

// =====================================
// get_agent_node_tools
// =====================================

export const getAgentNodeToolsTool: ChatToolDefinition = {
  id: 'get_agent_node_tools',
  name: 'Get Agent Node Tools',
  description:
    'Get the tools currently configured on a specific AGENT node. ' +
    'Shows each tool instance with its ID, name, description, and parameter values. ' +
    'Use this to see what tools an agent already has before modifying.',
  parameters: z.object({
    nodeId: z.string().describe('ID of the AGENT node'),
  }),
  async execute(params: unknown, ctx: ChatToolContext): Promise<ChatToolResult> {
    const { nodeId } = params as { nodeId: string };
    const flowlib = ctx.flowlib;
    const flowId = ctx.chatContext.flowId;

    if (!flowId) {
      return { success: false, error: 'No flow is currently open' };
    }

    try {
      const { nodes } = await loadLatestDefinition(flowlib, flowId);
      const agentResult = unwrapAgentNode(findAgentNode(nodes, nodeId));
      if (!agentResult.node) {
        return agentResult.errorResult;
      }
      const node = agentResult.node;

      const addedTools = (node.params?.addedTools ?? []) as AddedToolInstance[];

      return {
        success: true,
        data: {
          nodeId,
          nodeLabel: node.label,
          toolCount: addedTools.length,
          tools: addedTools.map((t: AddedToolInstance) => ({
            instanceId: t.instanceId,
            toolId: t.toolId,
            name: t.name,
            description: t.description,
            params: t.params,
          })),
        },
      };
    } catch (error: unknown) {
      return { success: false, error: `Failed to get agent tools: ${(error as Error).message}` };
    }
  },
};

// =====================================
// add_tool_to_agent
// =====================================

export const addToolToAgentTool: ChatToolDefinition = {
  id: 'add_tool_to_agent',
  name: 'Add Tool to Agent',
  description:
    'Add a tool to an AGENT node. Creates a tool instance with optional custom name, description, and parameters. ' +
    'Use list_agent_tools to find available tool IDs first. ' +
    'You can add the same tool multiple times with different configurations (e.g. two HTTP requests to different URLs).',
  parameters: z.object({
    nodeId: z.string().describe('ID of the AGENT node to add the tool to'),
    toolId: z
      .string()
      .describe('Base tool ID (e.g. "gmail.send_message", "http.request", "core.javascript")'),
    name: z
      .string()
      .optional()
      .describe('Custom display name for this tool instance (shown to the AI)'),
    description: z
      .string()
      .optional()
      .describe('Custom description for this tool instance (shown to the AI)'),
    params: z
      .record(z.string(), z.unknown())
      .optional()
      .default({})
      .describe('Static parameter values for this tool instance'),
    aiChosenParams: z
      .array(z.string())
      .optional()
      .describe(
        'Parameter names the AI should fill at runtime (others use static values from params)',
      ),
  }),
  async execute(params: unknown, ctx: ChatToolContext): Promise<ChatToolResult> {
    const {
      nodeId,
      toolId,
      name,
      description,
      params: toolParams,
      aiChosenParams,
    } = params as {
      nodeId: string;
      toolId: string;
      name?: string;
      description?: string;
      params: Record<string, unknown>;
      aiChosenParams?: string[];
    };
    const flowlib = ctx.flowlib;
    const flowId = ctx.chatContext.flowId;

    if (!flowId) {
      return { success: false, error: 'No flow is currently open' };
    }

    try {
      // Validate the tool ID exists
      const allTools = flowlib.agent.getTools();
      const baseTool = allTools.find((t) => t.id === toolId);
      if (!baseTool) {
        const similar = allTools
          .filter((t) => t.id.includes(toolId.split('.').pop() ?? ''))
          .slice(0, 5)
          .map((t) => t.id);
        return {
          success: false,
          error: `Tool "${toolId}" not found`,
          suggestion:
            similar.length > 0
              ? `Did you mean: ${similar.join(', ')}?`
              : 'Use list_agent_tools to find available tool IDs.',
        };
      }

      const { nodes, edges } = await loadLatestDefinition(flowlib, flowId);
      const agentResult = unwrapAgentNode(findAgentNode(nodes, nodeId));
      if (!agentResult.node) {
        return agentResult.errorResult;
      }
      const node = agentResult.node;

      // Build _aiChosenModes map
      const aiModes: Record<string, boolean> = {};
      if (aiChosenParams && aiChosenParams.length > 0) {
        // Explicitly listed params are AI-chosen, all others are static
        for (const key of Object.keys(toolParams ?? {})) {
          aiModes[key] = aiChosenParams.includes(key);
        }
        for (const key of aiChosenParams) {
          aiModes[key] = true;
        }
      }

      const instanceId = newToolInstanceId();
      const toolInstance: AddedToolInstance = {
        instanceId,
        toolId,
        name: name ?? baseTool.name,
        description: description ?? baseTool.description,
        params: {
          ...toolParams,
          ...(Object.keys(aiModes).length > 0 ? { _aiChosenModes: aiModes } : {}),
        },
      };

      // Ensure addedTools array exists
      if (!node.params) {
        node.params = {};
      }
      const existingTools = Array.isArray(node.params.addedTools)
        ? (node.params.addedTools as AddedToolInstance[])
        : [];

      // Check for duplicate tool instances of the same base tool
      const existingOfSameType = existingTools.filter((t) => t.toolId === toolId);
      const duplicateWarning =
        existingOfSameType.length > 0
          ? `Note: This agent already has ${existingOfSameType.length} instance(s) of "${toolId}". ` +
            `Existing: ${existingOfSameType.map((t) => `${t.name} (${t.instanceId})`).join(', ')}. ` +
            `Adding another instance. Use update_agent_tool to modify an existing one instead.`
          : undefined;

      existingTools.push(toolInstance);
      node.params.addedTools = existingTools;

      const version = await saveNewVersion(flowlib, flowId, nodes, edges);

      return {
        success: true,
        data: {
          instanceId,
          toolId,
          name: toolInstance.name,
          nodeId,
          versionNumber: version.version,
          totalTools: existingTools.length,
          ...(duplicateWarning ? { warning: duplicateWarning } : {}),
        },
        uiAction: {
          action: 'refresh_flow',
          data: { flowId, selectNodeId: nodeId },
        },
      };
    } catch (error: unknown) {
      return { success: false, error: `Failed to add tool: ${(error as Error).message}` };
    }
  },
};

// =====================================
// remove_tool_from_agent
// =====================================

export const removeToolFromAgentTool: ChatToolDefinition = {
  id: 'remove_tool_from_agent',
  name: 'Remove Tool from Agent',
  description:
    'Remove a tool instance from an AGENT node by its instance ID or tool ID. ' +
    'If multiple instances of the same tool exist and you provide a toolId, removes the first match. ' +
    'Use get_agent_node_tools to see instance IDs.',
  parameters: z.object({
    nodeId: z.string().describe('ID of the AGENT node'),
    instanceId: z
      .string()
      .optional()
      .describe('Instance ID of the specific tool to remove (preferred)'),
    toolId: z
      .string()
      .optional()
      .describe('Base tool ID — removes the first instance matching this tool'),
  }),
  async execute(params: unknown, ctx: ChatToolContext): Promise<ChatToolResult> {
    const { nodeId, instanceId, toolId } = params as {
      nodeId: string;
      instanceId?: string;
      toolId?: string;
    };
    const flowlib = ctx.flowlib;
    const flowId = ctx.chatContext.flowId;

    if (!flowId) {
      return { success: false, error: 'No flow is currently open' };
    }
    if (!instanceId && !toolId) {
      return {
        success: false,
        error: 'Provide either instanceId or toolId to identify the tool to remove',
      };
    }

    try {
      const { nodes, edges } = await loadLatestDefinition(flowlib, flowId);
      const agentResult = unwrapAgentNode(findAgentNode(nodes, nodeId));
      if (!agentResult.node) {
        return agentResult.errorResult;
      }
      const node = agentResult.node;

      const addedTools = (node.params?.addedTools ?? []) as AddedToolInstance[];
      if (addedTools.length === 0) {
        return { success: false, error: 'This agent node has no tools to remove' };
      }

      // Find the tool to remove
      const idx = instanceId
        ? addedTools.findIndex((t) => t.instanceId === instanceId)
        : addedTools.findIndex((t) => t.toolId === toolId);

      if (idx === -1) {
        return {
          success: false,
          error: instanceId
            ? `Tool instance "${instanceId}" not found on this agent`
            : `No tool with ID "${toolId}" found on this agent`,
          suggestion: 'Use get_agent_node_tools to see current tools.',
        };
      }

      const removed = addedTools[idx];
      addedTools.splice(idx, 1);
      if (node.params) {
        node.params.addedTools = addedTools;
      }

      const version = await saveNewVersion(flowlib, flowId, nodes, edges);

      return {
        success: true,
        data: {
          removedInstanceId: removed.instanceId,
          removedToolId: removed.toolId,
          removedName: removed.name,
          nodeId,
          versionNumber: version.version,
          remainingTools: addedTools.length,
        },
        uiAction: {
          action: 'refresh_flow',
          data: { flowId, selectNodeId: nodeId },
        },
      };
    } catch (error: unknown) {
      return { success: false, error: `Failed to remove tool: ${(error as Error).message}` };
    }
  },
};

// =====================================
// update_agent_tool
// =====================================

export const updateAgentToolTool: ChatToolDefinition = {
  id: 'update_agent_tool',
  name: 'Update Agent Tool',
  description:
    'Update the configuration of a tool instance on an AGENT node. ' +
    'Can change the name, description, parameters, or which params the AI fills vs static values. ' +
    'Params are merged (not replaced) — only specified params are updated.',
  parameters: z.object({
    nodeId: z.string().describe('ID of the AGENT node'),
    instanceId: z.string().optional().describe('Instance ID of the tool to update (preferred)'),
    toolId: z
      .string()
      .optional()
      .describe('Base tool ID — updates the first instance matching this tool'),
    name: z.string().optional().describe('New custom name'),
    description: z.string().optional().describe('New custom description'),
    params: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Parameter values to set or update (merged with existing)'),
    aiChosenParams: z
      .array(z.string())
      .optional()
      .describe('Updated list of parameter names the AI should fill at runtime'),
  }),
  async execute(params: unknown, ctx: ChatToolContext): Promise<ChatToolResult> {
    const {
      nodeId,
      instanceId,
      toolId,
      name,
      description,
      params: newParams,
      aiChosenParams,
    } = params as {
      nodeId: string;
      instanceId?: string;
      toolId?: string;
      name?: string;
      description?: string;
      params?: Record<string, unknown>;
      aiChosenParams?: string[];
    };
    const flowlib = ctx.flowlib;
    const flowId = ctx.chatContext.flowId;

    if (!flowId) {
      return { success: false, error: 'No flow is currently open' };
    }
    if (!instanceId && !toolId) {
      return {
        success: false,
        error: 'Provide either instanceId or toolId to identify the tool to update',
      };
    }

    try {
      const { nodes, edges } = await loadLatestDefinition(flowlib, flowId);
      const agentResult = unwrapAgentNode(findAgentNode(nodes, nodeId));
      if (!agentResult.node) {
        return agentResult.errorResult;
      }
      const node = agentResult.node;

      const addedTools = (node.params?.addedTools ?? []) as AddedToolInstance[];
      const tool = instanceId
        ? addedTools.find((t) => t.instanceId === instanceId)
        : addedTools.find((t) => t.toolId === toolId);

      if (!tool) {
        return {
          success: false,
          error: instanceId
            ? `Tool instance "${instanceId}" not found`
            : `No tool with ID "${toolId}" found`,
          suggestion: 'Use get_agent_node_tools to see current tools.',
        };
      }

      // Update fields
      if (name) {
        tool.name = name;
      }
      if (description) {
        tool.description = description;
      }

      // Merge params
      if (newParams) {
        const existingParams = { ...tool.params };
        const aiModes = existingParams._aiChosenModes as Record<string, boolean> | undefined;
        delete existingParams._aiChosenModes;

        tool.params = {
          ...existingParams,
          ...newParams,
          ...(aiModes ? { _aiChosenModes: aiModes } : {}),
        };
      }

      // Update AI chosen modes if specified
      if (aiChosenParams) {
        const modes: Record<string, boolean> = {};
        const allParamKeys = Object.keys(tool.params).filter((k) => k !== '_aiChosenModes');
        for (const key of allParamKeys) {
          modes[key] = aiChosenParams.includes(key);
        }
        for (const key of aiChosenParams) {
          modes[key] = true;
        }
        tool.params._aiChosenModes = modes;
      }

      if (node.params) {
        node.params.addedTools = addedTools;
      }

      const version = await saveNewVersion(flowlib, flowId, nodes, edges);

      return {
        success: true,
        data: {
          instanceId: tool.instanceId,
          toolId: tool.toolId,
          name: tool.name,
          updatedFields: [
            ...(name ? ['name'] : []),
            ...(description ? ['description'] : []),
            ...(newParams ? Object.keys(newParams) : []),
            ...(aiChosenParams ? ['aiChosenParams'] : []),
          ],
          nodeId,
          versionNumber: version.version,
        },
        uiAction: {
          action: 'refresh_flow',
          data: { flowId, selectNodeId: nodeId },
        },
      };
    } catch (error: unknown) {
      return { success: false, error: `Failed to update tool: ${(error as Error).message}` };
    }
  },
};

// =====================================
// configure_agent
// =====================================

export const configureAgentTool: ChatToolDefinition = {
  id: 'configure_agent',
  name: 'Configure Agent',
  description:
    "Configure an AGENT node's core settings: model, prompts, stop condition, temperature, etc. " +
    "This does NOT modify the agent's tools — use add_tool_to_agent / remove_tool_from_agent for that. " +
    'Params are merged with existing config.',
  parameters: z.object({
    nodeId: z.string().describe('ID of the AGENT node'),
    credentialId: z.string().optional().describe('LLM provider credential ID'),
    model: z.string().optional().describe('Model name (e.g. "gpt-4o-mini", "claude-sonnet-4-0")'),
    taskPrompt: z
      .string()
      .optional()
      .describe('Main task prompt (supports {{ template }} variables)'),
    systemPrompt: z.string().optional().describe('System prompt / instructions'),
    maxIterations: z.number().optional().describe('Max tool-call iterations (1-200)'),
    stopCondition: z
      .enum(['explicit_stop', 'tool_result', 'max_iterations'])
      .optional()
      .describe('When should the agent stop iterating'),
    temperature: z.number().optional().describe('LLM temperature (0-2)'),
    enableParallelTools: z.boolean().optional().describe('Allow parallel tool execution'),
  }),
  async execute(params: unknown, ctx: ChatToolContext): Promise<ChatToolResult> {
    const { nodeId, ...updates } = params as {
      nodeId: string;
      [key: string]: unknown;
    };
    const flowlib = ctx.flowlib;
    const flowId = ctx.chatContext.flowId;

    if (!flowId) {
      return { success: false, error: 'No flow is currently open' };
    }

    // Filter out undefined values
    const definedUpdates = Object.fromEntries(
      Object.entries(updates).filter(([, v]) => v !== undefined),
    );

    if (Object.keys(definedUpdates).length === 0) {
      return { success: false, error: 'No configuration values provided to update' };
    }

    try {
      const { nodes, edges } = await loadLatestDefinition(flowlib, flowId);
      const agentResult = unwrapAgentNode(findAgentNode(nodes, nodeId));
      if (!agentResult.node) {
        return agentResult.errorResult;
      }
      const node = agentResult.node;

      // Merge params — preserve addedTools (never overwrite tool config here)
      const existingParams = node.params ?? {};

      // Validate credentialId exists before saving
      if (definedUpdates.credentialId) {
        try {
          await flowlib.credentials.get(definedUpdates.credentialId as string);
        } catch {
          return {
            success: false,
            error: `Credential "${definedUpdates.credentialId}" not found. Use list_credentials to find available credential IDs.`,
          };
        }
      }

      // Soft model/provider consistency check
      let warnings: string[] | undefined;
      const model = (definedUpdates.model as string) ?? (existingParams.model as string);
      if (model) {
        const modelLower = model.toLowerCase();
        const credId =
          (definedUpdates.credentialId as string) ?? (existingParams.credentialId as string);
        if (credId) {
          try {
            const cred = await flowlib.credentials.get(credId);
            const provider = cred?.config?.provider as string | undefined;
            if (provider) {
              const providerLower = provider.toLowerCase();
              // Basic prefix-based check
              const mismatch =
                (providerLower.includes('openai') && modelLower.startsWith('claude')) ||
                (providerLower.includes('anthropic') &&
                  (modelLower.startsWith('gpt') ||
                    modelLower.startsWith('o1') ||
                    modelLower.startsWith('o3')));
              if (mismatch) {
                warnings = [
                  `Model "${model}" may not match credential provider "${provider}". This will fail at runtime if the provider doesn't support this model.`,
                ];
              }
            }
          } catch {
            // Best-effort — don't fail the tool on lookup errors
          }
        }
      }

      // Strip any tool-related keys that might have leaked into the updates
      delete definedUpdates.addedTools;
      node.params = {
        ...existingParams,
        ...definedUpdates,
      };

      const version = await saveNewVersion(flowlib, flowId, nodes, edges);

      return {
        success: true,
        data: {
          nodeId,
          updatedFields: Object.keys(definedUpdates),
          versionNumber: version.version,
          ...(warnings && { warnings }),
        },
        uiAction: {
          action: 'refresh_flow',
          data: { flowId, selectNodeId: nodeId },
        },
      };
    } catch (error: unknown) {
      return { success: false, error: `Failed to configure agent: ${(error as Error).message}` };
    }
  },
};

// =====================================
// copy_agent_tools
// =====================================

export const copyAgentToolsTool: ChatToolDefinition = {
  id: 'copy_agent_tools',
  name: 'Copy Agent Tools',
  description:
    'Copy all tool instances from one AGENT node to another. ' +
    'Tool instances are deep-cloned with new instanceIds. ' +
    'Existing tools on the target node are preserved (the copied tools are appended). ' +
    'Both nodes can be in the same or different flows.',
  parameters: z.object({
    sourceNodeId: z.string().describe('The AGENT node ID to copy tools from'),
    targetNodeId: z.string().describe('The AGENT node ID to copy tools to'),
    sourceFlowId: z
      .string()
      .optional()
      .describe('Flow ID of the source node. Defaults to the current flow.'),
    targetFlowId: z
      .string()
      .optional()
      .describe('Flow ID of the target node. Defaults to the current flow.'),
  }),
  async execute(params: unknown, ctx: ChatToolContext): Promise<ChatToolResult> {
    const { sourceNodeId, targetNodeId, sourceFlowId, targetFlowId } = params as {
      sourceNodeId: string;
      targetNodeId: string;
      sourceFlowId?: string;
      targetFlowId?: string;
    };
    const flowlib = ctx.flowlib;
    const currentFlowId = ctx.chatContext.flowId;

    const srcFlowId = sourceFlowId ?? currentFlowId;
    const tgtFlowId = targetFlowId ?? currentFlowId;

    if (!srcFlowId) {
      return { success: false, error: 'No flow is currently open. Provide sourceFlowId.' };
    }
    if (!tgtFlowId) {
      return { success: false, error: 'No flow is currently open. Provide targetFlowId.' };
    }

    try {
      // Load source flow and find agent node
      const srcDef = await loadLatestDefinition(flowlib, srcFlowId);
      const srcResult = unwrapAgentNode(findAgentNode(srcDef.nodes, sourceNodeId));
      if (!srcResult.node) {
        return srcResult.errorResult;
      }

      const sourceTools: AddedToolInstance[] =
        (srcResult.node.params?.addedTools as AddedToolInstance[]) ?? [];
      if (sourceTools.length === 0) {
        return { success: false, error: 'Source agent node has no tools to copy.' };
      }

      // Load target flow (may be the same flow)
      const tgtDef =
        tgtFlowId === srcFlowId ? srcDef : await loadLatestDefinition(flowlib, tgtFlowId);
      const tgtResult = unwrapAgentNode(findAgentNode(tgtDef.nodes, targetNodeId));
      if (!tgtResult.node) {
        return tgtResult.errorResult;
      }

      // Deep-clone tools with new instanceIds
      const existingTools: AddedToolInstance[] =
        (tgtResult.node.params?.addedTools as AddedToolInstance[]) ?? [];
      const clonedTools: AddedToolInstance[] = sourceTools.map((tool) => ({
        ...structuredClone(tool),
        instanceId: crypto.randomUUID(),
      }));

      tgtResult.node.params = {
        ...tgtResult.node.params,
        addedTools: [...existingTools, ...clonedTools],
      };

      const version = await saveNewVersion(flowlib, tgtFlowId, tgtDef.nodes, tgtDef.edges);

      return {
        success: true,
        data: {
          copiedCount: clonedTools.length,
          copiedToolNames: clonedTools.map((t) => t.name),
          targetNodeId,
          totalToolsOnTarget: existingTools.length + clonedTools.length,
          versionNumber: version.version,
        },
        uiAction: {
          action: 'refresh_flow',
          data: { flowId: tgtFlowId, selectNodeId: targetNodeId },
        },
      };
    } catch (error: unknown) {
      return { success: false, error: `Failed to copy tools: ${(error as Error).message}` };
    }
  },
};

// =====================================
// Export all agent tools
// =====================================

export const agentNodeTools: ChatToolDefinition[] = [
  listAgentToolsTool,
  getToolDetailsTool,
  getAgentNodeToolsTool,
  addToolToAgentTool,
  removeToolFromAgentTool,
  updateAgentToolTool,
  configureAgentTool,
  copyAgentToolsTool,
];
