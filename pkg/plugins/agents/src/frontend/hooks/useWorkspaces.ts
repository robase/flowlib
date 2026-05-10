/**
 * React Query hooks for workspaces.
 *
 * Workspaces back agents — the AgentFormPage uses `useWorkspaces` to
 * populate its picker.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AgentWorkspace } from '../../shared/types';
import type { CreateWorkspaceInput } from '../api/workspaces.api';
import { useAgentsApiClients } from '../api/context';

export const workspacesKeys = {
  all: ['agents', 'workspaces'] as const,
  list: () => [...workspacesKeys.all, 'list'] as const,
  detail: (id: string) => [...workspacesKeys.all, 'detail', id] as const,
};

export function useWorkspaces() {
  const { workspaces } = useAgentsApiClients();
  return useQuery<AgentWorkspace[]>({
    queryKey: workspacesKeys.list(),
    queryFn: () => workspaces.listWorkspaces(),
  });
}

export function useWorkspace(id: string | null | undefined) {
  const { workspaces } = useAgentsApiClients();
  return useQuery<AgentWorkspace>({
    queryKey: workspacesKeys.detail(id ?? ''),
    queryFn: () => workspaces.getWorkspace(id as string),
    enabled: Boolean(id),
  });
}

export function useCreateWorkspace() {
  const { workspaces } = useAgentsApiClients();
  const qc = useQueryClient();
  return useMutation<AgentWorkspace, Error, CreateWorkspaceInput>({
    mutationFn: (input) => workspaces.createWorkspace(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: workspacesKeys.list() });
    },
  });
}

export function useDeleteWorkspace() {
  const { workspaces } = useAgentsApiClients();
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => workspaces.deleteWorkspace(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: workspacesKeys.all });
    },
  });
}
