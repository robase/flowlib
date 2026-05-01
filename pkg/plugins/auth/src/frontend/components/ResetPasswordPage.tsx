import { Navigate } from 'react-router';
import { useAuth } from '../providers/AuthProvider';
import { ResetPasswordForm } from './ResetPasswordForm';
import { AuthPageShell } from './ui/auth-form';

export interface ResetPasswordPageProps {
  /** Forwarded by the Flowlib route registry. Unused — kept for the route component contract. */
  basePath?: string;
}

export function ResetPasswordPage(_props: ResetPasswordPageProps = {}) {
  const { isAuthenticated, isLoading } = useAuth();
  if (!isLoading && isAuthenticated) {
    return <Navigate to="/" replace />;
  }
  return (
    <AuthPageShell>
      <ResetPasswordForm />
    </AuthPageShell>
  );
}
