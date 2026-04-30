// Credential-related React Query hooks
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '../contexts/ApiContext';
import { queryKeys, getErrorMessage } from './query-keys';
import { staleTime } from './stale-times';
import type { CredentialFilters, CreateCredentialInput, UpdateCredentialInput } from './types';

// Credential Queries
export function useCredentials(filters?: CredentialFilters, options?: { enabled?: boolean }) {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: queryKeys.credentials(filters),
    queryFn: () => apiClient.listCredentials(filters),
    // Sidebar list. Mutations invalidate.
    staleTime: staleTime.medium,
    enabled: options?.enabled ?? true,
  });
}

export function useCredential(id: string) {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: queryKeys.credential(id),
    queryFn: () => apiClient.getCredential(id),
    enabled: Boolean(id),
    // OAuth refreshes mutate this server-side without a client mutation;
    // keep short so a forced reload picks up new tokens.
    staleTime: staleTime.short,
  });
}

export function useCredentialUsage(id: string, enabled: boolean = true) {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: queryKeys.credentialUsage(id),
    queryFn: () => apiClient.getCredentialUsage(id),
    enabled: enabled && Boolean(id),
    // "How many flows use this credential" counter; updates when flows
    // are edited but the dialog is rarely open long enough to matter.
    staleTime: staleTime.short,
  });
}

// Credential Mutations
export function useCreateCredential() {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateCredentialInput) => apiClient.createCredential(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['credentials'] });
    },
    onError: (error) => {
      console.error('Error creating credential:', getErrorMessage(error));
    },
  });
}

export function useUpdateCredential() {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateCredentialInput }) =>
      apiClient.updateCredential(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['credentials'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.credential(id) });
    },
    onError: (error) => {
      console.error('Error updating credential:', getErrorMessage(error));
    },
  });
}

export function useDeleteCredential() {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.deleteCredential(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['credentials'] });
      // The detail + usage caches for the deleted id will 404 on refetch;
      // remove them outright instead of leaving them in an error state.
      queryClient.removeQueries({ queryKey: queryKeys.credential(id) });
      queryClient.removeQueries({ queryKey: queryKeys.credentialUsage(id) });
    },
    onError: (error) => {
      console.error('Error deleting credential:', getErrorMessage(error));
    },
  });
}

export function useTestCredential() {
  const apiClient = useApiClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.testCredential(id),
    onError: (error) => {
      console.error('Error testing credential:', getErrorMessage(error));
    },
  });
}

// Test Credential Request Mutation (for testing API connections)
export function useTestCredentialRequest() {
  const apiClient = useApiClient();

  return useMutation({
    mutationFn: (params: {
      url: string;
      method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
      headers?: Record<string, string>;
      body?: string;
    }) => apiClient.testCredentialRequest(params),
    onError: (error) => {
      console.error('Error testing credential request:', getErrorMessage(error));
    },
  });
}

// OAuth2 Queries
export function useOAuth2Providers() {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: ['oauth2', 'providers'],
    queryFn: () => apiClient.getOAuth2Providers(),
    // Provider catalogue is bundled into the Worker; only changes on deploy.
    staleTime: staleTime.static,
  });
}

export function useOAuth2Provider(providerId: string) {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: ['oauth2', 'provider', providerId],
    queryFn: () => apiClient.getOAuth2Provider(providerId),
    enabled: Boolean(providerId),
    staleTime: staleTime.static,
  });
}

// OAuth2 Mutations
export function useStartOAuth2Flow() {
  const apiClient = useApiClient();

  return useMutation({
    mutationFn: (params: {
      providerId?: string;
      clientId?: string;
      clientSecret?: string;
      redirectUri: string;
      scopes?: string[];
      returnUrl?: string;
      credentialName?: string;
      existingCredentialId?: string;
    }) => apiClient.startOAuth2Flow(params),
    onError: (error) => {
      console.error('Error starting OAuth2 flow:', getErrorMessage(error));
    },
  });
}

export function useHandleOAuth2Callback() {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: {
      code: string;
      state: string;
      clientId?: string;
      clientSecret?: string;
      redirectUri?: string;
    }) => apiClient.handleOAuth2Callback(params),
    onSuccess: () => {
      // Invalidate both the list and all individual credential queries
      // so the detail dialog picks up the new tokens
      queryClient.invalidateQueries({ queryKey: ['credentials'] });
    },
    onError: (error) => {
      console.error('Error handling OAuth2 callback:', getErrorMessage(error));
    },
  });
}

export function useRefreshOAuth2Credential() {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (credentialId: string) => apiClient.refreshOAuth2Credential(credentialId),
    onSuccess: (_, credentialId) => {
      queryClient.invalidateQueries({ queryKey: ['credentials'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.credential(credentialId) });
    },
    onError: (error) => {
      console.error('Error refreshing OAuth2 credential:', getErrorMessage(error));
    },
  });
}
