/**
 * @flowlib/user-auth/ui — Frontend Entry Point
 *
 * Browser-safe entry point that exports the auth UI components.
 * Import via: `import { AuthProvider, useAuth } from '@flowlib/user-auth/ui'`
 *
 * No Node.js dependencies. No better-auth-ui runtime imports.
 */

// ── Provider + auth client ───────────────────────────────────────
export { AuthProvider, useAuth } from './providers/AuthProvider';
export type { AuthContextValue, AuthProviderProps } from './providers/AuthProvider';
export type { AuthClient } from './lib/auth-client';

// ── Per-action hooks (borrowed from better-auth-ui patterns) ─────
export {
  // Queries
  useSession,
  useListSessions,
  useListAccounts,
  // Auth flow mutations
  useSignInEmail,
  useSignInSocial,
  useSignUpEmail,
  useSendMagicLink,
  useSignOut,
  useRequestPasswordReset,
  useResetPassword,
  // Profile mutations
  useUpdateUser,
  useChangePassword,
  useSetPassword,
  useChangeEmail,
  useRevokeSession,
  useDeleteUser,
  // Public config
  useAuthPublicConfig,
  // 2FA mutations
  useVerifyTwoFactorTotp,
  useVerifyTwoFactorBackupCode,
  useEnableTwoFactor,
  useDisableTwoFactor,
  useGetTwoFactorTotpUri,
  useGenerateTwoFactorBackupCodes,
} from './hooks';

// ── Form components ──────────────────────────────────────────────
export { SignInForm } from './components/SignInForm';
export type { SignInFormProps } from './components/SignInForm';
export { SignUpForm } from './components/SignUpForm';
export type { SignUpFormProps, SignUpMode } from './components/SignUpForm';
export { ForgotPasswordForm } from './components/ForgotPasswordForm';
export { ResetPasswordForm } from './components/ResetPasswordForm';
export { TwoFactorVerifyForm } from './components/TwoFactorVerifyForm';
export type { TwoFactorVerifyFormProps } from './components/TwoFactorVerifyForm';
export { TwoFactorSetup } from './components/TwoFactorSetup';
export { EmailSentNotice } from './components/EmailSentNotice';
export type { EmailSentNoticeProps } from './components/EmailSentNotice';
export { PasswordSetupForm } from './components/PasswordSetupForm';
export type { PasswordSetupFormProps } from './components/PasswordSetupForm';
export { PasswordSetupPage } from './components/PasswordSetupPage';
export type { PasswordSetupPageProps } from './components/PasswordSetupPage';
export { SocialAuthButtons } from './components/ui/SocialAuthButtons';
export type {
  SocialAuthButtonsProps,
  SocialProviderConfig,
  SocialProviderObject,
  SocialProviderId,
  BuiltInSocialProviderId,
  SocialDisclosure,
} from './components/ui/SocialAuthButtons';

// ── Full-page components ─────────────────────────────────────────
export { SignInPage } from './components/SignInPage';
export type { SignInPageProps } from './components/SignInPage';
export { SignUpPage } from './components/SignUpPage';
export type { SignUpPageProps } from './components/SignUpPage';
export { ForgotPasswordPage } from './components/ForgotPasswordPage';
export { ResetPasswordPage } from './components/ResetPasswordPage';
export { TwoFactorVerifyPage } from './components/TwoFactorVerifyPage';
export type { TwoFactorVerifyPageProps } from './components/TwoFactorVerifyPage';
export { ProfilePage } from './components/ProfilePage';
export { UserManagementPage } from './components/UserManagementPage';

// ── Settings cards (compose your own profile shell) ──────────────
export { SessionsList } from './components/SessionsList';
export { DetailsTab } from './components/profile/DetailsTab';
export { AuthenticationTab } from './components/profile/AuthenticationTab';
export { ApiKeysCard } from './components/profile/ApiKeysCard';

// ── Header / sidebar utilities ───────────────────────────────────
export { UserButton } from './components/UserButton';
export type { UserButtonProps } from './components/UserButton';
export { Avatar } from './components/ui/Avatar';
export type { AvatarProps } from './components/ui/Avatar';
export { SidebarUserMenu } from './components/SidebarUserMenu';
export type { SidebarUserMenuProps } from './components/SidebarUserMenu';

// ── Auth gating ──────────────────────────────────────────────────
export { AuthGate } from './components/AuthGate';
export type { AuthGateProps } from './components/AuthGate';
export { AuthAppShell } from './components/AuthAppShell';
export type { AuthAppShellProps } from './components/AuthAppShell';

// ── User management (admin-only) ─────────────────────────────────
export { UserManagement } from './components/UserManagement';
export type { UserManagementProps } from './components/UserManagement';
export { ApiKeysDialog } from './components/ApiKeysDialog';
export type { ApiKeysDialogProps } from './components/ApiKeysDialog';

// ── Frontend plugin definition ───────────────────────────────────
export { authFrontend } from './plugins/authFrontendPlugin';

// ── Shared types ─────────────────────────────────────────────────
export type {
  AuthSession,
  AuthUser,
  SignInCredentials,
  CreateUserInput,
  UpdateUserRoleInput,
  AuthError,
  TwoFactorRedirect,
  TwoFactorEnableResponse,
  TwoFactorVerifyInput,
  TwoFactorEnableInput,
  TwoFactorDisableInput,
} from '../shared/types';
