// Node data / testing React Query hooks
import { useQuery, useMutation } from '@tanstack/react-query';
import { useApiClient } from '../contexts/ApiContext';
import { queryKeys, getErrorMessage } from './query-keys';
import { staleTime } from './stale-times';
import { type SubmitPromptRequest } from '@flowlib/core/types';
import { BatchProvider } from '@flowlib/core/types';

// JS Expression Testing (for data mapper)
export function useTestJsExpression() {
  const apiClient = useApiClient();

  return useMutation({
    mutationFn: (request: { expression: string; context: Record<string, unknown> }) =>
      apiClient.testJsExpression(request),
    onError: (error) => {
      console.error('Error testing JS expression:', getErrorMessage(error));
    },
  });
}

// Data Mapper Testing
export function useTestMapper() {
  const apiClient = useApiClient();

  return useMutation({
    mutationFn: (request: {
      expression: string;
      incomingData: Record<string, unknown>;
      mode?: 'auto' | 'iterate' | 'reshape';
    }) => apiClient.testMapper(request),
    onError: (error) => {
      console.error('Error testing mapper:', getErrorMessage(error));
    },
  });
}

export function useResolveNodeDefinition() {
  const apiClient = useApiClient();

  return useMutation({
    mutationFn: (request: {
      nodeType: string;
      params: Record<string, unknown>;
      nodeId?: string | null;
      flowId?: string | null;
      changeField?: string;
      changeValue?: unknown;
    }) =>
      apiClient.resolveNodeDefinition(request.nodeType, {
        nodeId: request.nodeId,
        flowId: request.flowId,
        params: request.params,
        changeField: request.changeField,
        changeValue: request.changeValue,
      }),
  });
}

/**
 * Hook for loading dynamic field options via the loadOptions system.
 */
export function useLoadFieldOptions(
  actionId: string,
  fieldName: string,
  dependencyValues: Record<string, unknown>,
  options?: { enabled?: boolean },
) {
  const apiClient = useApiClient();
  const depsKey = JSON.stringify(dependencyValues);

  return useQuery({
    queryKey: queryKeys.fieldOptions(actionId, fieldName, depsKey),
    queryFn: () => apiClient.loadFieldOptions(actionId, fieldName, dependencyValues),
    enabled: options?.enabled ?? true,
    // External data (Slack channels, Notion DBs, etc). Users expect
    // refresh on dropdown re-open within a session.
    staleTime: staleTime.medium,
    retry: 1,
  });
}

/**
 * Hook for running a named action loader (powers `helper: { kind: 'async-picker' }`).
 */
export function useActionLoader(
  actionId: string,
  loaderName: string,
  dependencyValues: Record<string, unknown>,
  query: string,
  options?: { enabled?: boolean },
) {
  const apiClient = useApiClient();
  const depsKey = JSON.stringify(dependencyValues);

  return useQuery({
    queryKey: queryKeys.actionLoader(actionId, loaderName, depsKey, query),
    queryFn: () => apiClient.runActionLoader(actionId, loaderName, dependencyValues, query),
    enabled: options?.enabled ?? true,
    // Same shape as field options — keyed by query string, so each
    // distinct search term gets its own short-lived cache entry.
    staleTime: staleTime.medium,
    retry: 1,
  });
}

// Models Query
export function useListAvailableModels(options?: {
  credentialId?: string;
  provider?: string;
  enabled?: boolean;
}) {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: [...queryKeys.models, options?.credentialId ?? options?.provider ?? 'all'],
    queryFn: () =>
      apiClient.getModels({ credentialId: options?.credentialId, provider: options?.provider }),
    enabled: options?.enabled ?? true,
    // Provider model lists (e.g. OpenAI, Anthropic) shift maybe weekly.
    // 30 min covers a normal session without hammering the provider API.
    staleTime: staleTime.long,
    retry: (failureCount, error) => {
      if (failureCount >= 2) {
        return false;
      }
      if (error instanceof Error && error.message.includes('4')) {
        return false;
      }
      return true;
    },
  });
}

// Model Testing Mutation
export function useExecuteModelPrompt() {
  const apiClient = useApiClient();

  return useMutation({
    mutationFn: (testData: {
      prompt: string;
      model: string;
      maxTokens?: number;
      temperature?: number;
      outputSchema?: string;
    }) =>
      apiClient.testModelPrompt({
        ...testData,
        provider: BatchProvider.OPENAI,
        useBatchProcessing: false,
      } as SubmitPromptRequest),
    onError: (error) => {
      console.error('Error testing model prompt:', getErrorMessage(error));
    },
  });
}

// Node Definitions Query
export function useAvailableNodes() {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: queryKeys.availableNodes,
    queryFn: () => apiClient.getAvailableNodes(),
    // Action catalogue is bundled into the Worker; only changes on deploy.
    staleTime: staleTime.static,
    retry: (failureCount, error) => {
      if (failureCount >= 2) {
        return false;
      }
      if (error instanceof Error && error.message.includes('4')) {
        return false;
      }
      return true;
    },
  });
}
