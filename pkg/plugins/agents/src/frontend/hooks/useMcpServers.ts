/**
 * React Query hooks for org-scoped MCP server registry.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AgentMcpServer } from '../../shared/types';
import type { CreateMcpServerInput, UpdateMcpServerInput } from '../api/mcp-servers.api';
import { useAgentsApiClients } from '../api/context';

export const mcpServersKeys = {
  all: ['agents', 'mcp-servers'] as const,
  list: () => [...mcpServersKeys.all, 'list'] as const,
  detail: (id: string) => [...mcpServersKeys.all, 'detail', id] as const,
};

export function useMcpServers() {
  const { mcpServers } = useAgentsApiClients();
  return useQuery<AgentMcpServer[]>({
    queryKey: mcpServersKeys.list(),
    queryFn: async () => {
      const r = await mcpServers.list();
      return r.data;
    },
  });
}

export function useCreateMcpServer() {
  const { mcpServers } = useAgentsApiClients();
  const qc = useQueryClient();
  return useMutation<AgentMcpServer, Error, CreateMcpServerInput>({
    mutationFn: (input) => mcpServers.create(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: mcpServersKeys.list() }),
  });
}

export function useUpdateMcpServer() {
  const { mcpServers } = useAgentsApiClients();
  const qc = useQueryClient();
  return useMutation<AgentMcpServer, Error, { id: string; input: UpdateMcpServerInput }>({
    mutationFn: ({ id, input }) => mcpServers.update(id, input),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: mcpServersKeys.list() });
      qc.setQueryData(mcpServersKeys.detail(data.id), data);
    },
  });
}

export function useDeleteMcpServer() {
  const { mcpServers } = useAgentsApiClients();
  const qc = useQueryClient();
  return useMutation<void, Error, { id: string }>({
    mutationFn: ({ id }) => mcpServers.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: mcpServersKeys.list() }),
  });
}
