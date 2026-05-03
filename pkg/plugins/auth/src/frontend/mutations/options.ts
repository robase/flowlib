/**
 * Mutation option factories for Better Auth endpoints.
 *
 * Each factory returns stable `mutationOptions` keyed under
 * `["auth", ...]` so callers can match in MutationCache observers.
 */

import type { AuthClient } from '../lib/auth-client';
import { authMutationOptions } from '../lib/auth-options';

// ── Auth flows ─────────────────────────────────────────────────

export function signInEmailOptions(authClient: AuthClient) {
  return authMutationOptions(authClient.signIn.email, ['auth', 'signIn', 'email']);
}

export function signInSocialOptions(authClient: AuthClient) {
  return authMutationOptions(authClient.signIn.social, ['auth', 'signIn', 'social']);
}

export function signUpEmailOptions(authClient: AuthClient) {
  return authMutationOptions(authClient.signUp.email, ['auth', 'signUp', 'email']);
}

// Magic link — send a one-click sign-in URL by email. The plugin auto-creates
// the user on first verification (when `disableSignUp: false`, the default).
export function sendMagicLinkOptions(authClient: AuthClient) {
  return authMutationOptions(authClient.signIn.magicLink, ['auth', 'signIn', 'magicLink']);
}

export function signOutOptions(authClient: AuthClient) {
  return authMutationOptions(authClient.signOut, ['auth', 'signOut']);
}

export function requestPasswordResetOptions(authClient: AuthClient) {
  return authMutationOptions(authClient.requestPasswordReset, ['auth', 'requestPasswordReset']);
}

export function resetPasswordOptions(authClient: AuthClient) {
  return authMutationOptions(authClient.resetPassword, ['auth', 'resetPassword']);
}

// ── Profile / settings ─────────────────────────────────────────

export function updateUserOptions(authClient: AuthClient) {
  return authMutationOptions(authClient.updateUser, ['auth', 'updateUser']);
}

export function changePasswordOptions(authClient: AuthClient) {
  return authMutationOptions(authClient.changePassword, ['auth', 'changePassword']);
}

// Used to set an initial password for users created via OTP / social sign-in
// (no current password required).
export function setPasswordOptions(authClient: AuthClient) {
  return authMutationOptions(authClient.setPassword, ['auth', 'setPassword']);
}

export function changeEmailOptions(authClient: AuthClient) {
  return authMutationOptions(authClient.changeEmail, ['auth', 'changeEmail']);
}

export function revokeSessionOptions(authClient: AuthClient) {
  return authMutationOptions(authClient.revokeSession, ['auth', 'revokeSession']);
}

export function deleteUserOptions(authClient: AuthClient) {
  return authMutationOptions(authClient.deleteUser, ['auth', 'deleteUser']);
}

// ── Two-factor (verify during sign-in lives on twoFactor namespace) ──

export function verifyTwoFactorTotpOptions(authClient: AuthClient) {
  return authMutationOptions(authClient.twoFactor.verifyTotp, ['auth', 'twoFactor', 'verifyTotp']);
}

export function verifyTwoFactorBackupOptions(authClient: AuthClient) {
  return authMutationOptions(authClient.twoFactor.verifyBackupCode, [
    'auth',
    'twoFactor',
    'verifyBackupCode',
  ]);
}

export function enableTwoFactorOptions(authClient: AuthClient) {
  return authMutationOptions(authClient.twoFactor.enable, ['auth', 'twoFactor', 'enable']);
}

export function disableTwoFactorOptions(authClient: AuthClient) {
  return authMutationOptions(authClient.twoFactor.disable, ['auth', 'twoFactor', 'disable']);
}

export function getTwoFactorTotpUriOptions(authClient: AuthClient) {
  return authMutationOptions(authClient.twoFactor.getTotpUri, ['auth', 'twoFactor', 'getTotpUri']);
}

export function generateTwoFactorBackupCodesOptions(authClient: AuthClient) {
  return authMutationOptions(authClient.twoFactor.generateBackupCodes, [
    'auth',
    'twoFactor',
    'generateBackupCodes',
  ]);
}
