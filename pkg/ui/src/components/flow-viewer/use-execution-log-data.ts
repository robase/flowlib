import { useMemo } from 'react';
import type {
  NodeExecution,
  NodeExecutionStatus,
  ReactFlowNode,
  ToolExecutionRecord,
  AgentExecutionOutput,
  AgentFinishReason,
} from '@flowlib/core/types';
import { NodeExecutionStatus as NodeStatusEnum } from '@flowlib/core/types';

/**
 * Individual tool call executed by an AI Agent
 */
export interface ExecutionLogToolCall {
  id: string;
  toolId: string;
  toolName: string;
  input: Record<string, unknown>;
  output?: unknown;
  error?: string;
  success: boolean;
  iteration: number;
  executionTimeMs: number;
}

/**
 * Agent-specific metadata for execution attempts
 */
export interface AgentExecutionMetadata {
  iterations: number;
  finishReason: AgentFinishReason;
  finalResponse: string;
  model?: string;
  provider?: string;
  tokenUsage?: {
    conversationTokensEstimate: number;
    truncationOccurred: boolean;
  };
}

export interface ExecutionLogAttempt {
  id: string;
  attemptNumber: number;
  label: string;
  status: NodeExecutionStatus;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  inputs?: Record<string, unknown>;
  outputs?: NodeExecution['outputs'];
  error?: string;
  errorDetails?: import('@flowlib/core/types').NodeErrorDetails;
  nodeExecutionId?: string;
  /** Tool calls for agent nodes */
  toolCalls?: ExecutionLogToolCall[];
  /** Agent-specific metadata for agent nodes */
  agentMetadata?: AgentExecutionMetadata;
  /** True when this attempt is a loop/mapper iteration (detected via _item in inputs) */
  isLoopIteration?: boolean;
  /** The _item metadata for loop iterations */
  iterationItem?: {
    value: unknown;
    index: number;
    iteration: number;
    first: boolean;
    last: boolean;
    total: number;
  };
}

export interface ExecutionLogNode {
  nodeId: string;
  nodeName: string;
  nodeType?: string;
  latestStatus: NodeExecutionStatus;
  attempts: ExecutionLogAttempt[];
  definitionIndex: number;
}

export interface SelectedExecutionAttempt {
  nodeId: string;
  attemptId: string;
  /** Optional: selected tool call ID within an agent node */
  toolCallId?: string;
}

type RawAttempt = ExecutionLogAttempt & {
  startedAtMs?: number;
  isPlaceholder?: boolean;
  _isLoopIteration?: boolean;
};

type UseExecutionLogDataParams = {
  nodes?: ReactFlowNode[];
  nodeExecutions?: NodeExecution[];
};

const toIsoString = (value?: string | Date | null): string | undefined => {
  if (!value) {
    return undefined;
  }

  if (typeof value === 'string') {
    return value;
  }

  return value.toISOString();
};

const toTimestamp = (value?: string | Date | null): number | undefined => {
  if (!value) {
    return undefined;
  }

  const date = typeof value === 'string' ? new Date(value) : value;
  const time = date?.getTime();
  return Number.isFinite(time) ? time : undefined;
};

const toDuration = (
  duration?: number | null,
  startedAt?: string | Date | null,
  completedAt?: string | Date | null,
) => {
  if (typeof duration === 'number') {
    return duration;
  }

  const start = toTimestamp(startedAt);
  const end = toTimestamp(completedAt);

  if (start === undefined || end === undefined) {
    return undefined;
  }

  return Math.max(end - start, 0);
};

/**
 * Extract tool execution records from an Agent node's output
 * Agent outputs store tool results in: outputs.data.variables.output.value.toolResults
 */
function extractAgentToolCalls(
  nodeExecution: NodeExecution,
): { toolCalls: ExecutionLogToolCall[]; agentMetadata: AgentExecutionMetadata } | undefined {
  // Only process AGENT nodes
  if (nodeExecution.nodeType !== 'core.agent') {
    return undefined;
  }

  // Navigate to the agent output value
  const outputs = nodeExecution.outputs as Record<string, unknown> | undefined;
  const data = outputs?.data as Record<string, unknown> | undefined;
  const variables = data?.variables as Record<string, unknown> | undefined;
  const outputVar = variables?.output as Record<string, unknown> | undefined;
  const agentOutput = outputVar?.value as AgentExecutionOutput | undefined;

  if (!agentOutput) {
    return undefined;
  }

  // Extract metadata
  const metadata = data?.metadata as Record<string, unknown> | undefined;

  const agentMetadata: AgentExecutionMetadata = {
    iterations: agentOutput.iterations ?? 0,
    finishReason: agentOutput.finishReason ?? 'completed',
    finalResponse: agentOutput.finalResponse ?? '',
    model: metadata?.model as string | undefined,
    provider: metadata?.provider as string | undefined,
    tokenUsage: agentOutput.tokenUsage,
  };

  // Extract tool calls
  const toolResults = agentOutput.toolResults ?? [];
  const toolCalls: ExecutionLogToolCall[] = toolResults.map(
    (tool: ToolExecutionRecord, index: number) => ({
      id: `${nodeExecution.id}_tool_${index}`,
      toolId: tool.toolId,
      toolName: tool.toolName,
      input: tool.input,
      output: tool.output,
      error: tool.error,
      success: tool.success,
      iteration: tool.iteration,
      executionTimeMs: tool.executionTimeMs,
    }),
  );

  return { toolCalls, agentMetadata };
}

