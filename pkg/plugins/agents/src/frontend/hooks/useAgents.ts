/**
 * React Query hooks for the agents collection.
 *
 * Read paths (`useAgents`, `useAgent`) cache under the key
 * `['agents', 'agents', ...]`. Mutation hooks invalidate those keys on
 * success.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AgentDefinition } from '../../shared/types';
import type { CreateAgentInput, UpdateAgentInput } from '../api/agents.api';
import { useAgentsApiClients } from '../api/context';

export const agentsKeys = {
  all: ['agents', 'agents'] as const,
  list: () => [...agentsKeys.all, 'list'] as const,
  detail: (id: string) => [...agentsKeys.all, 'detail', id] as const,
};

export function useAgents() {
  const { agents } = useAgentsApiClients();
  return useQuery<AgentDefinition[]>({
    queryKey: agentsKeys.list(),
    queryFn: () => agents.listAgents(),
  });
}

export function useAgent(id: string | null | undefined) {
  const { agents } = useAgentsApiClients();
  return useQuery<AgentDefinition>({
    queryKey: agentsKeys.detail(id ?? ''),
    queryFn: () => agents.getAgent(id as string),
    enabled: Boolean(id),
  });
}

export function useCreateAgent() {
  const { agents } = useAgentsApiClients();
  const qc = useQueryClient();
  return useMutation<AgentDefinition, Error, CreateAgentInput>({
    mutationFn: (input) => agents.createAgent(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: agentsKeys.list() });
    },
  });
}

export function useUpdateAgent() {
  const { agents } = useAgentsApiClients();
  const qc = useQueryClient();
  return useMutation<AgentDefinition, Error, { id: string; input: UpdateAgentInput }>({
    mutationFn: ({ id, input }) => agents.updateAgent(id, input),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: agentsKeys.list() });
      qc.setQueryData(agentsKeys.detail(data.id), data);
    },
  });
}

export function useDeleteAgent() {
  const { agents } = useAgentsApiClients();
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => agents.deleteAgent(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: agentsKeys.all });
    },
  });
}
