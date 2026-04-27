/**
 * AuthAppShell — Plugin appShell that wraps Flowlib with auth gating.
 *
 * When provided as `appShell` on the auth frontend plugin, the `<Flowlib>`
 * component automatically wraps its content with this shell. No need for
 * the separate `<AuthenticatedFlowlib>` wrapper.
 *
 * Render tree:
 *   AuthProvider → AuthGate → children (Flowlib layout)
 *                    └─ fallback: SignInPage / TwoFactorVerifyForm
 */

import type { ReactNode } from 'react';
import { AuthProvider, useAuth } from '../providers/AuthProvider';
import { AuthGate } from './AuthGate';
import { SignInPage } from './SignInPage';
import { TwoFactorVerifyForm } from './TwoFactorVerifyForm';

export interface AuthAppShellProps {
  children: ReactNode;
  apiBaseUrl: string;
  basePath: string;
}

export function AuthAppShell({ children, apiBaseUrl }: AuthAppShellProps) {
  return (
    <AuthProvider baseUrl={apiBaseUrl}>
      <AuthGate loading={<LoadingSpinner />} fallback={<SignInFallback />}>
        {children}
      </AuthGate>
    </AuthProvider>
  );
}

// ── Internal: Sign-in fallback with 2FA support ──────────────

function SignInFallback() {
  return <SignInWithTwoFactor />;
}

// Auth state changes cause AuthGate to re-render — no callback needed.
function noop() {
  /* intentional no-op */
}

function SignInWithTwoFactor() {
  const { twoFactorRequired } = useAuth();

  if (twoFactorRequired) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-imp-background p-4">
        <div className="w-full max-w-sm">
          <TwoFactorVerifyForm onSuccess={noop} />
        </div>
      </div>
    );
  }

  return <SignInPage onSuccess={noop} subtitle="Sign in to access Flowlib" />;
}

// ── Internal: Loading spinner ────────────────────────────────

function LoadingSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-imp-background">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-imp-muted border-t-imp-primary" />
    </div>
  );
}
