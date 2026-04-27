/**
 * useFlowSync — React Query hooks for version control sync operations
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '@flowlib/ui';
import type {
  VcFlowSyncStatus,
  VcSyncHistoryRecord,
  VcSyncResult,
  VcSyncConfig,
  ConfigureSyncInput,
} from '../../shared/types';

export const vcQueryKeys = {
  syncStatus: (flowId: string) => ['vc', 'sync-status', flowId] as const,
  syncHistory: (flowId: string) => ['vc', 'sync-history', flowId] as const,
  syncedFlows: () => ['vc', 'synced-flows'] as const,
};

/** Fetch sync status for a flow */
export function useFlowSyncStatus(flowId: string | undefined) {
  const api = useApiClient();

  return useQuery<VcFlowSyncStatus>({
    queryKey: vcQueryKeys.syncStatus(flowId ?? ''),
    queryFn: async () => {
      const response = await fetch(`${api.getBaseURL()}/plugins/vc/flows/${flowId}/status`, {
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch sync status: ${response.status}`);
      }
      return response.json();
    },
    enabled: !!flowId,
  });
}

/** Fetch sync history for a flow */
export function useFlowSyncHistory(flowId: string | undefined) {
  const api = useApiClient();

  return useQuery<{ flowId: string; history: VcSyncHistoryRecord[] }>({
    queryKey: vcQueryKeys.syncHistory(flowId ?? ''),
    queryFn: async () => {
      const response = await fetch(
        `${api.getBaseURL()}/plugins/vc/flows/${flowId}/history?limit=20`,
        { credentials: 'include' },
      );
      if (!response.ok) {
        throw new Error(`Failed to fetch sync history: ${response.status}`);
      }
      return response.json();
    },
    enabled: !!flowId,
  });
}

/** List all synced flows */
export function useSyncedFlows() {
  const api = useApiClient();

  return useQuery<{ flows: Array<VcSyncConfig & { flowName: string }> }>({
    queryKey: vcQueryKeys.syncedFlows(),
    queryFn: async () => {
      const response = await fetch(`${api.getBaseURL()}/plugins/vc/flows`, {
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch synced flows: ${response.status}`);
      }
      return response.json();
    },
  });
}

/** Push a flow to remote */
export function usePushFlow(flowId: string) {
  const api = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<VcSyncResult>({
    mutationFn: async () => {
      const response = await fetch(`${api.getBaseURL()}/plugins/vc/flows/${flowId}/push`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok && response.status !== 409) {
        throw new Error(`Push failed: ${response.status}`);
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: vcQueryKeys.syncStatus(flowId) });
      queryClient.invalidateQueries({ queryKey: vcQueryKeys.syncHistory(flowId) });
    },
  });
}

/** Pull a flow from remote */
export function usePullFlow(flowId: string) {
  const api = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<VcSyncResult>({
    mutationFn: async () => {
      const response = await fetch(`${api.getBaseURL()}/plugins/vc/flows/${flowId}/pull`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error(`Pull failed: ${response.status}`);
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: vcQueryKeys.syncStatus(flowId) });
      queryClient.invalidateQueries({ queryKey: vcQueryKeys.syncHistory(flowId) });
    },
  });
}

/** Force push (local wins) */
export function useForcePushFlow(flowId: string) {
  const api = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<VcSyncResult>({
    mutationFn: async () => {
      const response = await fetch(`${api.getBaseURL()}/plugins/vc/flows/${flowId}/force-push`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error(`Force push failed: ${response.status}`);
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: vcQueryKeys.syncStatus(flowId) });
      queryClient.invalidateQueries({ queryKey: vcQueryKeys.syncHistory(flowId) });
    },
  });
}

/** Force pull (remote wins) */
export function useForcePullFlow(flowId: string) {
  const api = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<VcSyncResult>({
    mutationFn: async () => {
      const response = await fetch(`${api.getBaseURL()}/plugins/vc/flows/${flowId}/force-pull`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error(`Force pull failed: ${response.status}`);
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: vcQueryKeys.syncStatus(flowId) });
      queryClient.invalidateQueries({ queryKey: vcQueryKeys.syncHistory(flowId) });
    },
  });
}

/** Publish flow (pr-per-publish mode) */
export function usePublishFlow(flowId: string) {
  const api = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<VcSyncResult>({
    mutationFn: async () => {
      const response = await fetch(`${api.getBaseURL()}/plugins/vc/flows/${flowId}/publish`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error(`Publish failed: ${response.status}`);
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: vcQueryKeys.syncStatus(flowId) });
      queryClient.invalidateQueries({ queryKey: vcQueryKeys.syncHistory(flowId) });
    },
  });
}

/** Configure sync for a flow */
export function useConfigureSync(flowId: string) {
  const api = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<VcSyncConfig, Error, ConfigureSyncInput>({
    mutationFn: async (input) => {
      const response = await fetch(`${api.getBaseURL()}/plugins/vc/flows/${flowId}/configure`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `Configure failed: ${response.status}`);
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: vcQueryKeys.syncStatus(flowId) });
      queryClient.invalidateQueries({ queryKey: vcQueryKeys.syncedFlows() });
    },
  });
}

/** Disconnect sync for a flow */
export function useDisconnectSync(flowId: string) {
  const api = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const response = await fetch(`${api.getBaseURL()}/plugins/vc/flows/${flowId}/disconnect`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error(`Disconnect failed: ${response.status}`);
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: vcQueryKeys.syncStatus(flowId) });
      queryClient.invalidateQueries({ queryKey: vcQueryKeys.syncedFlows() });
    },
  });
}
