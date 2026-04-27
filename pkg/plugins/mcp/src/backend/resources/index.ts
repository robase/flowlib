/**
 * MCP Resources — expose flow data as readable resources.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlowlibClient } from '../client/types';

export function registerResources(server: McpServer, client: FlowlibClient): void {
  // Resource template: individual flow definition
  server.registerResource(
    'flow-definition',
    new ResourceTemplate('flowlib://flows/{flowId}/definition', { list: undefined }),
    { description: 'The current definition of a specific flow (nodes, edges, params)' },
    async (uri) => {
      const match = uri.href.match(/^flowlib:\/\/flows\/([^/]+)\/definition$/);
      if (!match?.[1]) {
        return {
          contents: [{ uri: uri.href, text: 'Invalid flow URI', mimeType: 'text/plain' }],
        };
      }
      const flowId = decodeURIComponent(match[1]);
      const def = await client.getFlowDefinition(flowId);
      return {
        contents: [
          {
            uri: uri.href,
            text: JSON.stringify(def, null, 2),
            mimeType: 'application/json',
          },
        ],
      };
    },
  );

  // Resource template: flow run result
  server.registerResource(
    'flow-run',
    new ResourceTemplate('flowlib://runs/{flowRunId}', { list: undefined }),
    { description: 'The result details of a specific flow run' },
    async (uri) => {
      const match = uri.href.match(/^flowlib:\/\/runs\/([^/]+)$/);
      if (!match?.[1]) {
        return {
          contents: [{ uri: uri.href, text: 'Invalid run URI', mimeType: 'text/plain' }],
        };
      }
      const flowRunId = decodeURIComponent(match[1]);
      const run = await client.getRun(flowRunId);
      return {
        contents: [
          {
            uri: uri.href,
            text: JSON.stringify(run, null, 2),
            mimeType: 'application/json',
          },
        ],
      };
    },
  );

  // Static resource: list of flows
  server.registerResource(
    'flows',
    'flowlib://flows',
    { description: 'List of all flows' },
    async (uri) => {
      const flows = await client.listFlows();
      return {
        contents: [
          {
            uri: uri.href,
            text: JSON.stringify(flows, null, 2),
            mimeType: 'application/json',
          },
        ],
      };
    },
  );

  // Static resource: sanitised credential list
  server.registerResource(
    'credentials',
    'flowlib://credentials',
    { description: 'List of all credentials (metadata only, no secrets)' },
    async (uri) => {
      const creds = await client.listCredentials();
      return {
        contents: [
          {
            uri: uri.href,
            text: JSON.stringify(creds, null, 2),
            mimeType: 'application/json',
          },
        ],
      };
    },
  );

  // Resource template: node executions for a flow run
  server.registerResource(
    'run-node-executions',
    new ResourceTemplate('flowlib://runs/{flowRunId}/node-executions', { list: undefined }),
    { description: 'Per-node execution traces for a flow run' },
    async (uri) => {
      const match = uri.href.match(/^flowlib:\/\/runs\/([^/]+)\/node-executions$/);
      if (!match?.[1]) {
        return {
          contents: [{ uri: uri.href, text: 'Invalid URI', mimeType: 'text/plain' }],
        };
      }
      const flowRunId = decodeURIComponent(match[1]);
      const executions = await client.getNodeExecutions(flowRunId);
      return {
        contents: [
          {
            uri: uri.href,
            text: JSON.stringify(executions, null, 2),
            mimeType: 'application/json',
          },
        ],
      };
    },
  );
}
