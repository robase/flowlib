/**
 * Public auth configuration — fetched once per mount, no session required.
 *
 * Drives sign-in/up UI: hides the sign-up link, redirects /sign-up away,
 * and hides social buttons for unconfigured providers.
 */

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../providers/AuthProvider';

export interface AuthPublicConfig {
  signUpEnabled: boolean;
  magicLinkEnabled: boolean;
  passwordEnabled: boolean;
  socialProviders: string[];
}

export function useAuthPublicConfig() {
  const { baseUrl } = useAuth();
  return useQuery<AuthPublicConfig>({
    queryKey: ['auth', 'publicConfig', baseUrl],
    queryFn: async ({ signal }) => {
      const res = await fetch(`${baseUrl}/plugins/auth/public-config`, {
        credentials: 'include',
        signal,
      });
      if (!res.ok) {
        throw new Error(`Failed to load auth config (HTTP ${res.status})`);
      }
      return (await res.json()) as AuthPublicConfig;
    },
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}
