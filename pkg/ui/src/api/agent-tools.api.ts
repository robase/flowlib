// Agent tools React Query hooks
import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../contexts/ApiContext';
import { queryKeys } from './query-keys';
import { staleTime } from './stale-times';

export function useAgentTools() {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: queryKeys.agentTools,
    queryFn: () => apiClient.getAgentTools(),
    // Tools are bundled into the Worker, change only on deploy.
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
