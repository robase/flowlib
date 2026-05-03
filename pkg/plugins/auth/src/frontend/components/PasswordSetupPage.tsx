/**
 * PasswordSetupPage — full-page route component for `/welcome/set-password`.
 *
 * Mounted by the auth frontend plugin; the magic-link plugin's
 * `newUserCallbackURL` should point here so first-time users land on it
 * after clicking their sign-in link. Skipping or saving navigates to `/`.
 */

import { type ReactNode } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { useAuth } from '../providers/AuthProvider';
import { AuthPageShell } from './ui/auth-form';
import { PasswordSetupForm } from './PasswordSetupForm';

export interface PasswordSetupPageProps {
  /** Forwarded by the Flowlib route registry. */
  basePath?: string;
  /** Brand mark rendered above the card. */
  brand?: ReactNode;
}

export function PasswordSetupPage({ basePath: _basePath, brand }: PasswordSetupPageProps) {
  const { isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();

  if (!isLoading && !isAuthenticated) {
    return <Navigate to="/sign-in" replace />;
  }

  return (
    <AuthPageShell brand={brand}>
      <PasswordSetupForm onDone={() => navigate('/', { replace: true })} />
    </AuthPageShell>
  );
}
