// Trigger-related React Query hooks
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '../contexts/ApiContext';
import { queryKeys, getErrorMessage } from './query-keys';
import { staleTime } from './stale-times';
import type { CreateTriggerInput, UpdateTriggerInput } from './types';

/**
 * Fetch all trigger registrations for a flow.
 */
export function useFlowTriggers(flowId: string) {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: queryKeys.triggers(flowId),
    queryFn: () => apiClient.listTriggersForFlow(flowId),
    enabled: !!flowId,
    // Trigger list mutates only via this app's own create/update/delete
    // mutations (which invalidate); 1 min covers passive re-mount.
    staleTime: staleTime.short,
  });
}

/**
 * Fetch a single trigger by ID.
 */
export function useTrigger(triggerId: string) {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: queryKeys.trigger(triggerId),
    queryFn: () => apiClient.getTrigger(triggerId),
    enabled: !!triggerId,
    staleTime: staleTime.short,
  });
}

/**
 * Create a trigger registration.
 */
export function useCreateTrigger() {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ flowId, input }: { flowId: string; input: CreateTriggerInput }) =>
      apiClient.createTrigger(flowId, input),
    onSuccess: (_, { flowId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.triggers(flowId) });
    },
    onError: (error) => {
      console.error('Error creating trigger:', getErrorMessage(error));
    },
  });
}

/**
 * Update a trigger registration.
 */
export function useUpdateTrigger() {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      triggerId,
      input,
    }: {
      triggerId: string;
      flowId: string;
      input: UpdateTriggerInput;
    }) => apiClient.updateTrigger(triggerId, input),
    onSuccess: (_, { triggerId, flowId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.trigger(triggerId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.triggers(flowId) });
    },
    onError: (error) => {
      console.error('Error updating trigger:', getErrorMessage(error));
    },
  });
}

/**
 * Delete a trigger registration.
 */
export function useDeleteTrigger() {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ triggerId }: { triggerId: string; flowId: string }) =>
      apiClient.deleteTrigger(triggerId),
    onSuccess: (_, { triggerId, flowId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.triggers(flowId) });
      // Drop the dead detail entry — refetch would 404.
      queryClient.removeQueries({ queryKey: queryKeys.trigger(triggerId) });
    },
    onError: (error) => {
      console.error('Error deleting trigger:', getErrorMessage(error));
    },
  });
}

/**
 * Sync trigger registrations from the flow definition.
 */
export function useSyncTriggers() {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      flowId,
      definition,
    }: {
      flowId: string;
      definition: { nodes: Array<{ id: string; type: string; params?: Record<string, unknown> }> };
    }) => apiClient.syncTriggersForFlow(flowId, definition),
    onSuccess: (_, { flowId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.triggers(flowId) });
    },
    onError: (error) => {
      console.error('Error syncing triggers:', getErrorMessage(error));
    },
  });
}