export function useExecutionLogData({ nodes, nodeExecutions }: UseExecutionLogDataParams) {
  return useMemo(() => {
    const definitionNodes = nodes ?? [];
    const nodeOrderMap = new Map<string, number>();

    definitionNodes.forEach((node, index) => {
      nodeOrderMap.set(node.id, index);
    });

    const groups = new Map<
      string,
      {
        nodeId: string;
        nodeName: string;
        nodeType?: string;
        definitionIndex: number;
        attempts: RawAttempt[];
      }
    >();

    const ensureGroup = (nodeId: string) => {
      const existing = groups.get(nodeId);
      if (existing) {
        return existing;
      }

      const definitionNode = definitionNodes.find((n) => n.id === nodeId);
      const newGroup = {
        nodeId,
        nodeName: definitionNode?.data?.display_name || nodeId,
        nodeType: definitionNode?.type,
        definitionIndex: nodeOrderMap.get(nodeId) ?? Number.MAX_SAFE_INTEGER,
        attempts: [],
      };
      groups.set(nodeId, newGroup);
      return newGroup;
    };

    (nodeExecutions ?? []).forEach((execution) => {
      const group = ensureGroup(execution.nodeId);

      // Extract tool calls for agent nodes
      const agentData = extractAgentToolCalls(execution);

      // Detect loop iteration via _item metadata in inputs
      const itemMeta = execution.inputs?._item as
        | {
            value: unknown;
            index: number;
            iteration: number;
            first: boolean;
            last: boolean;
            total: number;
          }
        | undefined;
      const isLoop =
        itemMeta !== null &&
        itemMeta !== undefined &&
        typeof itemMeta === 'object' &&
        'iteration' in itemMeta;

      group.attempts.push({
        id: execution.id,
        attemptNumber: 0,
        label: '',
        status: execution.status,
        startedAt: toIsoString(execution.startedAt),
        completedAt: toIsoString(execution.completedAt),
        durationMs: toDuration(execution.duration, execution.startedAt, execution.completedAt),
        inputs: execution.inputs,
        outputs: execution.outputs,
        error: execution.error,
        errorDetails: (
          execution as { errorDetails?: import('@flowlib/core/types').NodeErrorDetails }
        ).errorDetails,
        nodeExecutionId: execution.id,
        startedAtMs: toTimestamp(execution.startedAt),
        isPlaceholder: false,
        toolCalls: agentData?.toolCalls,
        agentMetadata: agentData?.agentMetadata,
        _isLoopIteration: isLoop,
        isLoopIteration: isLoop,
        iterationItem: isLoop ? itemMeta : undefined,
      });
    });

    // Ensure every node is represented even if it has not executed yet
    definitionNodes.forEach((node) => {
      if (!groups.has(node.id)) {
        groups.set(node.id, {
          nodeId: node.id,
          nodeName: node.data?.display_name || node.id,
          nodeType: node.type,
          definitionIndex: nodeOrderMap.get(node.id) ?? Number.MAX_SAFE_INTEGER,
          attempts: [
            {
              id: `${node.id}-pending`,
              attemptNumber: 1,
              label: 'Pending',
              status: NodeStatusEnum.PENDING,
              inputs: {},
              outputs: undefined,
              error: undefined,
              nodeExecutionId: undefined,
              startedAtMs: undefined,
              isPlaceholder: true,
            },
          ],
        });
      }
    });

    const orderedNodes = Array.from(groups.values())
      .map((group) => {
        const sortedAttempts = group.attempts
          .slice()
          .sort((a, b) => {
            const aKey = a.startedAtMs ?? Number.MAX_SAFE_INTEGER;
            const bKey = b.startedAtMs ?? Number.MAX_SAFE_INTEGER;
            if (aKey !== bKey) {
              return aKey - bKey;
            }
            return a.id.localeCompare(b.id);
          })
          .map((attempt, index, arr) => {
            // Check if all non-placeholder attempts in this group are loop iterations
            const allLoop = arr.filter((a) => !a.isPlaceholder).every((a) => a._isLoopIteration);
            let label: string;
            if (attempt.isPlaceholder) {
              label = 'Pending';
            } else if (allLoop && attempt._isLoopIteration) {
              label = `Iteration #${index + 1}`;
            } else if (index === 0) {
              label = `Attempt #${index + 1}`;
            } else {
              label = `Retry #${index + 1}`;
            }
            return {
              ...attempt,
              attemptNumber: index + 1,
              label,
            };
          });

        const sortedAttemptsWithoutMeta = sortedAttempts.map(
          ({ startedAtMs, isPlaceholder, _isLoopIteration, ...rest }) => rest,
        );
        const firstTimestamp = sortedAttempts.find(
          (attempt) => attempt.startedAtMs !== undefined,
        )?.startedAtMs;
        const latestStatus =
          sortedAttemptsWithoutMeta[sortedAttemptsWithoutMeta.length - 1]?.status ??
          NodeStatusEnum.PENDING;

        return {
          nodeId: group.nodeId,
          nodeName: group.nodeName,
          nodeType: group.nodeType,
          attempts: sortedAttemptsWithoutMeta,
          latestStatus,
          definitionIndex: group.definitionIndex,
          sortTimestamp: firstTimestamp,
        };
      })
      .sort((a, b) => {
        const aKey = a.sortTimestamp ?? Number.MAX_SAFE_INTEGER;
        const bKey = b.sortTimestamp ?? Number.MAX_SAFE_INTEGER;

        if (aKey !== bKey) {
          return aKey - bKey;
        }

        return a.definitionIndex - b.definitionIndex;
      })
      .map(({ sortTimestamp: _sortTimestamp, ...rest }) => rest);

    return {
      nodes: orderedNodes,
    };
  }, [nodes, nodeExecutions]);
}
