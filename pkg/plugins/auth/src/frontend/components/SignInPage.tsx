/**
 * SignInPage — full-page sign-in. Wraps SignInForm with the shared page shell.
 *
 * Redirects to the basePath home when the user is already authenticated, so
 * authenticated users hitting `/sign-in` directly don't sit on the form.
 */

import { Navigate } from 'react-router';
import { useAuth } from '../providers/AuthProvider';
import { SignInForm, type SignInFormProps } from './SignInForm';
import { AuthPageShell } from './ui/auth-form';

export interface SignInPageProps extends SignInFormProps {
  /** Forwarded by the Flowlib route registry. Unused — kept for the route component contract. */
  basePath?: string;
}

export function SignInPage({ basePath: _basePath, ...props }: SignInPageProps) {
  const { isAuthenticated, isLoading } = useAuth();
  if (!isLoading && isAuthenticated) {
    return <Navigate to="/" replace />;
  }
  return (
    <AuthPageShell>
      <SignInForm {...props} />
    </AuthPageShell>
  );
}
