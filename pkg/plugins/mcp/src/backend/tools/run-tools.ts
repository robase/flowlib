/**
 * Flow execution tools — start, monitor, and control flow runs.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlowlibClient } from '../client/types';
import { TOOL_IDS } from '../../shared/types';
import {
  mapRunStarted,
  mapRun,
  mapRunList,
  mapNodeExecutions,
  mapToolExecutions,
} from '../response-mappers';

export function registerRunTools(server: McpServer, client: FlowlibClient): void {
  server.registerTool(
    TOOL_IDS.RUN_START,
    {
      description:
        'Execute a flow synchronously with optional input values. Blocks until the run reaches a terminal state (SUCCESS, FAILED, CANCELLED) and returns the full result. Use run_start_async for long-running or AI-heavy flows.',
      inputSchema: {
        flowId: z.string().describe('The flow ID to execute'),
        inputs: z
          .record(z.unknown())
          .optional()
          .describe('Optional key-value input data for the flow'),
      },
    },
    async ({ flowId, inputs }) => {
      const result = await client.startRun(flowId, inputs);
      return { content: [{ type: 'text', text: mapRun(result) }] };
    },
  );

  server.registerTool(
    TOOL_IDS.RUN_START_ASYNC,
    {
      description:
        'Start a flow run asynchronously and return immediately with the flow run id. The run continues in the background; poll run_get to monitor progress.',
      inputSchema: {
        flowId: z.string().describe('The flow ID to execute'),
        inputs: z
          .record(z.unknown())
          .optional()
          .describe('Optional key-value input data for the flow'),
      },
    },
    async ({ flowId, inputs }) => {
      const result = await client.startRunAsync(flowId, inputs);
      return { content: [{ type: 'text', text: mapRunStarted(result) }] };
    },
  );

  server.registerTool(
    TOOL_IDS.RUN_TO_NODE,
    {
      description:
        'Execute a flow up to a specific node (for debugging). Returns partial results stopping at the target node.',
      inputSchema: {
        flowId: z.string().describe('The flow ID'),
        nodeId: z.string().describe('Stop execution at this node ID'),
        inputs: z.record(z.unknown()).optional().describe('Optional input data'),
      },
    },
    async ({ flowId, nodeId, inputs }) => {
      const result = await client.runToNode(flowId, nodeId, inputs);
      return { content: [{ type: 'text', text: mapRun(result) }] };
    },
  );

  server.registerTool(
    TOOL_IDS.RUN_LIST,
    {
      description: 'List execution history for a flow, including status, timing, and errors',
      inputSchema: { flowId: z.string().describe('The flow ID') },
    },
    async ({ flowId }) => {
      const result = await client.listRuns(flowId);
      return { content: [{ type: 'text', text: mapRunList(result) }] };
    },
  );

  server.registerTool(
    TOOL_IDS.RUN_GET,
    {
      description:
        'Get detailed results of a specific flow run including status, output, timing, and any errors',
      inputSchema: { flowRunId: z.string().describe('The flow run ID') },
    },
    async ({ flowRunId }) => {
      const run = await client.getRun(flowRunId);
      return { content: [{ type: 'text', text: mapRun(run) }] };
    },
  );

  server.registerTool(
    TOOL_IDS.RUN_CANCEL,
    {
      description: 'Cancel a running flow execution',
      inputSchema: { flowRunId: z.string().describe('The flow run ID to cancel') },
    },
    async ({ flowRunId }) => {
      const result = await client.cancelRun(flowRunId);
      return {
        content: [{ type: 'text', text: `Run ${flowRunId} cancelled. ${result.message || ''}` }],
      };
    },
  );

  server.registerTool(
    TOOL_IDS.RUN_PAUSE,
    {
      description: 'Pause a running flow execution (can be resumed later)',
      inputSchema: { flowRunId: z.string().describe('The flow run ID to pause') },
    },
    async ({ flowRunId }) => {
      const result = await client.pauseRun(flowRunId);
      return {
        content: [{ type: 'text', text: `Run ${flowRunId} paused. ${result.message || ''}` }],
      };
    },
  );

  server.registerTool(
    TOOL_IDS.RUN_RESUME,
    {
      description: 'Resume a previously paused flow execution',
      inputSchema: { flowRunId: z.string().describe('The flow run ID to resume') },
    },
    async ({ flowRunId }) => {
      const result = await client.resumeRun(flowRunId);
      return {
        content: [{ type: 'text', text: `Run ${flowRunId} resumed. ${result.message || ''}` }],
      };
    },
  );

  server.registerTool(
    TOOL_IDS.RUN_LIST_NODE_EXECUTIONS,
    {
      description: 'List node executions across all runs (cross-run debug view).',
      inputSchema: {},
    },
    async () => {
      const items = await client.listNodeExecutions();
      return { content: [{ type: 'text', text: mapNodeExecutions(items) }] };
    },
  );

  server.registerTool(
    TOOL_IDS.RUN_GET_TOOL_EXECUTIONS,
    {
      description:
        'Get the tools an agent called during a specific node execution. Critical for debugging agent nodes — reveals which tools the agent invoked, with what arguments, and what they returned.',
      inputSchema: {
        nodeExecutionId: z.string().describe('The node execution ID (from debug_node_executions)'),
      },
    },
    async ({ nodeExecutionId }) => {
      const items = await client.getToolExecutions(nodeExecutionId);
      return { content: [{ type: 'text', text: mapToolExecutions(items) }] };
    },
  );
}
