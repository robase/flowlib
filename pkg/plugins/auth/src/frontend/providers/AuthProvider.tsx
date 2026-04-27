/**
 * AuthProvider — Context provider for authentication state.
 *
 * Fetches the current session from the better-auth proxy endpoints
 * and caches it via React Query. Provides sign-in, sign-up, and
 * sign-out actions to child components.
 */

import { createContext, useContext, useCallback, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  AuthSession,
  AuthUser,
  SignInCredentials,
  SignUpCredentials,
  TwoFactorVerifyInput,
  TwoFactorEnableResponse,
  TwoFactorEnableInput,
  TwoFactorDisableInput,
} from '../../shared/types';

// ─────────────────────────────────────────────────────────────
// Context Types
// ─────────────────────────────────────────────────────────────

export interface AuthContextValue {
  /** Current authenticated user, null if not signed in */
  user: AuthUser | null;
  /** Whether the user is authenticated */
  isAuthenticated: boolean;
  /** Whether the session query is still loading */
  isLoading: boolean;
  /** Sign in with email/password */
  signIn: (credentials: SignInCredentials) => Promise<void>;
  /** Sign up with email/password */
  signUp: (credentials: SignUpCredentials) => Promise<void>;
  /** Sign out the current session */
  signOut: () => Promise<void>;
  /** Whether a sign-in is in progress */
  isSigningIn: boolean;
  /** Whether a sign-up is in progress */
  isSigningUp: boolean;
  /** Last auth error, if any */
  error: string | null;
  /** Whether 2FA verification is required (after sign-in) */
  twoFactorRequired: boolean;
  /** Cancel the pending 2FA verification and return to sign-in */
  cancelTwoFactor: () => void;
  /** Verify a TOTP code during sign-in */
  verifyTotp: (input: TwoFactorVerifyInput) => Promise<void>;
  /** Verify a backup code during sign-in */
  verifyBackupCode: (code: string) => Promise<void>;
  /** Whether a 2FA verification is in progress */
  isVerifyingTwoFactor: boolean;
  /** Enable 2FA for the current user — returns TOTP URI and backup codes */
  enableTwoFactor: (input: TwoFactorEnableInput) => Promise<TwoFactorEnableResponse>;
  /** Disable 2FA for the current user */
  disableTwoFactor: (input: TwoFactorDisableInput) => Promise<void>;
  /** Get the TOTP URI for the current user (requires password) */
  getTotpUri: (password: string) => Promise<string>;
  /** Generate new backup codes for the current user */
  generateBackupCodes: (password: string) => Promise<string[]>;
}

// ─────────────────────────────────────────────────────────────
// Context
// ─────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue | null>(null);

// ─────────────────────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────────────────────

export interface AuthProviderProps {
  children: ReactNode;
  /**
   * Base URL for the Flowlib API (e.g. 'http://localhost:3000/flowlib').
   * Auth endpoints are at `${baseUrl}/plugins/auth/api/auth/*`.
   */
  baseUrl: string;
}

