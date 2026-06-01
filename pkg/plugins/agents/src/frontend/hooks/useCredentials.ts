/**
 * React Query hook for the LLM-credential picker.
 *
 * Backed by `GET /plugins/agents/credentials/llm` — same lifetime as
 * the parent route; no polling.
 */

import { useQuery } from '@tanstack/react-query';
import type { AgentCredentialOption } from '../api/credentials.api';
import { useAgentsApiClients } from '../api/context';

export const credentialsKeys = {
  all: ['agents', 'credentials'] as const,
  llm: () => [...credentialsKeys.all, 'llm'] as const,
};

export function useLlmCredentials() {
  const { credentials } = useAgentsApiClients();
  return useQuery<AgentCredentialOption[]>({
    queryKey: credentialsKeys.llm(),
    queryFn: () => credentials.listLlm(),
    // Credentials don't change often; cache for a minute.
    staleTime: 60_000,
  });
}
