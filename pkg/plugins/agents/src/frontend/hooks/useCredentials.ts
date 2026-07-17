/**
 * React Query hook for the LLM-credential picker.
 *
 * Backed by `GET /plugins/agents/credentials/llm` — same lifetime as
 * the parent route; no polling.
 */

import { useQuery } from '@tanstack/react-query';
import type { AgentCredentialOption, CredentialModelsResult } from '../api/credentials.api';
import { useAgentsApiClients } from '../api/context';

export const credentialsKeys = {
  all: ['agents', 'credentials'] as const,
  llm: () => [...credentialsKeys.all, 'llm'] as const,
  models: (credentialId: string) => [...credentialsKeys.all, 'models', credentialId] as const,
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

/**
 * Live model catalogue for a credential's vendor (fetched server-side).
 * Disabled until a credential is selected. Vendor catalogues change
 * rarely, so cache generously.
 */
export function useCredentialModels(credentialId: string | null | undefined) {
  const { credentials } = useAgentsApiClients();
  return useQuery<CredentialModelsResult>({
    queryKey: credentialsKeys.models(credentialId ?? ''),
    queryFn: () => credentials.listModels(credentialId as string),
    enabled: Boolean(credentialId),
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    retry: 1,
  });
}
