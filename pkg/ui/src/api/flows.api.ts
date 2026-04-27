// Flow-related React Query hooks
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '../contexts/ApiContext';
import { queryKeys, getErrorMessage } from './query-keys';
import { type ReactFlowDataOptions } from './types';
import {
  type CreateFlowDto,
  type CreateFlowVersionDto,
  type QueryOptions,
  type Flow,
  type FlowVersion,
  type ReactFlowData,
  type FlowlibDefinition,
} from '@flowlib/core/types';

export function useDashboardStats() {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: queryKeys.dashboardStats,
    queryFn: () => apiClient.getDashboardStats(),
    staleTime: 1000 * 30, // 30 seconds
    refetchInterval: 1000 * 60, // Refresh every minute
  });
}

export function useFlows(options?: QueryOptions<Flow>) {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: [...queryKeys.flows, options],
    queryFn: () => apiClient.getFlows(options),
    staleTime: 1000 * 60 * 5, // 5 minutes
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

export function useFlow(id: string) {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: queryKeys.flow(id),
    queryFn: () => apiClient.getFlow(id),
    enabled: !!id,
    staleTime: 1000 * 30, // 30 seconds - reduced to ensure fresh data after mutations
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

export function useFlowVersions(flowId: string, options?: QueryOptions<FlowVersion>) {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: [...queryKeys.flowVersions(flowId), options],
    queryFn: () => apiClient.getFlowVersions(flowId, options),
    enabled: !!flowId,
    staleTime: 1000 * 30, // 30 seconds - reduced to ensure fresh data after mutations
  });
}

// React Flow Data Query
export function useFlowReactFlowData(
  flowId: string,
  options?: ReactFlowDataOptions,
): ReturnType<typeof useQuery<ReactFlowData, Error>> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: queryKeys.reactFlow(flowId, options?.version, options?.flowRunId),
    queryFn: () => apiClient.getFlowReactFlowData(flowId, options),
    enabled: !!flowId,
    staleTime: options?.flowRunId ? 0 : 1000 * 30,
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

// Flow Mutations
export function useCreateFlow() {
  const queryClient = useQueryClient();
  const apiClient = useApiClient();
  return useMutation({
    mutationFn: (data: CreateFlowDto) => apiClient.createFlow(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.flows });
    },
    onError: (error) => {
      console.error('Error creating flow:', getErrorMessage(error));
    },
  });
}

export function useCreateFlowWithVersion() {
  const queryClient = useQueryClient();
  const apiClient = useApiClient();
  return useMutation({
    mutationFn: ({
      flowDto,
      versionDto,
    }: {
      flowDto: CreateFlowDto;
      versionDto: CreateFlowVersionDto;
    }) => apiClient.createFlowWithVersion(flowDto, versionDto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.flows });
    },
    onError: (error) => {
      console.error('Error creating flow with version:', getErrorMessage(error));
    },
  });
}

export function useUpdateFlow() {
  const queryClient = useQueryClient();
  const apiClient = useApiClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<CreateFlowDto> }) =>
      apiClient.updateFlow(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.flow(id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.flows });
    },
    onError: (error) => {
      console.error('Error updating flow:', getErrorMessage(error));
    },
  });
}

export function useDeleteFlow() {
  const queryClient = useQueryClient();
  const apiClient = useApiClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.deleteFlow(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.flows });
    },
    onError: (error) => {
      console.error('Error deleting flow:', getErrorMessage(error));
    },
  });
}

// Flow Version Mutations
export function useCreateFlowVersion() {
  const queryClient = useQueryClient();
  const apiClient = useApiClient();
  return useMutation({
    mutationFn: ({ flowId, data }: { flowId: string; data: CreateFlowVersionDto }) =>
      apiClient.createFlowVersion(flowId, data),
    onSuccess: (_, { flowId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.flowVersions(flowId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.flow(flowId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.flows });
    },
    onError: (error) => {
      console.error('Error creating flow version:', getErrorMessage(error));
    },
  });
}

export function useValidateFlow() {
  const apiClient = useApiClient();

  return useMutation({
    mutationFn: ({ flowId, flowData }: { flowId: string; flowData: FlowlibDefinition }) =>
      apiClient.validateFlow(flowId, flowData),
    retry: false,
    onError: (error) => {
      console.error('Error validating flow:', getErrorMessage(error));
    },
  });
}
