// Execution-related React Query hooks
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useApiClient } from '../contexts/ApiContext';
import { queryKeys, getErrorMessage } from './query-keys';
import { staleTime } from './stale-times';
import { type FlowRun, type FlowInputs } from '@flowlib/core/types';

// Execution Queries
// NOTE: Real-time updates are provided by useFlowRunStream (SSE).
// These hooks only do an initial fetch; the stream writes into the same cache keys.

export function useFlowRuns(flowId: string) {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: queryKeys.executions(flowId),
    queryFn: () => apiClient.getFlowRunsByFlowId(flowId),
    enabled: !!flowId,
    // Run history changes only when a new run starts (we invalidate from
    // useExecuteFlow / useExecuteFlowToNode) or when an SSE event mutates
    // the cache directly. 1 min covers the gap between mounts.
    staleTime: staleTime.short,
  });
}

export function useFlowRun(id: string) {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: queryKeys.flowRun(id),
    queryFn: () => apiClient.getFlowRun(id),
    enabled: !!id,
    // Live status updates flow through SSE; this is the fallback for the
    // brief window after mount before the stream catches up.
    staleTime: staleTime.live,
  });
}

export function useNodeExecutions(flowRunId: string) {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: queryKeys.nodeExecutions(flowRunId),
    queryFn: () => apiClient.getNodeExecutionsByFlowRun(flowRunId),
    enabled: !!flowRunId,
    // Same SSE-driven story as useFlowRun.
    staleTime: staleTime.live,
  });
}

export function useLatestFlowRun(flowId: string) {
  const { data: executionsResponse } = useFlowRuns(flowId);
  const executions = executionsResponse?.data || [];

  const latestExecution = useMemo(() => {
    if (!executions.length) {
      return null;
    }
    return executions.sort(
      (a: FlowRun, b: FlowRun) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
    )[0];
  }, [executions]);

  return useFlowRun(latestExecution?.id || '');
}

export function useListFlowRuns(
  flowId?: string,
  status?: string,
  page?: number,
  limit?: number,
  sortBy?: string,
  sortOrder?: 'asc' | 'desc',
) {
  const apiClient = useApiClient();

  const filter: Record<string, string[]> = {};
  if (flowId) {
    filter.flowId = [flowId];
  }
  if (status) {
    filter.status = [status];
  }

  const queryOptions = {
    filter: Object.keys(filter).length > 0 ? filter : undefined,
    pagination: page && limit ? { page, limit } : undefined,
    sort: sortBy && sortOrder ? { sortBy: sortBy as keyof FlowRun, sortOrder } : undefined,
  };

  return useQuery({
    queryKey: queryKeys.allExecutions(flowId, status, page, limit, sortBy, sortOrder),
    queryFn: () => apiClient.getAllFlowRuns(queryOptions),
    // Paginated runs history; the user is browsing past runs, ok to
    // serve from cache for a minute on back-navigation.
    staleTime: staleTime.short,
    retry: (failureCount, error) => {
      if (failureCount >= 2) {
        return false;
      }
      if (error instanceof Error && error.message.includes('4')) {
        return false;
      }
      return true;
    },
  });
}

// Execution Mutations
export function useExecuteFlow() {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      flowId,
      inputs,
      useBatchProcessing,
    }: {
      flowId: string;
      inputs?: FlowInputs;
      useBatchProcessing?: boolean;
    }) =>
      apiClient.executeFlow(flowId, inputs, {
        version: 'latest',
        useBatchProcessing: useBatchProcessing,
      }),
    onSuccess: (_, { flowId }) => {
      // Per-flow run history + the cross-flow "all runs" list both gain a
      // row; the dashboard counter ticks too.
      queryClient.invalidateQueries({ queryKey: queryKeys.executions(flowId) });
      queryClient.invalidateQueries({ queryKey: ['executions', 'all'], exact: false });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboardStats });
    },
    onError: (error) => {
      console.error('Error executing flow:', getErrorMessage(error));
    },
  });
}

// Execution Control Mutations
export function usePauseFlowRun() {
  const queryClient = useQueryClient();
  const apiClient = useApiClient();
  return useMutation({
    mutationFn: ({ executionId, reason }: { executionId: string; reason?: string }) =>
      apiClient.pauseFlowRun(executionId, reason),
    onSuccess: (_, { executionId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.flowRun(executionId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.nodeExecutions(executionId) });
      // The "all runs" list reflects status; bust it so the row shows paused.
      queryClient.invalidateQueries({ queryKey: ['executions', 'all'], exact: false });
    },
    onError: (error) => {
      console.error('Failed to pause execution:', error);
    },
  });
}

export function useResumeFlowRun() {
  const queryClient = useQueryClient();
  const apiClient = useApiClient();
  return useMutation({
    mutationFn: (executionId: string) => apiClient.resumeFlowRun(executionId),
    onSuccess: (_, executionId) => {
      // The bare ['executions'] prefix used to invalidate every per-flow runs
      // list AND every flow-run detail in the cache (the two query-key shapes
      // collide on `['executions', ...]`). Narrow to the specific run and the
      // cross-flow "all runs" list — sibling per-flow lists don't change just
      // because we resumed one run, and they refresh via SSE when needed.
      queryClient.invalidateQueries({ queryKey: queryKeys.flowRun(executionId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.nodeExecutions(executionId) });
      queryClient.invalidateQueries({ queryKey: ['executions', 'all'], exact: false });
    },
    onError: (error) => {
      console.error('Failed to resume execution:', error);
    },
  });
}

export function useCancelFlowRun() {
  const queryClient = useQueryClient();
  const apiClient = useApiClient();
  return useMutation({
    mutationFn: (executionId: string) => apiClient.cancelFlowRun(executionId),
    onSuccess: (_, executionId) => {
      queryClient.invalidateQueries({ queryKey: ['executions'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.flowRun(executionId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.nodeExecutions(executionId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboardStats });
    },
    onError: (error) => {
      console.error('Failed to cancel execution:', error);
    },
  });
}

// Execute Flow To Node Mutation
export function useExecuteFlowToNode() {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: {
      flowId: string;
      nodeId: string;
      inputs?: Record<string, unknown>;
      options?: { useBatchProcessing?: boolean };
    }) =>
      apiClient.executeFlowToNode(
        params.flowId,
        params.nodeId,
        params.inputs || {},
        params.options,
      ),
    onSuccess: (_, { flowId }) => {
      // run-to-node also produces a flow run row; treat like useExecuteFlow.
      queryClient.invalidateQueries({ queryKey: queryKeys.executions(flowId) });
      queryClient.invalidateQueries({ queryKey: ['executions', 'all'], exact: false });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboardStats });
    },
    onError: (error) => {
      console.error('Error executing flow to node:', getErrorMessage(error));
    },
  });
}

// Test Node Mutation
export function useTestNode() {
  const apiClient = useApiClient();

  return useMutation({
    mutationFn: (params: {
      nodeType: string;
      params: Record<string, unknown>;
      inputs: Record<string, unknown>;
    }) => apiClient.testNode(params.nodeType, params.params, params.inputs),
    onError: (error) => {
      console.error('Error testing node:', getErrorMessage(error));
    },
  });
}
