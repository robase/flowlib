/**
 * Chat Tools — Run & Debug
 *
 * Tools for inspecting flow runs, node executions, and testing nodes.
 * These are essential for the assistant to reason about "why did this fail?"
 */

import { z } from 'zod/v4';
import type { ChatToolDefinition, ChatToolContext, ChatToolResult } from '../chat-types';

// =====================================
// get_flow_run
// =====================================

export const getFlowRunTool: ChatToolDefinition = {
  id: 'get_flow_run',
  name: 'Get Flow Run',
  description:
    'Get the details of a specific flow run by its ID. ' +
    'Returns status, duration, inputs, outputs, and error information. ' +
    'Use this after run_flow to inspect results, or to investigate a past run.',
  parameters: z.object({
    flowRunId: z.string().describe('The flow run ID to inspect'),
  }),
  async execute(params: unknown, ctx: ChatToolContext): Promise<ChatToolResult> {
    const { flowRunId } = params as { flowRunId: string };
    const flowlib = ctx.flowlib;

    try {
      const run = await flowlib.runs.get(flowRunId);
      if (!run) {
        return { success: false, error: `Flow run "${flowRunId}" not found` };
      }

      return {
        success: true,
        data: {
          id: run.id,
          flowId: run.flowId,
          status: run.status,
          flowVersion: run.flowVersion,
          duration: run.duration,
          inputs: run.inputs,
          outputs: run.outputs,
          error: run.error,
          startedAt: run.startedAt,
          completedAt: run.completedAt,
          triggerType: run.triggerType,
        },
      };
    } catch (error: unknown) {
      return { success: false, error: `Failed to get flow run: ${(error as Error).message}` };
    }
  },
};

// =====================================
// get_node_execution_results
// =====================================

export const getNodeExecutionResultsTool: ChatToolDefinition = {
  id: 'get_node_execution_results',
  name: 'Get Node Execution Results',
  description:
    'Get the execution trace for every node in a flow run. ' +
    'Shows per-node status, inputs, outputs, duration, and errors. ' +
    'For AGENT nodes, also returns per-iteration tool call details (tool name, success, duration, error). ' +
    'Essential for debugging — tells you exactly which node failed and why.',
  parameters: z.object({
    flowRunId: z.string().describe('The flow run ID to get node executions for'),
  }),
  async execute(params: unknown, ctx: ChatToolContext): Promise<ChatToolResult> {
    const { flowRunId } = params as { flowRunId: string };
    const flowlib = ctx.flowlib;

    try {
      const executionsResult = await flowlib.runs.getNodeExecutions(flowRunId);

      // Return a compact view — full outputs can be huge
      const traces = await Promise.all(
        executionsResult.data.map(async (ex) => {
          const base = {
            nodeId: ex.nodeId,
            nodeType: ex.nodeType,
            status: ex.status,
            duration: ex.duration,
            error: ex.error,
            // Truncate large outputs to keep context manageable
            output: ex.outputs
              ? JSON.stringify(ex.outputs).length > 2000
                ? JSON.stringify(ex.outputs).slice(0, 2000) + '…(truncated)'
                : ex.outputs
              : undefined,
            input: ex.inputs
              ? JSON.stringify(ex.inputs).length > 1000
                ? JSON.stringify(ex.inputs).slice(0, 1000) + '…(truncated)'
                : ex.inputs
              : undefined,
          } as Record<string, unknown>;

          // For agent nodes, fetch tool execution details per iteration
          if (ex.nodeType === 'core.agent') {
            try {
              const toolExecs = await flowlib.runs.getToolExecutionsByNodeExecutionId(ex.id);
              if (toolExecs.length > 0) {
                // Group by iteration for clarity
                const byIteration = new Map<number, typeof toolExecs>();
                for (const te of toolExecs) {
                  const iter = te.iteration ?? 0;
                  if (!byIteration.has(iter)) {
                    byIteration.set(iter, []);
                  }
                  byIteration.get(iter)?.push(te);
                }

                base.agentDetails = {
                  totalToolCalls: toolExecs.length,
                  iterations: Array.from(byIteration.entries()).map(([iteration, calls]) => ({
                    iteration,
                    toolCalls: calls.map((tc) => ({
                      toolId: tc.toolId,
                      toolName: tc.toolName,
                      success: tc.success,
                      duration: tc.duration,
                      error: tc.error,
                      // Truncate tool output to keep context manageable
                      output: tc.output
                        ? JSON.stringify(tc.output).length > 500
                          ? JSON.stringify(tc.output).slice(0, 500) + '…(truncated)'
                          : tc.output
                        : undefined,
                    })),
                  })),
                };
              }
            } catch {
              // Best-effort — don't fail trace retrieval if tool executions can't be fetched
            }
          }

          return base;
        }),
      );

      const failedNodes = traces.filter((t) => t.status === 'FAILED' || t.error);

      return {
        success: true,
        data: {
          totalNodes: traces.length,
          failedCount: failedNodes.length,
          traces,
          ...(failedNodes.length > 0 && {
            failureSummary: failedNodes.map((n) => `${n.nodeId} (${n.nodeType}): ${n.error}`),
          }),
        },
      };
    } catch (error: unknown) {
      return {
        success: false,
        error: `Failed to get node executions: ${(error as Error).message}`,
      };
    }
  },
};

// =====================================
// list_flow_runs
// =====================================

export const listFlowRunsTool: ChatToolDefinition = {
  id: 'list_flow_runs',
  name: 'List Flow Runs',
  description:
    'List recent flow runs for the currently open flow. ' +
    'Shows run status, duration, and when each ran. ' +
    'Use this to answer questions like "has this flow been working?" or "show recent runs".',
  parameters: z.object({
    limit: z.number().optional().default(10).describe('Max runs to return (default 10)'),
  }),
  async execute(params: unknown, ctx: ChatToolContext): Promise<ChatToolResult> {
    const { limit } = params as { limit?: number };
    const flowlib = ctx.flowlib;
    const flowId = ctx.chatContext.flowId;

    if (!flowId) {
      return { success: false, error: 'No flow is currently open' };
    }

    try {
      const result = await flowlib.runs.listByFlowId(flowId);
      const runs = result.data;
      const limited = runs.slice(0, limit ?? 10);

      return {
        success: true,
        data: {
          total: runs.length,
          runs: limited.map((r) => ({
            id: r.id,
            status: r.status,
            duration: r.duration,
            startedAt: r.startedAt,
            completedAt: r.completedAt,
            error: r.error ? String(r.error).slice(0, 200) : undefined,
            triggerType: r.triggerType,
          })),
        },
      };
    } catch (error: unknown) {
      return { success: false, error: `Failed to list flow runs: ${(error as Error).message}` };
    }
  },
};

// =====================================
// Export all run tools
// =====================================

export const runTools: ChatToolDefinition[] = [
  getFlowRunTool,
  getNodeExecutionResultsTool,
  listFlowRunsTool,
];
