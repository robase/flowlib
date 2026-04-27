/**
 * Agent tools — introspect the agent tool registry.
 *
 * Prompt submission is intentionally NOT exposed — MCP clients already have
 * an LLM and should not round-trip prompts through an Flowlib agent.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlowlibClient } from '../client/types';
import { TOOL_IDS } from '../../shared/types';
import { mapAgentTools } from '../response-mappers';

export function registerAgentTools(server: McpServer, client: FlowlibClient): void {
  server.registerTool(
    TOOL_IDS.AGENT_LIST_TOOLS,
    {
      description:
        'List every tool available to Flowlib agent nodes. Every built-in action is automatically registered as an agent tool, plus any standalone tools the host has added. Useful when configuring an AGENT node in a flow.',
      inputSchema: {},
    },
    async () => {
      const tools = await client.listAgentTools();
      return { content: [{ type: 'text', text: mapAgentTools(tools) }] };
    },
  );
}
