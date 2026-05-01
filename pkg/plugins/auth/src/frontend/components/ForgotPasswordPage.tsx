import { Navigate } from 'react-router';
import { useAuth } from '../providers/AuthProvider';
import { ForgotPasswordForm } from './ForgotPasswordForm';
import { AuthPageShell } from './ui/auth-form';

export interface ForgotPasswordPageProps {
  /** Forwarded by the Flowlib route registry. Unused — kept for the route component contract. */
  basePath?: string;
}

export function ForgotPasswordPage(_props: ForgotPasswordPageProps = {}) {
  const { isAuthenticated, isLoading } = useAuth();
  if (!isLoading && isAuthenticated) {
    return <Navigate to="/" replace />;
  }
  return (
    <AuthPageShell>
      <ForgotPasswordForm />
    </AuthPageShell>
  );
}
