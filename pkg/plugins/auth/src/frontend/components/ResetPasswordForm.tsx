/**
 * ResetPasswordForm — completes a password reset using the token from the
 * email link's `?token=` query string. Calls `authClient.resetPassword`
 * via the borrowed `useResetPassword` hook.
 */

import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useResetPassword } from '../hooks';
import {
  AuthCard,
  ErrorMessage,
  Field,
  SubmitButton,
  SuccessMessage,
  TextInput,
} from './ui/auth-form';

export function ResetPasswordForm() {
  const navigate = useNavigate();
  const [token, setToken] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setToken(params.get('token'));
  }, []);

  const reset = useResetPassword();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    if (!token) {
      setLocalError('Reset token is missing or invalid.');
      return;
    }
    if (password.length < 8) {
      setLocalError('Password must be at least 8 characters');
      return;
    }
    // eslint-disable-next-line security/detect-possible-timing-attacks -- client-side equality check on user's own input, not a secret comparison
    if (password !== confirm) {
      setLocalError('Passwords do not match');
      return;
    }

    try {
      await reset.mutateAsync({ newPassword: password, token });
      setDone(true);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Reset failed');
    }
  };

  if (done) {
    return (
      <AuthCard
        title="Password reset"
        description="Your password has been updated."
        footer={
          <button
            type="button"
            onClick={() => navigate('/sign-in')}
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            Sign in with new password
          </button>
        }
      >
        <SuccessMessage>You can now sign in with your new password.</SuccessMessage>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Choose a new password"
      description="Enter a new password for your account."
      footer={
        <p>
          <Link
            to="/sign-in"
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            Back to sign in
          </Link>
        </p>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <Field label="New password" htmlFor="auth-reset-password" hint="At least 8 characters.">
          <TextInput
            id="auth-reset-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="new-password"
            required
            minLength={8}
          />
        </Field>

        <Field label="Confirm new password" htmlFor="auth-reset-confirm">
          <TextInput
            id="auth-reset-confirm"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="••••••••"
            autoComplete="new-password"
            required
          />
        </Field>

        <ErrorMessage>{localError}</ErrorMessage>

        <SubmitButton loading={reset.isPending} disabled={!token}>
          {reset.isPending ? 'Updating…' : 'Update password'}
        </SubmitButton>
      </form>
    </AuthCard>
  );
}
