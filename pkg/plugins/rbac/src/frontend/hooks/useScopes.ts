import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '@flowlib/ui';
import type {
  EffectiveFlowAccessResponse,
  GrantScopeAccessRequest,
  MovePreviewRequest,
  MovePreviewResponse,
  ScopeAccessRecord,
  ScopeTreeResponse,
} from '../../shared/types';

export function useScopeTree() {
  const api = useApiClient();

  return useQuery<ScopeTreeResponse>({
    queryKey: ['rbac', 'scope-tree'],
    queryFn: async () => {
      const response = await fetch(`${api.getBaseURL()}/plugins/rbac/scopes/tree`, {
        credentials: 'include',
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `Failed to fetch scope tree: ${response.status}`);
      }
      return response.json();
    },
  });
}

export function useScopeAccess(scopeId: string | undefined) {
  const api = useApiClient();

  return useQuery<{ access: ScopeAccessRecord[] }>({
    queryKey: ['rbac', 'scope-access', scopeId],
    queryFn: async () => {
      const response = await fetch(`${api.getBaseURL()}/plugins/rbac/scopes/${scopeId}/access`, {
        credentials: 'include',
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `Failed to fetch scope access: ${response.status}`);
      }
      return response.json();
    },
    enabled: !!scopeId,
  });
}

export function useGrantScopeAccess(scopeId: string) {
  const api = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: GrantScopeAccessRequest) => {
      const response = await fetch(`${api.getBaseURL()}/plugins/rbac/scopes/${scopeId}/access`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `Failed to grant scope access: ${response.status}`);
      }
      return response.json() as Promise<ScopeAccessRecord>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rbac', 'scope-access', scopeId] });
      queryClient.invalidateQueries({ queryKey: ['rbac', 'scope-tree'] });
    },
  });
}

export function useRevokeScopeAccess(scopeId: string) {
  const api = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (accessId: string) => {
      const response = await fetch(
        `${api.getBaseURL()}/plugins/rbac/scopes/${scopeId}/access/${accessId}`,
        {
          method: 'DELETE',
          credentials: 'include',
        },
      );
      if (!response.ok && response.status !== 204) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `Failed to revoke scope access: ${response.status}`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rbac', 'scope-access', scopeId] });
      queryClient.invalidateQueries({ queryKey: ['rbac', 'scope-tree'] });
    },
  });
}

export function useEffectiveFlowAccess(flowId: string | undefined) {
  const api = useApiClient();

  return useQuery<EffectiveFlowAccessResponse>({
    queryKey: ['rbac', 'effective-flow-access', flowId],
    queryFn: async () => {
      const response = await fetch(
        `${api.getBaseURL()}/plugins/rbac/flows/${flowId}/effective-access`,
        { credentials: 'include' },
      );
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `Failed to fetch effective flow access: ${response.status}`);
      }
      return response.json();
    },
    enabled: !!flowId,
  });
}

export function useMoveFlow(flowId: string) {
  const api = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (scopeId: string | null) => {
      const response = await fetch(`${api.getBaseURL()}/plugins/rbac/flows/${flowId}/scope`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ scopeId }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `Failed to move flow: ${response.status}`);
      }
      return response.json() as Promise<{
        success: boolean;
        flowId: string;
        scopeId: string | null;
      }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rbac', 'scope-tree'] });
      queryClient.invalidateQueries({ queryKey: ['rbac', 'accessible-flows'] });
      queryClient.invalidateQueries({ queryKey: ['rbac', 'effective-flow-access', flowId] });
    },
  });
}

export function usePreviewMove() {
  const api = useApiClient();

  return useMutation({
    mutationFn: async (input: MovePreviewRequest) => {
      const response = await fetch(`${api.getBaseURL()}/plugins/rbac/preview-move`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `Failed to preview move: ${response.status}`);
      }
      return response.json() as Promise<MovePreviewResponse>;
    },
  });
}
