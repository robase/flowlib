/**
 * Flow version management tools.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlowlibClient } from '../client/types';
import { TOOL_IDS } from '../../shared/types';
import { mapVersionList, mapFlowDefinition } from '../response-mappers';

export function registerVersionTools(server: McpServer, client: FlowlibClient): void {
  server.registerTool(
    TOOL_IDS.VERSION_LIST,
    {
      description: 'List all versions of a flow with version numbers and timestamps',
      inputSchema: { flowId: z.string().describe('The flow ID') },
    },
    async ({ flowId }) => {
      const result = await client.listVersions(flowId);
      return { content: [{ type: 'text', text: mapVersionList(result) }] };
    },
  );

  server.registerTool(
    TOOL_IDS.VERSION_GET,
    {
      description: 'Get a specific version\'s full definition by version number or "latest"',
      inputSchema: {
        flowId: z.string().describe('The flow ID'),
        version: z.string().describe('Version number or "latest"'),
      },
    },
    async ({ flowId, version }) => {
      const v = await client.getVersion(flowId, version);
      return { content: [{ type: 'text', text: mapFlowDefinition(v) }] };
    },
  );

  server.registerTool(
    TOOL_IDS.VERSION_PUBLISH,
    {
      description:
        'Publish a new version of a flow with a complete definition (nodes, edges, configuration)',
      inputSchema: {
        flowId: z.string().describe('The flow ID'),
        definition: z
          .object({
            nodes: z.array(z.unknown()),
            edges: z.array(z.unknown()).optional(),
          })
          .passthrough()
          .describe('The complete flow definition to publish'),
      },
    },
    async ({ flowId, definition }) => {
      const v = await client.publishVersion(flowId, definition);
      return { content: [{ type: 'text', text: mapFlowDefinition(v) }] };
    },
  );
}
