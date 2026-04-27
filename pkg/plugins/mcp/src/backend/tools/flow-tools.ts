/**
 * Flow management tools — CRUD + inspection.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlowlibClient } from '../client/types';
import { TOOL_IDS } from '../../shared/types';
import {
  mapFlowList,
  mapFlow,
  mapFlowDefinition,
  mapValidation,
  mapSdkSource,
} from '../response-mappers';

export function registerFlowTools(server: McpServer, client: FlowlibClient): void {
  server.registerTool(
    TOOL_IDS.FLOW_LIST,
    {
      description: 'List all flows with their names, IDs, status, and metadata',
      inputSchema: {},
    },
    async () => {
      const result = await client.listFlows();
      return { content: [{ type: 'text', text: mapFlowList(result) }] };
    },
  );

  server.registerTool(
    TOOL_IDS.FLOW_GET,
    {
      description: 'Get detailed metadata for a specific flow by ID',
      inputSchema: { flowId: z.string().describe('The flow ID') },
    },
    async ({ flowId }) => {
      const flow = await client.getFlow(flowId);
      return { content: [{ type: 'text', text: mapFlow(flow) }] };
    },
  );

  server.registerTool(
    TOOL_IDS.FLOW_GET_DEFINITION,
    {
      description:
        'Get the current flow definition including all nodes, edges, and configuration parameters',
      inputSchema: { flowId: z.string().describe('The flow ID') },
    },
    async ({ flowId }) => {
      const def = await client.getFlowDefinition(flowId);
      if (def === null || def === undefined) {
        return {
          content: [
            {
              type: 'text',
              text: 'Flow has no published version yet. Use version_publish to create one.',
            },
          ],
        };
      }
      return { content: [{ type: 'text', text: mapFlowDefinition(def) }] };
    },
  );

  server.registerTool(
    TOOL_IDS.FLOW_GET_SDK_SOURCE,
    {
      description:
        'Emit the flow definition as @flowlib/sdk TypeScript source (defineFlow + node helpers + provider action callables). Ready to drop into a TS file and version-control. Throws if the flow contains a structurally unrepresentable node.',
      inputSchema: {
        flowId: z.string().describe('The flow ID'),
        version: z
          .union([z.string(), z.number()])
          .optional()
          .describe('Version number or "latest" (default: "latest")'),
        flowName: z
          .string()
          .optional()
          .describe('Exported const name in the emitted source (default: "myFlow")'),
        sdkImport: z
          .string()
          .optional()
          .describe('Import specifier for SDK helpers (default: "@flowlib/sdk")'),
      },
    },
    async ({ flowId, version, flowName, sdkImport }) => {
      const result = await client.getFlowSdkSource(flowId, {
        version: version as string | number | undefined,
        flowName,
        sdkImport,
      });
      return { content: [{ type: 'text', text: mapSdkSource(result) }] };
    },
  );

  server.registerTool(
    TOOL_IDS.FLOW_CREATE,
    {
      description: 'Create a new empty flow with a name and optional description',
      inputSchema: {
        name: z.string().describe('Flow name'),
        description: z.string().optional().describe('Flow description'),
      },
    },
    async ({ name, description }) => {
      const flow = await client.createFlow({ name, description });
      return { content: [{ type: 'text', text: mapFlow(flow) }] };
    },
  );

  server.registerTool(
    TOOL_IDS.FLOW_UPDATE,
    {
      description: "Update a flow's name or description",
      inputSchema: {
        flowId: z.string().describe('The flow ID'),
        name: z.string().optional().describe('New name'),
        description: z.string().optional().describe('New description'),
      },
    },
    async ({ flowId, name, description }) => {
      const flow = await client.updateFlow(flowId, { name, description });
      return { content: [{ type: 'text', text: mapFlow(flow) }] };
    },
  );

  server.registerTool(
    TOOL_IDS.FLOW_DELETE,
    {
      description: 'Permanently delete a flow and all its versions and run history',
      inputSchema: { flowId: z.string().describe('The flow ID to delete') },
    },
    async ({ flowId }) => {
      await client.deleteFlow(flowId);
      return { content: [{ type: 'text', text: `Flow ${flowId} deleted successfully.` }] };
    },
  );

  server.registerTool(
    TOOL_IDS.FLOW_VALIDATE,
    {
      description:
        'Validate a flow definition against the schema without saving it. Returns structured errors for malformed or semantically invalid definitions.',
      inputSchema: {
        flowId: z.string().describe('The flow ID'),
        definition: z
          .object({
            nodes: z.array(z.unknown()),
            edges: z.array(z.unknown()).optional(),
          })
          .passthrough()
          .describe('The flow definition (at minimum: { nodes, edges? })'),
      },
    },
    async ({ flowId, definition }) => {
      const result = await client.validateFlow(flowId, definition);
      return { content: [{ type: 'text', text: mapValidation(result) }] };
    },
  );
}
