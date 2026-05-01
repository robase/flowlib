/**
 * AuthAppShell — plugin appShell that wraps Flowlib with auth gating.
 *
 * Renders children when authenticated; otherwise dispatches on the current
 * pathname to one of the auth pages (sign-in, sign-up, forgot-password,
 * reset-password) so unauthenticated users can navigate between them. When
 * `twoFactorRequired` is set after a partial sign-in, the 2FA verification
 * page takes priority over path-based routing.
 */

import type { ReactNode } from 'react';
import { useLocation } from 'react-router';
import { AuthProvider, useAuth } from '../providers/AuthProvider';
import { useAuthPublicConfig } from '../hooks';
import { AuthGate } from './AuthGate';
import { ForgotPasswordPage } from './ForgotPasswordPage';
import { ResetPasswordPage } from './ResetPasswordPage';
import { SignInPage } from './SignInPage';
import { SignUpPage } from './SignUpPage';
import { TwoFactorVerifyPage } from './TwoFactorVerifyPage';

export interface AuthAppShellProps {
  children: ReactNode;
  apiBaseUrl: string;
  basePath: string;
}

export function AuthAppShell({ children, apiBaseUrl }: AuthAppShellProps) {
  return (
    <AuthProvider baseUrl={apiBaseUrl}>
      <AuthGate loading={<LoadingSpinner />} fallback={<UnauthenticatedRoutes />}>
        {children}
      </AuthGate>
    </AuthProvider>
  );
}

// ── Internal: unauthenticated path-based routing ────────────────

function UnauthenticatedRoutes() {
  const { twoFactorRequired } = useAuth();
  const { pathname } = useLocation();
  const config = useAuthPublicConfig();
  const signUpDisabled = config.data?.signUpEnabled === false;

  // 2FA mid-flow takes priority over path routing.
  if (twoFactorRequired) {
    return <TwoFactorVerifyPage />;
  }

  // The pathname here is already stripped of the React Router basename,
  // so '/flowlib/sign-up' shows up as '/sign-up'.
  if (pathname.startsWith('/sign-up') && !signUpDisabled) {
    return <SignUpPage />;
  }
  if (pathname.startsWith('/forgot-password')) {
    return <ForgotPasswordPage />;
  }
  if (pathname.startsWith('/reset-password')) {
    return <ResetPasswordPage />;
  }

  return <SignInPage />;
}

// ── Internal: loading spinner ───────────────────────────────────

function LoadingSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary" />
    </div>
  );
}
