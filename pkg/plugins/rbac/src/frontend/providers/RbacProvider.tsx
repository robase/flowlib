/**
 * RBAC Context Provider
 *
 * Wraps the Invect app tree with RBAC state — current user identity,
 * permissions cache, and permission-checking utilities.
 *
 * Fetches GET /plugins/auth/me on mount and caches the result.
 */

import { createContext, useContext, useCallback, useMemo, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '@flowlib/ui';
import type { AuthMeResponse } from '../../shared/types';

// ─────────────────────────────────────────────────────────────
// Context Types
// ─────────────────────────────────────────────────────────────

export interface RbacContextValue {
  /** Current user identity, null if not authenticated */
  user: AuthMeResponse['identity'];
  /** Whether the user is authenticated */
  isAuthenticated: boolean;
  /** Set of all permissions the user has */
  permissions: Set<string>;
  /** Check if the user has a specific permission */
  checkPermission: (permission: string) => boolean;
  /** Whether the auth/me query is still loading */
  isLoading: boolean;
}

// ─────────────────────────────────────────────────────────────
// Context
// ─────────────────────────────────────────────────────────────

const RbacContext = createContext<RbacContextValue | null>(null);

// ─────────────────────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────────────────────

export function RbacProvider({ children }: { children: ReactNode }) {
  const api = useApiClient();

  const { data: me, isLoading } = useQuery<AuthMeResponse>({
    queryKey: ['rbac', 'auth', 'me'],
    queryFn: async () => {
      const response = await fetch(`${api.getBaseURL()}/plugins/auth/me`, {
        credentials: 'include',
      });
      if (!response.ok) {
        // If auth endpoint doesn't exist or fails, return unauthenticated
        return {
          identity: null,
          permissions: [],
          isAuthenticated: false,
        };
      }
      return response.json();
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: 1,
  });

  const permissions = useMemo(() => new Set(me?.permissions ?? []), [me?.permissions]);

  const checkPermission = useCallback(
    (permission: string): boolean => {
      if (!me?.isAuthenticated) {
        return true; // No auth = allow all (matches core default)
      }
      return permissions.has(permission) || permissions.has('admin:*');
    },
    [me?.isAuthenticated, permissions],
  );

  const value = useMemo<RbacContextValue>(
    () => ({
      user: me?.identity ?? null,
      isAuthenticated: me?.isAuthenticated ?? false,
      permissions,
      checkPermission,
      isLoading,
    }),
    [me, permissions, checkPermission, isLoading],
  );

  return <RbacContext.Provider value={value}>{children}</RbacContext.Provider>;
}

// ─────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────

/**
 * Access RBAC context — current user, permissions, and permission checking.
 *
 * Must be used within an `<RbacProvider>`.
 * Returns a safe fallback (unauthenticated, allow all) if provider is missing.
 */
export function useRbac(): RbacContextValue {
  const ctx = useContext(RbacContext);

  if (!ctx) {
    // Graceful fallback — allow everything if RBAC provider isn't mounted
    return {
      user: null,
      isAuthenticated: false,
      permissions: new Set(),
      checkPermission: () => true,
      isLoading: false,
    };
  }

  return ctx;
}
