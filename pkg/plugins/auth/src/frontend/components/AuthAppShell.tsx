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

export function AuthAppShell({ children, apiBaseUrl, basePath }: AuthAppShellProps) {
  return (
    <AuthProvider baseUrl={apiBaseUrl}>
      <AuthGate
        loading={<LoadingSpinner />}
        fallback={<UnauthenticatedRoutes basePath={basePath} />}
      >
        {children}
      </AuthGate>
    </AuthProvider>
  );
}

// ── Internal: unauthenticated path-based routing ────────────────

function UnauthenticatedRoutes({ basePath }: { basePath: string }) {
  const { twoFactorRequired } = useAuth();
  const { pathname } = useLocation();
  const config = useAuthPublicConfig();
  const signUpDisabled = config.data?.signUpEnabled === false;

  // 2FA mid-flow takes priority over path routing.
  if (twoFactorRequired) {
    return <TwoFactorVerifyPage />;
  }

  // Strip the host's frontend basePath if the React Router basename isn't
  // already doing it. Hosts that wrap Flowlib in `<BrowserRouter basename>`
  // pass a stripped pathname here ('/sign-up'); hosts that don't (the Vite
  // dev frontend) leave the full path ('/flowlib/sign-up'). We handle both.
  const normalizedBase = !basePath || basePath === '/' ? '' : basePath.replace(/\/$/, '');
  const stripped =
    normalizedBase && pathname.startsWith(normalizedBase)
      ? pathname.slice(normalizedBase.length) || '/'
      : pathname;

  if (stripped.startsWith('/sign-up') && !signUpDisabled) {
    return <SignUpPage />;
  }
  if (stripped.startsWith('/forgot-password')) {
    return <ForgotPasswordPage />;
  }
  if (stripped.startsWith('/reset-password')) {
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
