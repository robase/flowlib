/**
 * useFlowAccess — React Query hooks for flow access records
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '@flowlib/ui';
import type {
  AccessibleFlowsResponse,
  FlowAccessRecord,
  GrantFlowAccessRequest,
} from '../../shared/types';

/** Fetch access records for a specific flow */
export function useFlowAccess(flowId: string | undefined) {
  const api = useApiClient();

  return useQuery<{ access: FlowAccessRecord[] }>({
    queryKey: ['rbac', 'flow-access', flowId],
    queryFn: async () => {
      const response = await fetch(`${api.getBaseURL()}/plugins/rbac/flows/${flowId}/access`, {
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch flow access: ${response.status}`);
      }
      return response.json();
    },
    enabled: !!flowId,
  });
}

/** Fetch all flow IDs accessible to the current user with their effective permission */
export function useAccessibleFlows() {
  const api = useApiClient();

  return useQuery<AccessibleFlowsResponse>({
    queryKey: ['rbac', 'accessible-flows'],
    queryFn: async () => {
      const response = await fetch(`${api.getBaseURL()}/plugins/rbac/flows/accessible`, {
        credentials: 'include',
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(
          err.error || err.message || `Failed to fetch accessible flows: ${response.status}`,
        );
      }
      return response.json();
    },
  });
}

/** Grant access to a flow */
export function useGrantFlowAccess(flowId: string) {
  const api = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: GrantFlowAccessRequest) => {
      const response = await fetch(`${api.getBaseURL()}/plugins/rbac/flows/${flowId}/access`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `Failed to grant access: ${response.status}`);
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rbac', 'flow-access', flowId] });
      queryClient.invalidateQueries({ queryKey: ['rbac', 'effective-flow-access', flowId] });
    },
  });
}

/** Revoke a specific access record */
export function useRevokeFlowAccess(flowId: string) {
  const api = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (accessId: string) => {
      const response = await fetch(
        `${api.getBaseURL()}/plugins/rbac/flows/${flowId}/access/${accessId}`,
        {
          method: 'DELETE',
          credentials: 'include',
        },
      );
      if (!response.ok && response.status !== 204) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `Failed to revoke access: ${response.status}`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rbac', 'flow-access', flowId] });
    },
  });
}