export function AuthProvider({ children, baseUrl }: AuthProviderProps) {
  const queryClient = useQueryClient();
  const [twoFactorRequired, setTwoFactorRequired] = useState(false);

  // Construct auth API base URL
  const authApiBase = `${baseUrl}/plugins/auth/api/auth`;

  // ── Session Query ──────────────────────────────────────────

  const { data: session, isLoading } = useQuery<AuthSession>({
    queryKey: ['auth', 'session'],
    queryFn: async () => {
      const response = await fetch(`${authApiBase}/get-session`, {
        credentials: 'include',
      });
      if (!response.ok) {
        return { user: null as unknown as AuthUser, isAuthenticated: false };
      }
      const data = await response.json();
      if (!data?.user) {
        return { user: null as unknown as AuthUser, isAuthenticated: false };
      }
      return {
        user: {
          id: data.user.id,
          name: data.user.name ?? undefined,
          email: data.user.email ?? undefined,
          image: data.user.image ?? undefined,
          role: data.user.role ?? undefined,
          twoFactorEnabled: data.user.twoFactorEnabled ?? undefined,
        },
        isAuthenticated: true,
      };
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: 1,
  });

  // ── Sign In ────────────────────────────────────────────────

  const signInMutation = useMutation({
    mutationFn: async (credentials: SignInCredentials) => {
      const response = await fetch(`${authApiBase}/sign-in/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(credentials),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({ message: 'Sign in failed' }));
        throw new Error(err.message || `Sign in failed (${response.status})`);
      }
      return response.json();
    },
    onSuccess: (data) => {
      if (data && data.twoFactorRedirect) {
        setTwoFactorRequired(true);
        return;
      }
      setTwoFactorRequired(false);
      queryClient.invalidateQueries({ queryKey: ['auth', 'session'] });
    },
  });

  // ── Sign Up ────────────────────────────────────────────────

  const signUpMutation = useMutation({
    mutationFn: async (credentials: SignUpCredentials) => {
      const response = await fetch(`${authApiBase}/sign-up/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(credentials),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({ message: 'Sign up failed' }));
        throw new Error(err.message || `Sign up failed (${response.status})`);
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auth', 'session'] });
    },
  });

  // ── Sign Out ───────────────────────────────────────────────

  const signOutMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`${authApiBase}/sign-out`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        const err = await response.json().catch(async () => ({
          message: (await response.text().catch(() => '')) || 'Sign out failed',
        }));
        throw new Error(err.message || `Sign out failed (${response.status})`);
      }
    },
    onSuccess: () => {
      setTwoFactorRequired(false);
      queryClient.invalidateQueries({ queryKey: ['auth', 'session'] });
    },
  });

  // ── 2FA: Verify TOTP ──────────────────────────────────────

  const verifyTotpMutation = useMutation({
    mutationFn: async (input: TwoFactorVerifyInput) => {
      const response = await fetch(`${authApiBase}/two-factor/verify-totp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({ message: 'Invalid verification code' }));
        throw new Error(err.message || `Verification failed (${response.status})`);
      }
      return response.json();
    },
    onSuccess: () => {
      setTwoFactorRequired(false);
      queryClient.invalidateQueries({ queryKey: ['auth', 'session'] });
    },
  });

  // ── 2FA: Verify Backup Code ────────────────────────────────

  const verifyBackupCodeMutation = useMutation({
    mutationFn: async (code: string) => {
      const response = await fetch(`${authApiBase}/two-factor/verify-backup-code`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ code }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({ message: 'Invalid backup code' }));
        throw new Error(err.message || `Verification failed (${response.status})`);
      }
      return response.json();
    },
    onSuccess: () => {
      setTwoFactorRequired(false);
      queryClient.invalidateQueries({ queryKey: ['auth', 'session'] });
    },
  });

  // ── Callbacks ──────────────────────────────────────────────

  const signIn = useCallback(
    async (credentials: SignInCredentials) => {
      await signInMutation.mutateAsync(credentials);
    },
    [signInMutation],
  );

  const signUp = useCallback(
    async (credentials: SignUpCredentials) => {
      await signUpMutation.mutateAsync(credentials);
    },
    [signUpMutation],
  );

  const signOut = useCallback(async () => {
    await signOutMutation.mutateAsync();
  }, [signOutMutation]);

  const cancelTwoFactor = useCallback(() => {
    setTwoFactorRequired(false);
  }, []);

  const verifyTotp = useCallback(
    async (input: TwoFactorVerifyInput) => {
      await verifyTotpMutation.mutateAsync(input);
    },
    [verifyTotpMutation],
  );

  const verifyBackupCode = useCallback(
    async (code: string) => {
      await verifyBackupCodeMutation.mutateAsync(code);
    },
    [verifyBackupCodeMutation],
  );

  const enableTwoFactor = useCallback(
    async (input: TwoFactorEnableInput): Promise<TwoFactorEnableResponse> => {
      const response = await fetch(`${authApiBase}/two-factor/enable`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({ message: 'Failed to enable 2FA' }));
        throw new Error(err.message || `Failed to enable 2FA (${response.status})`);
      }
      const data = await response.json();
      queryClient.invalidateQueries({ queryKey: ['auth', 'session'] });
      return data;
    },
    [authApiBase, queryClient],
  );

  const disableTwoFactor = useCallback(
    async (input: TwoFactorDisableInput): Promise<void> => {
      const response = await fetch(`${authApiBase}/two-factor/disable`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({ message: 'Failed to disable 2FA' }));
        throw new Error(err.message || `Failed to disable 2FA (${response.status})`);
      }
      queryClient.invalidateQueries({ queryKey: ['auth', 'session'] });
    },
    [authApiBase, queryClient],
  );

  const getTotpUri = useCallback(
    async (password: string): Promise<string> => {
      const response = await fetch(`${authApiBase}/two-factor/get-totp-uri`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ password }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({ message: 'Failed to get TOTP URI' }));
        throw new Error(err.message || `Failed to get TOTP URI (${response.status})`);
      }
      const data = await response.json();
      return data.totpURI;
    },
    [authApiBase],
  );

  const generateBackupCodes = useCallback(
    async (password: string): Promise<string[]> => {
      const response = await fetch(`${authApiBase}/two-factor/generate-backup-codes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ password }),
      });
      if (!response.ok) {
        const err = await response
          .json()
          .catch(() => ({ message: 'Failed to generate backup codes' }));
        throw new Error(err.message || `Failed to generate backup codes (${response.status})`);
      }
      const data = await response.json();
      return data.backupCodes;
    },
    [authApiBase],
  );

  // ── Error ──────────────────────────────────────────────────

  const error =
    signInMutation.error?.message ??
    signUpMutation.error?.message ??
    signOutMutation.error?.message ??
    verifyTotpMutation.error?.message ??
    verifyBackupCodeMutation.error?.message ??
    null;

  // ── Context Value ──────────────────────────────────────────

  const value = useMemo<AuthContextValue>(
    () => ({
      user: session?.isAuthenticated ? session.user : null,
      isAuthenticated: session?.isAuthenticated ?? false,
      isLoading,
      signIn,
      signUp,
      signOut,
      isSigningIn: signInMutation.isPending,
      isSigningUp: signUpMutation.isPending,
      error,
      twoFactorRequired,
      cancelTwoFactor,
      verifyTotp,
      verifyBackupCode,
      isVerifyingTwoFactor: verifyTotpMutation.isPending || verifyBackupCodeMutation.isPending,
      enableTwoFactor,
      disableTwoFactor,
      getTotpUri,
      generateBackupCodes,
    }),
    [
      session,
      isLoading,
      signIn,
      signUp,
      signOut,
      signInMutation.isPending,
      signUpMutation.isPending,
      error,
      twoFactorRequired,
      cancelTwoFactor,
      verifyTotp,
      verifyBackupCode,
      verifyTotpMutation.isPending,
      verifyBackupCodeMutation.isPending,
      enableTwoFactor,
      disableTwoFactor,
      getTotpUri,
      generateBackupCodes,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ─────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────

/**
 * Access auth context — current user, sign-in/sign-up/sign-out actions.
 *
 * Must be used within an `<AuthProvider>`.
 * Returns a safe fallback (unauthenticated) if provider is missing.
 */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);

  if (!ctx) {
    // Graceful fallback
    return {
      user: null,
      isAuthenticated: false,
      isLoading: false,
      signIn: async () => {
        throw new Error('AuthProvider not found');
      },
      signUp: async () => {
        throw new Error('AuthProvider not found');
      },
      signOut: async () => {
        throw new Error('AuthProvider not found');
      },
      isSigningIn: false,
      isSigningUp: false,
      error: null,
      twoFactorRequired: false,
      cancelTwoFactor: () => {
        return null;
      },
      verifyTotp: async () => {
        throw new Error('AuthProvider not found');
      },
      verifyBackupCode: async () => {
        throw new Error('AuthProvider not found');
      },
      isVerifyingTwoFactor: false,
      enableTwoFactor: async () => {
        throw new Error('AuthProvider not found');
      },
      disableTwoFactor: async () => {
        throw new Error('AuthProvider not found');
      },
      getTotpUri: async () => {
        throw new Error('AuthProvider not found');
      },
      generateBackupCodes: async () => {
        throw new Error('AuthProvider not found');
      },
    };
  }

  return ctx;
}
