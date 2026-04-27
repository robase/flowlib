/**
 * Node reference tools — list available providers and node types.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlowlibClient } from '../client/types';
import { TOOL_IDS } from '../../shared/types';
import { mapProviderList, mapNodeList, mapFieldOptions } from '../response-mappers';

export function registerNodeTools(server: McpServer, client: FlowlibClient): void {
  server.registerTool(
    TOOL_IDS.NODE_LIST_PROVIDERS,
    {
      description:
        'List all available node providers (core, http, gmail, slack, github, etc.) with their metadata',
      inputSchema: {},
    },
    async () => {
      const providers = await client.listProviders();
      return { content: [{ type: 'text', text: mapProviderList(providers) }] };
    },
  );

  server.registerTool(
    TOOL_IDS.NODE_LIST_AVAILABLE,
    {
      description:
        'List all available node types with their IDs, names, parameter schemas, and field definitions. Use this to understand what nodes can be added to flows.',
      inputSchema: {},
    },
    async () => {
      const nodes = await client.listAvailableNodes();
      return { content: [{ type: 'text', text: mapNodeList(nodes) }] };
    },
  );

  server.registerTool(
    TOOL_IDS.NODE_LIST_FOR_PROVIDER,
    {
      description:
        'List only the node types belonging to a single provider (e.g. "slack", "github"). Smaller than node_list_available when the agent already knows which integration it wants.',
      inputSchema: {
        providerId: z.string().describe('Provider id (e.g. "slack", "github", "core")'),
      },
    },
    async ({ providerId }) => {
      const nodes = await client.listNodesForProvider(providerId);
      return { content: [{ type: 'text', text: mapNodeList(nodes) }] };
    },
  );

  server.registerTool(
    TOOL_IDS.NODE_RESOLVE_FIELD_OPTIONS,
    {
      description:
        'Resolve the dynamic options for a configured node field (e.g. a Slack channel picker, a Gmail label picker, a Sheets selector). Required for agents building flows that reference external resources by ID.',
      inputSchema: {
        actionId: z.string().describe('Action id (e.g. "slack.send_message")'),
        fieldName: z.string().describe('Field name whose options should be loaded'),
        deps: z
          .record(z.unknown())
          .describe('Current values of fields the option loader depends on (e.g. credentialId)'),
      },
    },
    async ({ actionId, fieldName, deps }) => {
      const result = await client.resolveFieldOptions(actionId, fieldName, deps);
      return { content: [{ type: 'text', text: mapFieldOptions(result) }] };
    },
  );
}
