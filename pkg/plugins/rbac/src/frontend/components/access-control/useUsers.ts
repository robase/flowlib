import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '@flowlib/ui';
import type { AuthUser } from './types';

export function useUsers(): AuthUser[] {
  const api = useApiClient();

  const { data } = useQuery<{ users: AuthUser[] }>({
    queryKey: ['rbac', 'auth-users'],
    queryFn: async () => {
      const response = await fetch(`${api.getBaseURL()}/plugins/auth/users?limit=200`, {
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch users: ${response.status}`);
      }
      return response.json();
    },
    staleTime: 1000 * 60 * 5, // 5 min — shared across all consumers
    gcTime: 1000 * 60 * 10,
  });

  return data?.users ?? [];
}
