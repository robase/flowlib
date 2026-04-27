/**
 * Debugging & testing tools — node execution traces, expression testing, stats.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlowlibClient } from '../client/types';
import { TOOL_IDS } from '../../shared/types';
import { mapNodeExecutions, mapTestResult } from '../response-mappers';

export function registerDebugTools(server: McpServer, client: FlowlibClient): void {
  server.registerTool(
    TOOL_IDS.DEBUG_NODE_EXECUTIONS,
    {
      description:
        "Get per-node execution traces for a flow run, including each node's input, output, timing, and errors. Essential for debugging failed runs.",
      inputSchema: { flowRunId: z.string().describe('The flow run ID') },
    },
    async ({ flowRunId }) => {
      const executions = await client.getNodeExecutions(flowRunId);
      return { content: [{ type: 'text', text: mapNodeExecutions(executions) }] };
    },
  );

  server.registerTool(
    TOOL_IDS.DEBUG_TEST_NODE,
    {
      description:
        'Execute a single node type in isolation with given parameters and input data. Useful for testing node configuration before adding to a flow.',
      inputSchema: {
        nodeType: z
          .string()
          .describe('Action ID of the node type (e.g., "core.jq", "http.request")'),
        params: z.record(z.unknown()).describe('Node configuration parameters'),
        inputData: z
          .record(z.unknown())
          .optional()
          .describe('Simulated incoming data from upstream nodes'),
      },
    },
    async ({ nodeType, params, inputData }) => {
      const result = await client.testNode(nodeType, params, inputData);
      return { content: [{ type: 'text', text: mapTestResult(result) }] };
    },
  );

  server.registerTool(
    TOOL_IDS.DEBUG_TEST_EXPRESSION,
    {
      description:
        'Test a JavaScript template expression ({{ ... }}) against a sample data context. Evaluates in the same QuickJS WASM sandbox used by flow templates.',
      inputSchema: {
        expression: z
          .string()
          .describe(
            'JS template expression to test (e.g., "{{ users.filter(u => u.active).length }}")',
          ),
        context: z
          .record(z.unknown())
          .describe('Sample data context to evaluate the expression against'),
      },
    },
    async ({ expression, context }) => {
      const result = await client.testJsExpression(expression, context);
      return { content: [{ type: 'text', text: mapTestResult(result) }] };
    },
  );

  server.registerTool(
    TOOL_IDS.DEBUG_TEST_MAPPER,
    {
      description: 'Test a data mapper/transformation expression against sample incoming data',
      inputSchema: {
        expression: z.string().describe('Mapper expression to evaluate'),
        incomingData: z.record(z.unknown()).describe('Sample incoming data to map'),
      },
    },
    async ({ expression, incomingData }) => {
      const result = await client.testMapper(expression, incomingData);
      return { content: [{ type: 'text', text: mapTestResult(result) }] };
    },
  );
}
