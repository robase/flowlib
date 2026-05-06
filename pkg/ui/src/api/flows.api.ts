// Flow-related React Query hooks
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '../contexts/ApiContext';
import { queryKeys, getErrorMessage } from './query-keys';
import { staleTime } from './stale-times';
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
    // Counters move when flows or runs change; mutations invalidate this
    // explicitly. The 1-min refetchInterval is the failsafe for bg activity
    // (cron-triggered runs, runs from other tabs/clients).
    staleTime: staleTime.short,
    refetchInterval: 1000 * 60,
  });
}

export function useFlows(options?: QueryOptions<Flow>) {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: [...queryKeys.flows, options],
    queryFn: () => apiClient.getFlows(options),
    // Sidebar list. Mutations invalidate, so 5min just covers passive
    // re-navigation between dashboard / runs / credentials views.
    staleTime: staleTime.medium,
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
    // Editor view; mutations (rename, version create) invalidate this.
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

export function useFlowVersions(flowId: string, options?: QueryOptions<FlowVersion>) {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: [...queryKeys.flowVersions(flowId), options],
    queryFn: () => apiClient.getFlowVersions(flowId, options),
    enabled: !!flowId,
    // Versions are append-only; only the version-create mutation adds to
    // the list and invalidates this key.
    staleTime: staleTime.short,
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
    // Run-scoped renders show live execution status, refetch every mount.
    // Plain editor renders are mutation-invalidated.
    staleTime: options?.flowRunId ? staleTime.always : staleTime.short,
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
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboardStats });
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
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboardStats });
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
      // Pin the parent-key invalidations so they don't cascade into deeper
      // keys (versions, react-flow). See `useCreateFlowVersion` for the
      // detailed rationale; same prefix-match cascade applies here.
      queryClient.invalidateQueries({ queryKey: queryKeys.flow(id), exact: true });
      queryClient.invalidateQueries({ queryKey: queryKeys.flows, exact: true });
      // React-Flow data carries the flow's name/description/active state,
      // so flow renames also need to bust any rendered editor views.
      queryClient.invalidateQueries({
        queryKey: ['flows', id, 'react-flow'],
        exact: false,
      });
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
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.flows });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboardStats });
      // Drop everything we have for this flow id — detail, versions,
      // react-flow renders, runs. `removeQueries` bypasses staleTime and
      // clears them outright so the next mount won't briefly flash old
      // data while the (now-404) GET roundtrips.
      queryClient.removeQueries({ queryKey: queryKeys.flow(id) });
      queryClient.removeQueries({ queryKey: queryKeys.flowVersions(id), exact: false });
      queryClient.removeQueries({ queryKey: ['flows', id, 'react-flow'], exact: false });
      queryClient.removeQueries({ queryKey: queryKeys.executions(id) });
      queryClient.removeQueries({ queryKey: queryKeys.triggers(id) });
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
      // The query keys here share prefixes intentionally:
      //   queryKeys.flow(id)         = ['flows', id]
      //   queryKeys.flowVersions(id) = ['flows', id, 'versions']
      //   queryKeys.flows            = ['flows']
      //   reactFlow                  = ['flows', id, 'react-flow', ...]
      //
      // Default `invalidateQueries` is prefix-match, so without `exact:true`
      // a single save invalidated the SAME `flowVersions` query under THREE
      // separate invalidations (direct, via `flow`, via `flows`). Each match
      // queues a refetch — that's the "6 identical /versions/list POSTs in
      // one second" we kept seeing. Pin the parent-key invalidations to
      // exact-match so they don't cascade into deeper keys; keep prefix
      // semantics on the two whose actual cache keys carry extra segments.
      queryClient.invalidateQueries({ queryKey: queryKeys.flowVersions(flowId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.flow(flowId), exact: true });
      queryClient.invalidateQueries({ queryKey: queryKeys.flows, exact: true });
      queryClient.invalidateQueries({
        queryKey: ['flows', flowId, 'react-flow'],
        exact: false,
      });
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
