/**
 * React Query hooks for chat sessions.
 *
 * Stream M owns the chat surface; this scaffold supplies the
 * AgentDetailPage's session list.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AgentSession } from '../../shared/types';
import type { CreateSessionInput, UpdateSessionInput } from '../api/sessions.api';
import { useAgentsApiClients } from '../api/context';

export const sessionsKeys = {
  all: ['agents', 'sessions'] as const,
  forAgent: (agentId: string) => [...sessionsKeys.all, 'agent', agentId] as const,
  detail: (id: string) => [...sessionsKeys.all, 'detail', id] as const,
};

export function useSessions(agentId: string | null | undefined) {
  const { sessions } = useAgentsApiClients();
  return useQuery<AgentSession[]>({
    queryKey: sessionsKeys.forAgent(agentId ?? ''),
    queryFn: () => sessions.listSessionsForAgent(agentId as string),
    enabled: Boolean(agentId),
  });
}

export function useSession(sessionId: string | null | undefined) {
  const { sessions } = useAgentsApiClients();
  return useQuery<AgentSession>({
    queryKey: sessionsKeys.detail(sessionId ?? ''),
    queryFn: () => sessions.getSession(sessionId as string),
    enabled: Boolean(sessionId),
  });
}

export function useCreateSession() {
  const { sessions } = useAgentsApiClients();
  const qc = useQueryClient();
  return useMutation<AgentSession, Error, CreateSessionInput>({
    mutationFn: (input) => sessions.createSession(input),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: sessionsKeys.forAgent(data.agentId) });
    },
  });
}

export function useUpdateSession() {
  const { sessions } = useAgentsApiClients();
  const qc = useQueryClient();
  return useMutation<AgentSession, Error, { id: string; input: UpdateSessionInput }>({
    mutationFn: ({ id, input }) => sessions.updateSession(id, input),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: sessionsKeys.forAgent(data.agentId) });
      qc.setQueryData(sessionsKeys.detail(data.id), data);
    },
  });
}

export function useDeleteSession() {
  const { sessions } = useAgentsApiClients();
  const qc = useQueryClient();
  return useMutation<void, Error, { id: string; agentId: string }>({
    mutationFn: ({ id }) => sessions.deleteSession(id),
    onSuccess: (_void, { agentId }) => {
      qc.invalidateQueries({ queryKey: sessionsKeys.forAgent(agentId) });
    },
  });
}
