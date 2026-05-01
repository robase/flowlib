/**
 * Per-action hooks built on the AuthProvider's auth client + React Query.
 *
 * Pattern borrowed directly from
 * https://github.com/better-auth-ui/better-auth-ui/tree/main/packages/react/src/hooks
 * — each hook wraps `useMutation`/`useQuery` with the matching options
 * factory, injects the auth client, and updates the right caches in
 * `onSuccess`.
 */

import { useMutation, useQuery, useQueryClient, skipToken } from '@tanstack/react-query';
import { useAuth } from '../providers/AuthProvider';

export { useAuthPublicConfig, type AuthPublicConfig } from './use-public-config';
import { listAccountsOptions, listSessionsOptions, sessionOptions } from '../queries/options';
import {
  changeEmailOptions,
  changePasswordOptions,
  deleteUserOptions,
  disableTwoFactorOptions,
  enableTwoFactorOptions,
  generateTwoFactorBackupCodesOptions,
  getTwoFactorTotpUriOptions,
  requestPasswordResetOptions,
  resetPasswordOptions,
  revokeSessionOptions,
  sendVerificationOtpOptions,
  setPasswordOptions,
  signInEmailOptions,
  signInEmailOtpOptions,
  signInSocialOptions,
  signOutOptions,
  signUpEmailOptions,
  updateUserOptions,
  verifyTwoFactorBackupOptions,
  verifyTwoFactorTotpOptions,
} from '../mutations/options';

type OmitKeys<T> = Omit<T, 'queryKey' | 'queryFn' | 'mutationKey' | 'mutationFn'>;

// ── Queries ───────────────────────────────────────────────────

export function useSession(options?: OmitKeys<ReturnType<typeof sessionOptions>>) {
  const { authClient } = useAuth();
  return useQuery({ ...sessionOptions(authClient), ...options });
}

export function useListSessions(options?: OmitKeys<ReturnType<typeof listSessionsOptions>>) {
  const { authClient } = useAuth();
  const { data: session } = useSession({ refetchOnMount: false });
  const userId = (session as { user?: { id?: string } } | null | undefined)?.user?.id;
  const disabled = !userId;
  return useQuery({
    ...listSessionsOptions(authClient, userId),
    ...(disabled && { queryFn: skipToken }),
    ...options,
  });
}

export function useListAccounts(options?: OmitKeys<ReturnType<typeof listAccountsOptions>>) {
  const { authClient } = useAuth();
  const { data: session } = useSession({ refetchOnMount: false });
  const userId = (session as { user?: { id?: string } } | null | undefined)?.user?.id;
  const disabled = !userId;
  return useQuery({
    ...listAccountsOptions(authClient, userId),
    ...(disabled && { queryFn: skipToken }),
    ...options,
  });
}

// ── Auth flow mutations ───────────────────────────────────────

export function useSignInEmail(options?: OmitKeys<ReturnType<typeof signInEmailOptions>>) {
  const { authClient } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    ...signInEmailOptions(authClient),
    ...options,
    onSuccess: async (...args) => {
      queryClient.resetQueries({ queryKey: sessionOptions(authClient).queryKey });
      await options?.onSuccess?.(...args);
    },
  });
}

export function useSignUpEmail(options?: OmitKeys<ReturnType<typeof signUpEmailOptions>>) {
  const { authClient } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    ...signUpEmailOptions(authClient),
    ...options,
    onSuccess: async (...args) => {
      queryClient.resetQueries({ queryKey: sessionOptions(authClient).queryKey });
      await options?.onSuccess?.(...args);
    },
  });
}

export function useSignInSocial(options?: OmitKeys<ReturnType<typeof signInSocialOptions>>) {
  const { authClient } = useAuth();
  return useMutation({ ...signInSocialOptions(authClient), ...options });
}

export function useSendVerificationOtp(
  options?: OmitKeys<ReturnType<typeof sendVerificationOtpOptions>>,
) {
  const { authClient } = useAuth();
  return useMutation({ ...sendVerificationOtpOptions(authClient), ...options });
}

export function useSignInEmailOtp(options?: OmitKeys<ReturnType<typeof signInEmailOtpOptions>>) {
  const { authClient } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    ...signInEmailOtpOptions(authClient),
    ...options,
    onSuccess: async (...args) => {
      queryClient.resetQueries({ queryKey: sessionOptions(authClient).queryKey });
      await options?.onSuccess?.(...args);
    },
  });
}

export function useSignOut(options?: OmitKeys<ReturnType<typeof signOutOptions>>) {
  const { authClient } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    ...signOutOptions(authClient),
    ...options,
    onSuccess: async (...args) => {
      queryClient.removeQueries({ queryKey: ['auth'] });
      await options?.onSuccess?.(...args);
    },
  });
}

