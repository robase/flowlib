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
import { FlowlibLoader } from '@flowlib/ui';
import { AuthProvider, useAuth } from '../providers/AuthProvider';
import { useAuthPublicConfig } from '../hooks';
import { AuthGate } from './AuthGate';
import { ForgotPasswordPage } from './ForgotPasswordPage';
import { ResetPasswordPage } from './ResetPasswordPage';
import { SignInPage, type SignInPageProps } from './SignInPage';
import { SignUpPage, type SignUpPageProps } from './SignUpPage';
import { TwoFactorVerifyPage } from './TwoFactorVerifyPage';

export interface AuthAppShellProps {
  children: ReactNode;
  apiBaseUrl: string;
  basePath: string;
  /**
   * Brand mark (e.g. wordmark + logo SVG) rendered above every auth card.
   * Forwarded to SignInPage / SignUpPage / etc. via their `brand` prop.
   * Override per-page via `signInPageProps.brand` / `signUpPageProps.brand`.
   */
  brand?: ReactNode;
  /**
   * Props forwarded to the internal `<SignInPage />` rendered when the
   * unauthenticated user is on the sign-in path. Use this to inject
   * `socialProviders`, `socialDisclosure`, etc.
   */
  signInPageProps?: Omit<SignInPageProps, 'basePath'>;
  /** Props forwarded to the internal `<SignUpPage />`. */
  signUpPageProps?: Omit<SignUpPageProps, 'basePath'>;
}

export function AuthAppShell({
  children,
  apiBaseUrl,
  basePath,
  brand,
  signInPageProps,
  signUpPageProps,
}: AuthAppShellProps) {
  // Resolve brand fallback: per-page brand wins, otherwise top-level.
  const signIn = { brand, ...signInPageProps };
  const signUp = { brand, ...signUpPageProps };
  return (
    <AuthProvider baseUrl={apiBaseUrl}>
      <AuthGate
        loading={<LoadingSpinner />}
        fallback={
          <UnauthenticatedRoutes
            basePath={basePath}
            signInPageProps={signIn}
            signUpPageProps={signUp}
          />
        }
      >
        {children}
      </AuthGate>
    </AuthProvider>
  );
}

// ── Internal: unauthenticated path-based routing ────────────────

function UnauthenticatedRoutes({
  basePath,
  signInPageProps,
  signUpPageProps,
}: {
  basePath: string;
  signInPageProps?: Omit<SignInPageProps, 'basePath'>;
  signUpPageProps?: Omit<SignUpPageProps, 'basePath'>;
}) {
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
    return <SignUpPage {...signUpPageProps} />;
  }
  if (stripped.startsWith('/forgot-password')) {
    return <ForgotPasswordPage />;
  }
  if (stripped.startsWith('/reset-password')) {
    return <ResetPasswordPage />;
  }

  return <SignInPage {...signInPageProps} />;
}

// ── Internal: loading spinner ───────────────────────────────────

function LoadingSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <FlowlibLoader label="" iconClassName="h-16" />
    </div>
  );
}
