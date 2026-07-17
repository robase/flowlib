/**
 * React Query hooks for chat sessions.
 *
 * Sessions are the unit of interaction — there is no separate agent
 * definition. `useSessions()` returns every session for the active org.
 */

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AgentMessage, AgentProviderId, AgentSession } from '../../shared/types';
import type { CreateSessionInput, UpdateSessionInput } from '../api/sessions.api';
import { useAgentsApiClients } from '../api/context';
import { PROVIDER_CATALOGUE, type ProviderEntry } from '../lib/provider-models';
import { workspacesKeys } from './useWorkspaces';

export const sessionsKeys = {
  all: ['agents', 'sessions'] as const,
  list: () => [...sessionsKeys.all, 'list'] as const,
  detail: (id: string) => [...sessionsKeys.all, 'detail', id] as const,
  messages: (id: string) => [...sessionsKeys.all, 'detail', id, 'messages'] as const,
};

export function useSessions() {
  const { sessions } = useAgentsApiClients();
  return useQuery<AgentSession[]>({
    queryKey: sessionsKeys.list(),
    queryFn: async () => {
      const r = await sessions.listSessions();
      return r.data;
    },
  });
}

/**
 * Backend-driven provider/model catalogue for the picker.
 *
 * Fetches `GET /agents/providers` and maps it to the picker's
 * `ProviderEntry[]` shape. Falls back to the built-in
 * `PROVIDER_CATALOGUE` when the endpoint is unavailable or no provider
 * declares models — so the picker always renders, and deployments that
 * curate their own models (e.g. hosted's `openrouter/*` specs) get a
 * catalogue that matches their registered providers + credentials.
 */
export function useProviderCatalogue(): {
  catalogue: ProviderEntry[];
  defaultProviderId?: string;
  isLoading: boolean;
} {
  const { sessions } = useAgentsApiClients();
  const query = useQuery({
    queryKey: [...sessionsKeys.all, 'providers'] as const,
    queryFn: () => sessions.listProviders(),
    staleTime: Infinity,
  });

  const catalogue = React.useMemo<ProviderEntry[]>(() => {
    const data = query.data?.data;
    if (!data || data.length === 0) {
      return PROVIDER_CATALOGUE;
    }
    // A provider can only drive the picker if it declares models — drop
    // model-less providers (e.g. claude-code) and fall back entirely when
    // nothing usable is left.
    const mapped: ProviderEntry[] = data
      .filter((p) => p.models.length > 0)
      .map((p) => ({
        id: p.id as AgentProviderId,
        label: p.name,
        models: p.models.map((m) => ({
          id: m.id,
          label: m.label,
          ...(m.description ? { description: m.description } : {}),
        })),
      }));
    return mapped.length > 0 ? mapped : PROVIDER_CATALOGUE;
  }, [query.data]);

  return {
    catalogue,
    defaultProviderId: query.data?.defaultProviderId,
    isLoading: query.isLoading,
  };
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
  return useMutation<AgentSession, Error, CreateSessionInput | void>({
    mutationFn: (input) => sessions.createSession(input ?? {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: sessionsKeys.list() });
      // POST /sessions auto-creates a workspace when `workspaceId` is
      // omitted (see `sessions.endpoint.ts`). The sidebar groups by
      // workspace, so we have to refresh that list too — otherwise a
      // freshly-provisioned workspace renders under a placeholder name
      // until the next refetch.
      qc.invalidateQueries({ queryKey: workspacesKeys.list() });
    },
  });
}

export function useUpdateSession() {
  const { sessions } = useAgentsApiClients();
  const qc = useQueryClient();
  return useMutation<AgentSession, Error, { id: string; input: UpdateSessionInput }>({
    mutationFn: ({ id, input }) => sessions.updateSession(id, input),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: sessionsKeys.list() });
      qc.setQueryData(sessionsKeys.detail(data.id), data);
    },
  });
}

export function useDeleteSession() {
  const { sessions } = useAgentsApiClients();
  const qc = useQueryClient();
  return useMutation<void, Error, { id: string }>({
    mutationFn: ({ id }) => sessions.deleteSession(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: sessionsKeys.list() });
    },
  });
}

/**
 * Load message history for a session. Returns messages in ascending
 * sequence order. The chat runtime calls this once on mount to seed
 * its message store; live updates come from the WS stream
 * (`useChatStream`), not from this query.
 */
export function useSessionMessages(sessionId: string | null | undefined) {
  const { sessions } = useAgentsApiClients();
  return useQuery<AgentMessage[]>({
    queryKey: sessionsKeys.messages(sessionId ?? ''),
    queryFn: async () => {
      const r = await sessions.listMessages(sessionId as string, { limit: 200 });
      return r.data;
    },
    enabled: Boolean(sessionId),
    // History is immutable from this client's perspective — we mutate
    // it locally via cache writes during the live stream rather than
    // refetching.
    staleTime: Infinity,
  });
}