export function useRequestPasswordReset(
  options?: OmitKeys<ReturnType<typeof requestPasswordResetOptions>>,
) {
  const { authClient } = useAuth();
  return useMutation({ ...requestPasswordResetOptions(authClient), ...options });
}

export function useResetPassword(options?: OmitKeys<ReturnType<typeof resetPasswordOptions>>) {
  const { authClient } = useAuth();
  return useMutation({ ...resetPasswordOptions(authClient), ...options });
}

// ── Profile mutations ─────────────────────────────────────────

export function useUpdateUser(options?: OmitKeys<ReturnType<typeof updateUserOptions>>) {
  const { authClient } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    ...updateUserOptions(authClient),
    ...options,
    onSuccess: async (...args) => {
      await queryClient.invalidateQueries({
        queryKey: sessionOptions(authClient).queryKey,
      });
      await options?.onSuccess?.(...args);
    },
  });
}

export function useChangePassword(options?: OmitKeys<ReturnType<typeof changePasswordOptions>>) {
  const { authClient } = useAuth();
  return useMutation({ ...changePasswordOptions(authClient), ...options });
}

// Set an initial password for an account created via OTP / social — no
// current-password required.
export function useSetPassword(options?: OmitKeys<ReturnType<typeof setPasswordOptions>>) {
  const { authClient } = useAuth();
  return useMutation({ ...setPasswordOptions(authClient), ...options });
}

export function useChangeEmail(options?: OmitKeys<ReturnType<typeof changeEmailOptions>>) {
  const { authClient } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    ...changeEmailOptions(authClient),
    ...options,
    onSuccess: async (...args) => {
      await queryClient.invalidateQueries({
        queryKey: sessionOptions(authClient).queryKey,
      });
      await options?.onSuccess?.(...args);
    },
  });
}

export function useRevokeSession(options?: OmitKeys<ReturnType<typeof revokeSessionOptions>>) {
  const { authClient } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    ...revokeSessionOptions(authClient),
    ...options,
    onSuccess: async (...args) => {
      await queryClient.invalidateQueries({ queryKey: ['auth'] });
      await options?.onSuccess?.(...args);
    },
  });
}

export function useDeleteUser(options?: OmitKeys<ReturnType<typeof deleteUserOptions>>) {
  const { authClient } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    ...deleteUserOptions(authClient),
    ...options,
    onSuccess: async (...args) => {
      queryClient.removeQueries({ queryKey: ['auth'] });
      await options?.onSuccess?.(...args);
    },
  });
}

// ── Two-factor mutations ──────────────────────────────────────

export function useVerifyTwoFactorTotp(
  options?: OmitKeys<ReturnType<typeof verifyTwoFactorTotpOptions>>,
) {
  const { authClient } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    ...verifyTwoFactorTotpOptions(authClient),
    ...options,
    onSuccess: async (...args) => {
      queryClient.resetQueries({ queryKey: sessionOptions(authClient).queryKey });
      await options?.onSuccess?.(...args);
    },
  });
}

export function useVerifyTwoFactorBackupCode(
  options?: OmitKeys<ReturnType<typeof verifyTwoFactorBackupOptions>>,
) {
  const { authClient } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    ...verifyTwoFactorBackupOptions(authClient),
    ...options,
    onSuccess: async (...args) => {
      queryClient.resetQueries({ queryKey: sessionOptions(authClient).queryKey });
      await options?.onSuccess?.(...args);
    },
  });
}

export function useEnableTwoFactor(options?: OmitKeys<ReturnType<typeof enableTwoFactorOptions>>) {
  const { authClient } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    ...enableTwoFactorOptions(authClient),
    ...options,
    onSuccess: async (...args) => {
      await queryClient.invalidateQueries({
        queryKey: sessionOptions(authClient).queryKey,
      });
      await options?.onSuccess?.(...args);
    },
  });
}

export function useDisableTwoFactor(
  options?: OmitKeys<ReturnType<typeof disableTwoFactorOptions>>,
) {
  const { authClient } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    ...disableTwoFactorOptions(authClient),
    ...options,
    onSuccess: async (...args) => {
      await queryClient.invalidateQueries({
        queryKey: sessionOptions(authClient).queryKey,
      });
      await options?.onSuccess?.(...args);
    },
  });
}

export function useGetTwoFactorTotpUri(
  options?: OmitKeys<ReturnType<typeof getTwoFactorTotpUriOptions>>,
) {
  const { authClient } = useAuth();
  return useMutation({ ...getTwoFactorTotpUriOptions(authClient), ...options });
}

export function useGenerateTwoFactorBackupCodes(
  options?: OmitKeys<ReturnType<typeof generateTwoFactorBackupCodesOptions>>,
) {
  const { authClient } = useAuth();
  return useMutation({
    ...generateTwoFactorBackupCodesOptions(authClient),
    ...options,
  });
}
