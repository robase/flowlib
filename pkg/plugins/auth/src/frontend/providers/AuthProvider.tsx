/**
 * AuthProvider — exposes a Better Auth client + session state via context.
 *
 * Per-action hooks (useSignInEmail, useSignUpEmail, ...) consume the client
 * from context and wrap React Query mutations/queries.
 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AuthSession, AuthUser } from '../../shared/types';
import { createFlowlibAuthClient, type AuthClient } from '../lib/auth-client';
import { sessionOptions } from '../queries/options';

// ─────────────────────────────────────────────────────────────
// Context
// ─────────────────────────────────────────────────────────────

export interface AuthContextValue {
  /** Better Auth client. Use this directly in the per-action hooks. */
  authClient: AuthClient;
  /** Base URL passed to the client — exposed for components that need to build endpoint URLs. */
  baseUrl: string;
  /** Whether the session query is still loading on first mount. */
  isLoading: boolean;
  /** Current user, or null when unauthenticated. */
  user: AuthUser | null;
  /** Convenience flag derived from `user`. */
  isAuthenticated: boolean;
  /** Whether sign-in completed but 2FA verification is pending. */
  twoFactorRequired: boolean;
  /** Set the 2FA-required flag (forms call this after a sign-in returns `twoFactorRedirect`). */
  setTwoFactorRequired: (required: boolean) => void;
  /** Clear the 2FA-required flag and return to the sign-in page. */
  cancelTwoFactor: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// ─────────────────────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────────────────────

export interface AuthProviderProps {
  children: ReactNode;
  /**
   * Base URL for the Flowlib API (e.g. `'http://localhost:3000/flowlib'`).
   * Better Auth routes are mounted at `${baseUrl}/plugins/auth/api/auth`.
   */
  baseUrl: string;
}

export function AuthProvider({ children, baseUrl }: AuthProviderProps) {
  const [twoFactorRequired, setTwoFactorRequired] = useState(false);

  const authClient = useMemo(
    () => createFlowlibAuthClient(`${baseUrl}/plugins/auth/api/auth`),
    [baseUrl],
  );

  const cancelTwoFactor = useCallback(() => setTwoFactorRequired(false), []);

  // `sessionOptions` wires `throw: true` so the queryFn returns the unwrapped
  // `{user, session}` (or `null` for unauthenticated). React Query catches
  // network/auth errors and surfaces them via `error`.
  const sessionQuery = useQuery({
    ...sessionOptions(authClient),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const user: AuthUser | null = useMemo(() => {
    const data = sessionQuery.data as { user?: Record<string, unknown> | null } | null | undefined;
    const u = data?.user;
    if (!u) {
      return null;
    }
    return {
      id: String(u.id),
      name: typeof u.name === 'string' ? u.name : undefined,
      email: typeof u.email === 'string' ? u.email : undefined,
      image: typeof u.image === 'string' ? u.image : undefined,
      role: typeof u.role === 'string' ? u.role : undefined,
      twoFactorEnabled: typeof u.twoFactorEnabled === 'boolean' ? u.twoFactorEnabled : undefined,
    };
  }, [sessionQuery.data]);

  const value = useMemo<AuthContextValue>(
    () => ({
      authClient,
      baseUrl,
      isLoading: sessionQuery.isLoading,
      user,
      isAuthenticated: user !== null,
      twoFactorRequired,
      setTwoFactorRequired,
      cancelTwoFactor,
    }),
    [authClient, baseUrl, sessionQuery.isLoading, user, twoFactorRequired, cancelTwoFactor],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ─────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────

/**
 * Access the auth context. Throws when used outside an `<AuthProvider>` —
 * components in this package always render under one.
 */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('[@flowlib/user-auth] useAuth must be used inside <AuthProvider>');
  }
  return ctx;
}

// Re-export AuthSession type for back-compat with old imports.
export type { AuthSession };
