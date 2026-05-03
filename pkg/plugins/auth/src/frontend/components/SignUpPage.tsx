import { type ReactNode } from 'react';
import { Navigate } from 'react-router';
import { useAuth } from '../providers/AuthProvider';
import { useAuthPublicConfig } from '../hooks';
import { SignUpForm, type SignUpFormProps } from './SignUpForm';
import { AuthPageShell } from './ui/auth-form';

export interface SignUpPageProps extends SignUpFormProps {
  /** Forwarded by the Flowlib route registry. Unused — kept for the route component contract. */
  basePath?: string;
  /** Brand mark rendered above the card. */
  brand?: ReactNode;
}

export function SignUpPage({ basePath: _basePath, brand, ...props }: SignUpPageProps) {
  const { isAuthenticated, isLoading } = useAuth();
  const config = useAuthPublicConfig();
  if (!isLoading && isAuthenticated) {
    return <Navigate to="/" replace />;
  }
  // Server-side sign-up disabled — bounce to the sign-in page so users
  // can't land on a form that won't submit. Wait for the config query to
  // resolve to avoid flashing the form.
  if (config.data?.signUpEnabled === false) {
    return <Navigate to="/sign-in" replace />;
  }
  return (
    <AuthPageShell brand={brand}>
      <SignUpForm {...props} />
    </AuthPageShell>
  );
}
