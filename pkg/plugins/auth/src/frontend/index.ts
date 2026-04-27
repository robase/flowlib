/**
 * @flowlib/user-auth/ui — Frontend Entry Point
 *
 * Browser-safe entry point that exports the auth UI components.
 * Import via: `import { AuthProvider, useAuth } from '@flowlib/user-auth/ui'`
 *
 * No Node.js dependencies. No better-auth runtime imports.
 */

// Provider & hook
export { AuthProvider, useAuth } from './providers/AuthProvider';
export type { AuthProviderProps, AuthContextValue } from './providers/AuthProvider';

// Form components
export { SignInForm } from './components/SignInForm';
export type { SignInFormProps } from './components/SignInForm';

// Full-page components
export { SignInPage } from './components/SignInPage';
export type { SignInPageProps } from './components/SignInPage';

// Utility components
export { UserButton } from './components/UserButton';
export type { UserButtonProps } from './components/UserButton';
export { AuthGate } from './components/AuthGate';
export type { AuthGateProps } from './components/AuthGate';

// User management (admin-only)
export { UserManagement } from './components/UserManagement';
export type { UserManagementProps } from './components/UserManagement';

// API key management (admin-only, requires apiKey enabled)
export { ApiKeysDialog } from './components/ApiKeysDialog';
export type { ApiKeysDialogProps } from './components/ApiKeysDialog';

// Two-Factor Authentication components
export { TwoFactorVerifyForm } from './components/TwoFactorVerifyForm';
export type { TwoFactorVerifyFormProps } from './components/TwoFactorVerifyForm';
export { TwoFactorSetup } from './components/TwoFactorSetup';
export type { TwoFactorSetupProps } from './components/TwoFactorSetup';

// Authenticated Invect wrapper
export { AuthenticatedInvect } from './components/AuthenticatedInvect';
export type { AuthenticatedInvectProps } from './components/AuthenticatedInvect';

// User management page (standalone route)
export { UserManagementPage } from './components/UserManagementPage';
export { ProfilePage } from './components/ProfilePage';

// Sidebar user menu (sign-out, profile info)
export { SidebarUserMenu } from './components/SidebarUserMenu';
export type { SidebarUserMenuProps } from './components/SidebarUserMenu';

// Frontend plugin definition
export { authFrontend } from './plugins/authFrontendPlugin';

// Re-export shared types for convenience
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
